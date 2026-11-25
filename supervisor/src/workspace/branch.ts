/**
 * Branch naming for task worktrees (plan.md §5, `[W1/B] branch.ts`).
 *
 * Two entry points:
 * - `formatBranchName` is pure string math: the caller-provided branch
 *   (`git.branchName` from the payload) wins verbatim, else the name is built as
 *   `<issueId>-<slug>` on the first attempt and `<issueId>-<attempt>-<slug>`
 *   afterwards (`42-fix-login-redirect` / `42-2-fix-login-redirect`), slugified
 *   to lowercase `[a-z0-9-]` and capped at 60 chars (the slug is truncated, the
 *   numeric prefix never is, and the name never ends in `-`).
 * - `resolveBranchName` additionally collision-checks the result against the
 *   repo's refs and appends `-2`, `-3`, … until it is free, so `worktree add -b`
 *   cannot fail on an existing ref.
 *
 * No repo-level mutation happens here — only a read-only `show-ref` — so this
 * module deliberately does NOT take the repo lock (the ref check races nothing;
 * `worktree add` under the lock in `worktree.ts` is the serialization point that
 * closes the name-check → create window).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { log, redact } from "../log.ts";
import type { RepoHandle } from "./repo.ts";

const execFileAsync = promisify(execFile);

/** Plan §5: total branch length ≤ ~60 chars. */
const MAX_BRANCH_LENGTH = 60;

/** Slug fallback when `taskName` slugifies to nothing (e.g. all punctuation). */
const FALLBACK_SLUG = "task";

/** Per-call git env: never prompt interactively — a prompt would hang the caller. */
function gitEnv(): NodeJS.ProcessEnv {
    return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

/**
 * Lowercase, keep alphanumerics, turn every other run into a single `-`,
 * trim leading/trailing `-`.
 */
function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** Truncate `name` so `name + suffix` fits the cap, never ending in `-`. */
function withSuffix(name: string, suffix: string): string {
    if (name.length + suffix.length <= MAX_BRANCH_LENGTH) return name + suffix;
    const head = name.slice(0, Math.max(0, MAX_BRANCH_LENGTH - suffix.length)).replace(/-+$/g, "");
    return head + suffix;
}

/**
 * Build the branch name for a task attempt (pure — no git calls).
 *
 * @param callerBranch `git.branchName` from the payload; when non-empty it wins
 *   verbatim (not slugified, not prefixed).
 * @returns the branch name, ≤ 60 chars.
 */
export function formatBranchName(
    issueId: number | string,
    attempt: number,
    taskName: string,
    callerBranch?: string | null,
): string {
    if (callerBranch && callerBranch.trim() !== "") return callerBranch;

    const prefix = attempt >= 2 ? `${issueId}-${attempt}` : `${issueId}`;
    const slug = slugify(taskName) || FALLBACK_SLUG;
    // The numeric prefix is never truncated; only the slug gives up room.
    const budget = MAX_BRANCH_LENGTH - prefix.length - 1;
    if (budget <= 0) return prefix;
    const trimmed = slug.slice(0, budget).replace(/-+$/g, "");
    return trimmed ? `${prefix}-${trimmed}` : prefix;
}

/**
 * `git show-ref --verify --quiet refs/heads/<branch>` → taken?
 *
 * Exit code 1 means "ref does not exist" (free). Anything else (missing repo,
 * git not found, malformed name) is a real failure and throws — silently
 * treating it as "free" would let `worktree add` fail later with less context.
 */
async function refTaken(repo: RepoHandle, branch: string): Promise<boolean> {
    try {
        await execFileAsync(
            "git",
            ["-C", repo.cachePath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
            { env: gitEnv() },
        );
        return true;
    } catch (err) {
        const e = err as { code?: unknown; stderr?: string | Buffer; message?: string };
        if (e.code === 1) return false;
        throw new Error(
            String(redact(`branch ref check failed for "${branch}": ${String(e.stderr ?? e.message ?? err)}`)),
        );
    }
}

/**
 * `formatBranchName` + collision check against `refs/heads/*`.
 *
 * The caller-provided name is the BASE that wins — if that exact ref already
 * exists (a retry, or the branch predates this attempt) the same `-2`/`-3`
 * suffixing applies, because `worktree add -b` cannot reuse it.
 *
 * Read-only, so lock-free; see the module header.
 */
export async function resolveBranchName(
    repo: RepoHandle,
    issueId: number | string,
    attempt: number,
    taskName: string,
    callerBranch?: string | null,
): Promise<string> {
    const base = formatBranchName(issueId, attempt, taskName, callerBranch);
    let candidate = base;
    for (let n = 2; (await refTaken(repo, candidate)) && n <= 1000; n += 1) {
        candidate = withSuffix(base, `-${n}`);
    }
    if (candidate !== base) {
        log.debug("branch name collided with an existing ref; suffixed", { base, candidate });
    }
    return candidate;
}