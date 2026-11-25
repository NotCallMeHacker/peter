/**
 * Completion-time merge: commit the task's work, then merge its branch into `baseBranch`.
 *
 * Sequence (plan.md §5, merge bullet) — the WHOLE thing runs under
 * `withRepoLock(repo.cachePath, …)` because it mutates repo-level state (the shared
 * baseBranch and temporary worktree bookkeeping) and would race other tasks'
 * merges on the cache's `index.lock` otherwise:
 *
 *   1. If `gitHasChanges` on the task worktree (via `--git-dir/--work-tree`, see
 *      git.ts) → `gitAdd -A` + `gitCommit` on the task's own branch. Nothing else
 *      is ever checked out or switched in the task's worktree.
 *   2. `git merge --no-ff <branch>` into `baseBranch`.
 *
 * MERGE-IN-A-BARE-CLONE STRATEGY (the choice, verified experimentally):
 * The cache is ALWAYS a `--mirror` clone (repo.ts header), so `git -C <cachePath>
 * merge` refuses outright: "fatal: this operation must be run in a work tree"
 * (verified, exit 128). Of the plan's two candidates:
 *
 *   - `git merge-tree` computes the merge and reports conflicts but does NOT write
 *     the result — no flag makes it create the commit objects/refs — so no real
 *     `--no-ff` merge commit can be produced with it. Rejected.
 *   - A temporary linked worktree DOES work and is what this module does:
 *     `git worktree add <tmp> <baseBranch>` (verified even for a pre-created empty
 *     dir inside the bare repo dir), merge there, `git worktree remove <tmp>` in
 *     `finally`.
 *
 * Temp location: `mkdtemp(<cachePath>/.merge-tmp-…)` — inside the cache dir so it
 * works regardless of what else occupies `worktreesDir`; the leading dot plus pid/
 * randomness means a stale dir from a crashed run can never collide with a fresh
 * one (its gitdir name carries a `merge-tmp-` prefix, so `pruneRepoWorktrees` at
 * boot sweeps leftovers of a crash that skipped `finally`).
 *
 * Worktree-per-branch constraint (verified): git refuses to check out a branch that
 * is already checked out elsewhere ("'main' is already used by worktree at …").
 * That is exactly the task's own worktree, so the temp worktree is created on
 * `baseBranch` and NEVER switches: `git merge -- <branch>` merges a branch that is
 * checked out elsewhere just fine (verified) — checking the task branch out in the
 * temp worktree is what would be refused, and would be wrong anyway.
 *
 * Conflict path (never auto-resolved): collect paths with
 * `git diff --name-only --diff-filter=U`, `git merge --abort` inside the temp
 * worktree (verified: baseBranch's ref never moved), remove the temp worktree in
 * `finally`, and throw `MergeConflictError`. The task's branch, its worktree and
 * any container are left completely untouched — conflicts are handed to a
 * human/merge agent per architecture.md §"Git workspaces".
 *
 * All git calls go through git.ts's `gitRun` — the same `--git-dir/--work-tree`
 * argv discipline (every option is its own argv entry, no shell, nothing
 * interpolated into a command line). Both gitdirs always EXIST (the cache dir
 * itself and `<cache>/worktrees/<name>`), which is what `git --git-dir/--work-tree`
 * requires, and every path is Supervisor-derived, never agent-controlled.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { log, redact } from "../log.ts";
import { gitAdd, gitCommit, gitHasChanges, gitRun, type GitRunOpts } from "./git.ts";
import { withRepoLock } from "./lock.ts";
import type { RepoHandle } from "./repo.ts";

/**
 * Thrown when the merge into `baseBranch` conflicts. `conflicts` lists the
 * repo-relative paths (from `git diff --name-only --diff-filter=U`). State is left
 * intact: the task's branch, worktree and container are untouched, and the
 * baseBranch merge was aborted — nothing is auto-resolved.
 */
export class MergeConflictError extends Error {
    /** Conflicting paths, repo-relative. */
    conflicts: string[];

    constructor(conflicts: string[]) {
        super(`merge conflict in ${conflicts.length} path(s): ${conflicts.join(", ")}`);
        this.name = "MergeConflictError";
        this.conflicts = conflicts;
    }
}

/** Outcome of `commitAllAndMerge`. */
export interface MergeResult {
    /** `true` when a merge commit was created; `false` only when already up to date. */
    merged: boolean;
    /** SHA of the merge commit on `baseBranch`; `null` when nothing was merged. */
    commitSha: string | null;
    /** `true` when `branch` was already contained in `baseBranch` ("Already up to date"). */
    alreadyUpToDate: boolean;
}

/**
 * Commit whatever the task left uncommitted, then `merge --no-ff <branch>` into
 * `baseBranch` — the `completed` path (plan.md §5). Throws `MergeConflictError` on
 * conflict (state preserved), or an Error with `.code === "gitFailure"` on any
 * other git error.
 */
export async function commitAllAndMerge(
    repo: RepoHandle,
    opts: { gitDir: string; worktreePath: string; branch: string; baseBranch: string },
): Promise<MergeResult> {
    const { gitDir, worktreePath, branch, baseBranch } = opts;
    return withRepoLock(repo.cachePath, async () => {
        const task: GitRunOpts = { gitDir, worktreePath };
        const cache: GitRunOpts = { gitDir: repo.cachePath, worktreePath: repo.cachePath };

        // (1) Task-scoped: commit anything uncommitted on the task's own branch.
        if (await gitHasChanges(task)) {
            await gitAdd(task, []);
            await gitCommit(task, `task completion: merge ${branch} into ${baseBranch}`);
        }

        // baseBranch tip before merging — proves afterwards that the merge advanced it.
        const before = await gitRun(cache, ["rev-parse", `${baseBranch}^{commit}`]);
        if (before.code !== 0) throw gitRunFailure(`rev-parse ${baseBranch}`, before);
        const baseBefore = before.stdout.trim();

        // (2) Repo-level: merge inside a temporary worktree of baseBranch (module header).
        const tmp = await mkdtemp(join(repo.cachePath, ".merge-tmp-"));
        let result: MergeResult;
        try {
            result = await mergeInTempWorktree(cache, tmp, branch, baseBranch, baseBefore);
        } catch (err) {
            // Error path: cleanup is best-effort and must NEVER mask the real error
            // (conflict / gitFailure).
            await cleanupTempWorktree(cache, tmp).catch((cleanErr) =>
                log.warn("temp merge worktree cleanup failed", { tmp, error: String(redact(cleanErr)) }),
            );
            throw err;
        }
        // Success path: a cleanup failure THROWS — the caller must not believe
        // everything was cleaned up when it was not.
        await cleanupTempWorktree(cache, tmp);
        return result;
    });
}

/** The actual `worktree add` → `merge --no-ff` → verify sequence inside `tmp`. */
async function mergeInTempWorktree(
    cache: GitRunOpts,
    tmp: string,
    branch: string,
    baseBranch: string,
    baseBefore: string,
): Promise<MergeResult> {
    const add = await gitRun(cache, ["worktree", "add", tmp, "--", baseBranch]);
    if (add.code !== 0) throw gitRunFailure(`worktree add ${tmp}`, add);
    const tmpOpts: GitRunOpts = { gitDir: await readGitDirFile(tmp), worktreePath: tmp };

    const merge = await gitRun(tmpOpts, [
                "merge",
                "--no-ff",
                "-m",
                `Merge branch '${branch}' into ${baseBranch}`,
                "--",
                branch,
            ]);

    // Already contained in baseBranch: git exits 0 with this exact line and
    // changes nothing (verified on stdout). Report it as the pinned no-op.
    if (merge.code === 0 && /^Already up to date\.?$/m.test(merge.stdout)) {
        log.info("branch already contained in base", { branch, baseBranch });
        return { merged: false, commitSha: null, alreadyUpToDate: true };
    }

    if (merge.code !== 0) {
        // Conflict (or a merge that could not start): see the module header.
        const conflicts = await abortMergeAndCollect(tmpOpts);
        if (conflicts.length === 0) {
            // Not a clean conflict report — surface git's real failure instead.
            throw gitRunFailure(`merge ${branch} into ${baseBranch}`, merge);
        }
        log.warn("merge conflict; leaving task branch and worktree untouched", {
            branch,
            baseBranch,
            conflicts: conflicts.join(", "),
        });
        throw new MergeConflictError(conflicts);
    }

    // Success: the merge commit must have advanced baseBranch (and it is a real
    // --no-ff merge: `git rev-list --parents` reports 2+ parents — asserted by the
    // self-test, since --no-ff is what guarantees the merge commit here).
    const after = await gitRun(cache, ["rev-parse", `${baseBranch}^{commit}`]);
    if (after.code !== 0) throw gitRunFailure(`rev-parse ${baseBranch}`, after);
    const baseAfter = after.stdout.trim();
    if (baseAfter === baseBefore) {
        throw gitRunFailure(`merge of ${branch} did not advance ${baseBranch}`, after);
    }
    const contained = await gitRun(cache, ["merge-base", "--is-ancestor", baseBefore, baseAfter]);
    if (contained.code !== 0) {
        throw gitRunFailure(`new ${baseBranch} tip does not contain the old one`, contained);
    }

    log.info("merged task branch", { branch, baseBranch, commitSha: baseAfter });
    return { merged: true, commitSha: baseAfter, alreadyUpToDate: false };
}

/**
 * Remove the temp worktree (bare `--git-dir/--work-tree` flags, verified working).
 * Escalates: plain `worktree remove` → `--force` (a dirty mid-merge state refuses a
 * plain removal) → last resort rmdir + `worktree prune`, so a stale temp worktree
 * can never wedge the next run. Throws only when NOTHING could remove the dir —
 * callers decide whether to swallow (error path) or surface (success path).
 */
async function cleanupTempWorktree(cache: GitRunOpts, tmp: string): Promise<void> {
    const plain = await gitRun(cache, ["worktree", "remove", tmp]);
    if (plain.code === 0) return;
    const forced = await gitRun(cache, ["worktree", "remove", "--force", tmp]);
    if (forced.code === 0) return;
    await gitRun(cache, ["worktree", "prune"]);
    try {
        await rm(tmp, { recursive: true, force: true });
    } catch {
        throw gitRunFailure(`worktree remove ${tmp} (then rmdir)`, forced);
    }
}

/**
 * Failed-merge handling: list unmerged paths from the temp worktree's index, then
 * `merge --abort` so baseBranch is not left mid-merge (verified: the ref never
 * moves, exit 0, and the temp worktree is still cleanly on baseBranch afterwards).
 * Returns the repo-relative conflict paths — empty when git failed for a
 * non-conflict reason, in which case the caller surfaces git's original error.
 */
async function abortMergeAndCollect(tmpOpts: GitRunOpts): Promise<string[]> {
    const unmerged = await gitRun(tmpOpts, ["diff", "--name-only", "--diff-filter=U"]);
    const aborted = await gitRun(tmpOpts, ["merge", "--abort"]);
    if (aborted.code !== 0) {
        // Never mask the conflict itself — report, then surface it.
        log.error("merge --abort failed; baseBranch may be left mid-merge", {
            stderr: String(redact(aborted.stderr || aborted.stdout)),
        });
    }
    const conflicts = unmerged.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    return unmerged.code === 0 ? conflicts : [];
}

/** Read a worktree's `.git` FILE (`gitdir: <abs path>`); throws when absent/invalid. */
async function readGitDirFile(worktreePath: string): Promise<string> {
    const raw = await readFile(join(worktreePath, ".git"), "utf8");
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
    if (!match) throw new Error(`temp worktree ${worktreePath} has no gitdir pointer`);
    return match[1];
}

/** Build an Error with `.code === "gitFailure"` from a structured gitRun result. */
function gitRunFailure(what: string, r: { code: number; stdout: string; stderr: string }): Error {
    const combined = `${r.stderr || r.stdout}`.replace(/\r?\n/g, "\\n").trim();
    const tail = String(redact(combined.length > 600 ? `…${combined.slice(-600)}` : combined));
    const err = new Error(`git ${what} failed (exit ${r.code})${tail ? `: ${tail}` : ""}`) as Error & { code: string; stderr: string };
    err.code = "gitFailure";
    err.stderr = tail;
    return err;
}
