/**
 * Per-task git worktrees (plan.md §5, `[W1/B] worktree.ts`).
 *
 * Contract (plan §0, "no git repo contract"):
 * - One worktree per agent task at `<config.worktreesDir>/<agentTaskId>`, which
 *   the runtime bind-mounts at `/workspace`.
 * - After creation the worktree's `.git` FILE is DELETED. Its content is
 *   `gitdir: <abs repo>/.git/worktrees/<name>`, i.e. it hands the container a
 *   reachable pointer at the full git dir. Rewriting it makes git refuse
 *   (`fatal: gitfile does not point to a valid repository`), so the clean move is
 *   deletion: the container sees a plain directory with no `.git` at all.
 * - The real gitdir is parsed from that file BEFORE deletion (never guessed from
 *   the repo layout) and returned to the caller, which stores it on the task and
 *   later drives `git --git-dir=<gitDir> --work-tree=<worktree>` itself.
 *
 * Every repo-level operation (`worktree add`/`remove`/`prune`) runs under
 * `withRepoLock(repo.cachePath, …)` — two of them racing on one repo hit the
 * repo's `index.lock` and the loser fails with a misleading error. This module
 * never touches the REPO's own `.git` beyond git's own bookkeeping, and it only
 * constructs paths — nothing here mounts anything (mounts are runtime/track A).
 */

import { execFile } from "node:child_process";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { loadConfig } from "../config.ts";
import { log, redact } from "../log.ts";
import { withRepoLock } from "./lock.ts";
import type { RepoHandle } from "./repo.ts";

const execFileAsync = promisify(execFile);

/** What a created worktree hands back to the task (feeds `ContainerHandle`). */
export interface WorktreeResult {
    /** `<config.worktreesDir>/<agentTaskId>` — the host path mounted at `/workspace`. */
    worktreePath: string;
    /** Real gitdir to store on the task: `<cachePath>/worktrees/<name>` (parsed from the `.git` file). */
    gitDir: string;
    /** The branch the worktree is checked out on (post-collision-suffix). */
    branch: string;
}

/** Per-call git env: never prompt interactively — a prompt would hang the caller. */
function gitEnv(): NodeJS.ProcessEnv {
    return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

/**
 * `git <args>` in the cached repo; non-zero exit throws with redacted output.
 * `maxBuffer` is generous because `worktree add` echoes a long advice block.
 */
async function git(repo: RepoHandle, args: readonly string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync("git", ["-C", repo.cachePath, ...args], {
            env: gitEnv(),
            maxBuffer: 16 * 1024 * 1024,
        });
        return stdout;
    } catch (err) {
        const e = err as { code?: unknown; stderr?: string | Buffer; message?: string };
        throw new Error(
            String(redact(`git ${args.join(" ")} failed (exit ${String(e.code)}): ${String(e.stderr ?? e.message ?? err)}`)),
        );
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse the worktree's `.git` FILE (`gitdir: <abs path>`) for the real gitdir.
 * Returns `null` when the file is absent or not a `gitdir:` pointer — callers
 * decide whether that is fatal.
 */
async function readGitfile(worktreePath: string): Promise<string | null> {
    try {
        const raw = await readFile(join(worktreePath, ".git"), "utf8");
        const match = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/**
 * A leftover `<worktreesDir>/<agentTaskId>` (crash between `worktree add` and
 * the caller storing the result) cannot be reused — `worktree add` refuses an
 * existing path. Recovery: `git worktree prune` (drops registrations whose
 * directory is gone), then remove whatever remains — if the leftover is a live
 * registration, `worktree remove --force` unregisters AND deletes it. A failure
 * to clear the path is a hard error naming it: silently adopting a half-created
 * worktree could hand a container someone else's checkout.
 */
/**
 * Wipe whatever is at `worktreePath` — registered or not — and prune stale
 * registrations. Order matters (verified): once this module deletes a worktree's
 * `.git` file, `worktree remove --force` REFUSES it
 * (`fatal: validation failed, cannot remove working tree: …/.git does not exist`)
 * while `worktree list` still shows it until `worktree prune` runs. So: remove
 * only when git still claims a VALID path, otherwise `rm -rf`, then ALWAYS prune.
 *
 * A missing path is not an error (idempotency), but a stale registration with no
 * directory IS cleaned up here — prune is what keeps `worktree add` from failing
 * after a crash.
 */
async function destroyWorktreePath(repo: RepoHandle, worktreePath: string): Promise<void> {
    // Repo not cloned yet (teardown racing a failed clone): nothing registered,
    // nothing to prune — mirror lock.ts's pruneRepoWorktrees guard.
    if (!(await pathExists(repo.cachePath))) return;
    if (await pathExists(worktreePath)) {
        const registered = await registeredWorktrees(repo);
        if (registered.includes(worktreePath)) {
            try {
                await git(repo, ["worktree", "remove", "--force", worktreePath]);
            } catch {
                // `.git` already deleted by us → git cannot validate it; the
                // directory goes below and `prune` drops the registration.
            }
        }
        if (await pathExists(worktreePath)) {
            await rm(worktreePath, { recursive: true, force: true });
        }
    }
    await git(repo, ["worktree", "prune"]);
    if (await pathExists(worktreePath)) {
        throw new Error(`worktree path exists and could not be cleared: ${worktreePath}`);
    }
    // The branch itself is deliberately NOT deleted: callers may reuse the name,
    // in which case `worktree add -b` fails and the documented fallback (check
    // out the existing branch) takes over.
}

async function clearStale(repo: RepoHandle, worktreePath: string): Promise<void> {
    if (!(await pathExists(worktreePath))) return;
    log.warn("clearing stale worktree path from a previous crash", { worktreePath });
    await destroyWorktreePath(repo, worktreePath);
}

/**
 * Create the task's worktree on `opts.branch` from `opts.baseBranch`.
 *
 * Strategy (one, documented): always `git worktree add <path> -b <branch> <base>`.
 * If `-b` fails because the branch already exists (the collision window
 * `resolveBranchName` cannot fully close, or a caller passing a pre-existing
 * branch), fall back to `git worktree add <path> <branch>` — checking out the
 * existing branch instead of creating it. Either way the branch exists after the
 * call, which is all callers depend on.
 *
 * Then the `.git` file is read (real gitdir) and DELETED — see the module header.
 */
export async function createWorktree(
    repo: RepoHandle,
    opts: { agentTaskId: number | string; branch: string; baseBranch: string },
): Promise<WorktreeResult> {
    const { worktreesDir } = loadConfig();
    const worktreePath = join(worktreesDir, String(opts.agentTaskId));

    return withRepoLock(repo.cachePath, async () => {
        await clearStale(repo, worktreePath);

        // Preferred strategy: CREATE the branch here (`-b`). If the ref already
        // exists — the collision window `resolveBranchName` cannot fully close,
        // or a caller reusing one branch per agentTaskId — fall back to CHECKING
        // OUT the existing branch (detection via `show-ref` rather than by
        // matching git's error text).
        if (await refExists(repo, opts.branch)) {
            log.debug("branch already exists; checking it out instead of creating", {
                branch: opts.branch,
            });
            await git(repo, ["worktree", "add", worktreePath, opts.branch]);
        } else {
            try {
                await git(repo, ["worktree", "add", worktreePath, "-b", opts.branch, opts.baseBranch]);
            } catch (createErr) {
                // Lost a race: the ref appeared between show-ref and `add`.
                // Retrying the checkout makes the outcome identical to above.
                if (await refExists(repo, opts.branch)) {
                    await git(repo, ["worktree", "add", worktreePath, opts.branch]);
                } else {
                    throw createErr;
                }
            }
        }

        // Record the real gitdir BEFORE deleting `.git` — it is the only place
        // that states it (bare: <repo>.git/worktrees/<n>, non-bare: <repo>/.git/worktrees/<n>).
        const gitDir = await readGitfile(worktreePath);
        if (!gitDir) {
            throw new Error(`worktree created but ${join(worktreePath, ".git")} is missing/invalid; cannot record gitdir`);
        }

        // The "no git repo contract": the container must not see any git dir.
        await rm(join(worktreePath, ".git"), { force: true });

        log.debug("worktree created", { worktreePath, gitDir, branch: opts.branch });
        return { worktreePath, gitDir, branch: opts.branch };
    });
}

/** `git show-ref` for the branch (any ref form) — used by the `worktree add -b` fallback. */
async function refExists(repo: RepoHandle, branch: string): Promise<boolean> {
    try {
        await execFileAsync(
            "git",
            ["-C", repo.cachePath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
            { env: gitEnv() },
        );
        return true;
    } catch (err) {
        const e = err as { code?: unknown };
        if (e.code === 1) return false;
        throw err;
    }
}

/**
 * Remove a task's worktree (Wave-3 teardown). Idempotent: a missing path is a
 * success. Runs under the repo lock and always `prune`s, so no stale
 * registration is left to break the next `worktree add` for this repo.
 *
 * After `worktree remove`, git does not delete the branch — it is left in place
 * on purpose: `merge.ts` merges it into `baseBranch` afterwards.
 */
export async function removeWorktree(repo: RepoHandle, worktreePath: string): Promise<void> {
    await withRepoLock(repo.cachePath, async () => {
        await destroyWorktreePath(repo, worktreePath);
    });
    log.debug("worktree removed", { worktreePath });
}

/** `git worktree list --porcelain` → the absolute paths it knows about. */
async function registeredWorktrees(repo: RepoHandle): Promise<string[]> {
    try {
        const out = await git(repo, ["worktree", "list", "--porcelain"]);
        return out
            .split("\n")
            .filter((line) => line.startsWith("worktree "))
            .map((line) => line.slice("worktree ".length));
    } catch {
        return [];
    }
}

/** Exported for tests/diagnostics: does the worktree dir exist? */
export async function worktreeExists(worktreePath: string): Promise<boolean> {
    return pathExists(worktreePath);
}

/** Exported for tests/diagnostics: entries of a worktree dir (used to assert no `.git`). */
export async function listWorktreeEntries(worktreePath: string): Promise<string[]> {
    return readdir(worktreePath);
}