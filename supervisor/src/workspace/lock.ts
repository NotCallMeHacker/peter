/**
 * Per-repo async mutex + boot-time worktree pruning.
 *
 * Repo-level git operations (`clone`, `fetch`, `worktree add/remove`, merges into
 * `baseBranch`) all funnel through `withRepoLock` keyed by the repo's cache path,
 * because two of them running at once race on the repo's `index.lock` and the
 * loser fails with a misleading error. Task-scoped ops (`status`/`add`/`commit`
 * via `--git-dir`/`--work-tree`) stay lock-free — they touch disjoint state.
 *
 * The mutex is in-process FIFO: a `Map<key, Promise>` of chain tails. A rejected
 * `fn` propagates to ITS caller only; the stored tail is always a settled-agnostic
 * continuation, so one failure never wedges the chain for the next waiter.
 *
 * Import direction: this module type-imports `RepoHandle` from `./repo.ts`
 * (`import type`, erased at compile time) while `repo.ts` runtime-imports
 * `withRepoLock` from here — no runtime cycle either way.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

import type { RepoHandle } from "./repo.ts";

const execFileAsync = promisify(execFile);

/** Tail of the wait chain per key. Entries are removed once they settle. */
const chains = new Map<string, Promise<void>>();

/**
 * Run `fn` with exclusive access to `key`, FIFO across concurrent callers.
 *
 * Errors from `fn` reject the promise returned to THAT caller; the internal chain
 * tail absorbs them so later waiters still run.
 */
export function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const result = prev.then(fn);
    // The stored tail never rejects: it exists only to sequence the next waiter.
    const tail = result.then(
        () => undefined,
        () => undefined,
    );
    chains.set(key, tail);
    void tail.then(() => {
        // Drop the entry once idle so the map doesn't grow per URL forever.
        if (chains.get(key) === tail) chains.delete(key);
    });
    return result;
}

/**
 * Drop stale `git worktree` bookkeeping for this repo (a crash can leave a
 * registration pointing at a path that no longer exists, which makes the next
 * `git worktree add` fail). Safe no-op when the repo isn't cloned yet.
 * Runs under the repo lock — call it at boot, before the first `worktree add`.
 */
export async function pruneRepoWorktrees(repo: RepoHandle): Promise<void> {
    await withRepoLock(repo.cachePath, async () => {
        try {
            await access(repo.cachePath);
        } catch {
            // Not cloned yet — nothing to prune; ensureRepo will create it fresh.
            return;
        }
        await execFileAsync("git", ["-C", repo.cachePath, "worktree", "prune"], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
    });
}
