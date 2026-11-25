/**
 * Task-scoped git operations against a worktree whose `.git` FILE was deleted.
 *
 * The Supervisor deletes a worktree's `.git` pointer before the worktree is mounted
 * into an agent container (plan.md §0: "`.git` must not be reachable from
 * `/workspace`"), so nothing in the container can run git. Every Supervisor-side
 * operation states the repository explicitly instead: each call runs
 *
 *     git -c core.hooksPath=/dev/null --git-dir=<gitDir> --work-tree=<worktreePath> <args>
 *
 * with the child process `cwd` set to `worktreePath`. plan.md §5 verified that
 * `status`, `add` and `commit` all work this way after `.git` removal.
 *
 * Design rules:
 * - `execFile("git", argv)` only — never a shell string, never interpolated user
 *   data on a command line. Commit messages, branch names and pathspecs each travel
 *   as their own argv entry (argv is a string array; shell metacharacters are inert).
 * - `-c core.hooksPath=/dev/null` on EVERY call. Verified: a hook in the cache's
 *   `hooks/` dir (the commondir shared by all linked worktrees) DOES run for commits
 *   made through `--git-dir/--work-tree` — a failing `pre-commit` blocked one — so a
 *   stray hook would turn a Supervisor-owned commit into a confusing `gitFailure`.
 *   The Supervisor takes no part in any hook contract with the agent (hooks are not
 *   cloned into the cache either), so hooks are neutralised for determinism.
 * - These operations are TASK-scoped: they touch one task's worktree/index only and
 *   therefore run CONCURRENTLY, without the repo lock (plan.md §5, lock.ts bullet).
 *   Repo-level operations (`fetch`, `worktree add/remove`, `merge` into `baseBranch`)
 *   live behind `withRepoLock` in repo.ts/merge.ts.
 * - Commits happen only on the task's own branch: the caller supplies the
 *   gitDir/worktree context. This module never checks out, switches, pushes or merges.
 * - All operations are local, so no credentials are involved here — GIT_ASKPASS /
 *   ssh-key handling stays in repo.ts. `GIT_TERMINAL_PROMPT=0` is set so any
 *   unexpected prompt (e.g. an LFS smudge) fails fast instead of hanging.
 * - Nonzero exit → an `Error` with `.code === "gitFailure"` and a redacted stderr
 *   tail, except where the signature states structured results: `gitRun` always
 *   reports the exit code, and `gitCommit` returns `{ committed: false }` when there
 *   is nothing to commit (detected up front via `git status --porcelain`).
 */

import { execFile } from "node:child_process";

import { log, redact } from "../log.ts";

/** Inputs for one task-scoped git invocation. */
export interface GitRunOpts {
    /**
     * The worktree's REAL gitdir (its `.git` file was deleted), e.g.
     * `<repo>/.git/worktrees/<name>` or `<repo>.git/worktrees/<name>` for a bare cache.
     */
    gitDir: string;
    /** The worktree checkout the operation applies to; also the child process cwd. */
    worktreePath: string;
}

/** Error thrown for git failures: `.code === "gitFailure"`, `.stderr` is the redacted tail. */
interface GitFailure extends Error {
    code: "gitFailure";
    stderr: string;
}

/** Max captured stdout/stderr per git call — a large `git diff` must not fail as ENOBUFS. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Collapse newlines (one error, one line) and keep only the tail of long output. */
function tailOf(text: string): string {
    const oneLine = text.replace(/\r?\n/g, "\\n").trim();
    const tail = oneLine.length > 600 ? `…${oneLine.slice(-600)}` : oneLine;
    return String(redact(tail));
}

/** Build a `gitFailure` carrying `.code` and a redacted stderr tail in the message. */
function failure(what: string, text: string): GitFailure {
    const tail = tailOf(text);
    const err = new Error(`git ${what} failed${tail ? `: ${tail}` : ""}`) as GitFailure;
    err.code = "gitFailure";
    err.stderr = tail;
    return err;
}

/** Throw `gitFailure` unless the structured result reports exit code 0. */
function ensureOk(what: string, r: { code: number; stdout: string; stderr: string }): void {
    if (r.code !== 0) throw failure(`${what} (exit ${r.code})`, r.stderr || r.stdout);
}

/**
 * Primitive every other export builds on: run git with explicit
 * `--git-dir`/`--work-tree` and report `{ code, stdout, stderr }`.
 *
 * Resolves with git's exit code even when nonzero — callers (and merge.ts, which
 * probes expected-to-fail commands like `merge-base --is-ancestor`) decide what is
 * an error. Only a failure to START git (missing binary, output over MAX_BUFFER)
 * rejects, as a `gitFailure`.
 */
export async function gitRun(opts: GitRunOpts, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const argv = [
        "-c",
        "core.hooksPath=/dev/null",
        `--git-dir=${opts.gitDir}`,
        `--work-tree=${opts.worktreePath}`,
        ...args,
    ];
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            argv,
            {
                cwd: opts.worktreePath,
                encoding: "utf8",
                maxBuffer: MAX_BUFFER,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
            },
            (error, stdout, stderr) => {
                if (!error) {
                    resolve({ code: 0, stdout, stderr });
                    return;
                }
                if (typeof error.code === "number") {
                    resolve({ code: error.code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
                    return;
                }
                // No exit code exists (git could not start / output overflowed).
                reject(failure(args[0] ?? "run", error.message));
            },
        );
    });
}

/** `git status --porcelain` output — empty string means a clean worktree. */
export async function gitStatus(opts: GitRunOpts): Promise<string> {
    const r = await gitRun(opts, ["status", "--porcelain"]);
    ensureOk("status", r);
    return r.stdout;
}

/** Unstaged diff (`staged: false`, default) or the index-vs-HEAD diff (`staged: true`). */
export async function gitDiff(opts: GitRunOpts, staged?: boolean): Promise<string> {
    const r = await gitRun(opts, staged ? ["diff", "--staged"] : ["diff"]);
    ensureOk("diff", r);
    return r.stdout;
}

/** `git log` of the worktree's branch, newest first. `limit` defaults to 20 commits. */
export async function gitLog(opts: GitRunOpts, limit?: number): Promise<string> {
    const count = limit ?? 20;
    if (!Number.isInteger(count) || count < 1) {
        throw new Error(`gitLog: limit must be a positive integer, got ${String(limit)}`);
    }
    const r = await gitRun(opts, ["log", "-n", String(count)]);
    ensureOk("log", r);
    return r.stdout;
}

/**
 * Stage changes on the task's branch.
 *
 * Semantics of `paths`:
 * - `[]` (the default, equivalent to `git add -A`) stages EVERYTHING: new,
 *   modified and deleted files. Use this before committing a finished worktree —
 *   it is what `commitAllAndMerge` does.
 * - Non-empty → `git add -- <paths…>`: entries are pathspecs, never flags
 *   (`--` keeps a path that starts with `-` from being parsed as an option).
 *   A pathspec that matches nothing is a git error by design; for deletions stage
 *   with `[]` instead, since the path no longer exists on disk.
 */
export async function gitAdd(opts: GitRunOpts, paths: string[]): Promise<void> {
    const args = paths.length === 0 ? ["add", "-A"] : ["add", "--", ...paths];
    const r = await gitRun(opts, args);
    ensureOk("add", r);
}

/**
 * Commit everything currently staged/uncommitted on the task's branch.
 *
 * `git status --porcelain` is checked first: a clean tree is the normal no-op and
 * returns `{ committed: false }` without running `git commit` at all (plan.md's
 * pinned contract — the no-op must not throw). If the tree races clean in between,
 * git's own "nothing to commit" is caught the same way. Any other failure throws
 * `gitFailure` (including a missing git identity: the Supervisor image must have
 * `user.name`/`user.email` or `GIT_AUTHOR_*`/`GIT_COMMITTER_*` configured).
 *
 * `message` travels as its own argv entry (`-m`, message) — never interpolated.
 */
export async function gitCommit(opts: GitRunOpts, message: string): Promise<{ committed: boolean; sha?: string }> {
    if (!message?.trim()) throw new Error("gitCommit: message must be a non-empty string");
    const before = await gitRun(opts, ["status", "--porcelain"]);
    ensureOk("status", before);
    if (before.stdout.trim().length === 0) return { committed: false };

    const r = await gitRun(opts, ["commit", "-m", message]);
    if (r.code !== 0) {
        if (/nothing to commit/i.test(`${r.stdout}\n${r.stderr}`)) return { committed: false };
        throw failure(`commit (exit ${r.code})`, r.stderr || r.stdout);
    }
    const head = await gitRun(opts, ["rev-parse", "HEAD"]);
    ensureOk("rev-parse", head);
    const sha = head.stdout.trim();
    log.debug("committed", { worktree: opts.worktreePath, sha });
    return { committed: true, sha };
}

/** True when `git status --porcelain` reports any staged, unstaged or untracked change. */
export async function gitHasChanges(opts: GitRunOpts): Promise<boolean> {
    const r = await gitRun(opts, ["status", "--porcelain"]);
    ensureOk("status", r);
    return r.stdout.trim().length > 0;
}
