/**
 * Repo-level git state: one mirror clone per URL under `config.gitCacheDir`.
 *
 * Design notes (plan.md §5, §0):
 * - The cache is ALWAYS a `--mirror` clone (`bare: true`), never a working tree.
 *   Only refs are needed here: worktrees are created with `git worktree add` from
 *   this bare repo (verified working — `git worktree add` accepts a bare/mirror
 *   clone as its source repo), and a mirror keeps `+refs/*:refs/*` so `fetch
 *   --prune` tracks the upstream exactly (deleted branches disappear too).
 * - Credentials NEVER go through argv (argv is world-readable in
 *   `docker inspect`/`ps`) and are never logged: an https token is echoed by a
 *   0700 `GIT_ASKPASS` helper script in a temp dir, an ssh key is a 0600 temp
 *   file referenced by `GIT_SSH_COMMAND`. Both live only for the duration of one
 *   git call and are removed in `finally`. `GIT_TERMINAL_PROMPT=0` makes git
 *   fail instead of hanging when auth is insufficient.
 * - Every clone/fetch takes the per-repo lock (`withRepoLock`, keyed by
 *   `cachePath`) so two tasks starting at once don't race on the same cache dir.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig } from "../config.ts";
import { log, redact } from "../log.ts";
import { withRepoLock } from "./lock.ts";

/** Credentials for one repo — applied per git call, never stored on disk beyond it. */
export interface GitAuth {
    /** Username for https (or a custom ssh identity name); optional. */
    username?: string | null;
    /** https token / password — delivered via the `GIT_ASKPASS` helper, never argv. */
    token?: string | null;
    /** Private key material for ssh URLs — written to a 0600 temp file for `GIT_SSH_COMMAND`. */
    sshKey?: string | null;
}

/** A resolved cache entry: where the bare mirror lives and what to run git against. */
export interface RepoHandle {
    /** `<gitCacheDir>/<sha256(url)[0..16]>` — the on-disk mirror directory. */
    cachePath: string;
    /** Git dir for `--git-dir=` style ops and `worktrees/<name>` bookkeeping. For a bare mirror this IS `cachePath`. */
    gitDir: string;
    /** Always `true` — see the module header: the cache is a mirror clone, not a worktree. */
    bare: boolean;
}

/** Hex sha256 of the URL, first 16 chars — short, collision-safe enough for a local cache. */
function hashUrl(url: string): string {
    return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Stable cache path for a URL: `<config.gitCacheDir>/<sha256(url) first 16 hex>`.
 * Exported so other workspace modules (worktree/merge) can key locks and derive
 * worktree gitdirs off the same value without recomputing the hash.
 */
export function repoCachePath(url: string): string {
    return join(loadConfig().gitCacheDir, hashUrl(url));
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/** Single-quote for embedding in a shell script body. */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

interface PreparedAuth {
    /** Extra env for the git child process (askpass path / GIT_SSH_COMMAND). */
    env: NodeJS.ProcessEnv;
    /** Removes the temp dir; safe to call once, always. */
    cleanup: () => Promise<void>;
}

const NO_AUTH: PreparedAuth = { env: {}, cleanup: async () => {} };

/**
 * Materialise credentials as files (never argv, never in the git command line):
 * a 0700 askpass script for https tokens and/or a 0600 key file for ssh.
 * The caller MUST run `cleanup()` in a `finally`.
 */
async function prepareAuth(auth: GitAuth | null | undefined): Promise<PreparedAuth> {
    if (!auth || (!auth.token && !auth.sshKey)) return NO_AUTH;
    const dir = await mkdtemp(join(tmpdir(), "peter-git-auth-"));
    const env: NodeJS.ProcessEnv = {};
    try {
        if (auth.token) {
            const askpass = join(dir, "askpass.sh");
            // git asks for username and password separately on https; answer each.
            const script = [
                "#!/bin/sh",
                "# peter askpass helper — 0700, removed right after the git call.",
                "case \"$1\" in",
                `    *[Uu]sername*) printf '%s\\n' ${shellQuote(auth.username ?? "x-access-token")} ;;`,
                `    *) printf '%s\\n' ${shellQuote(auth.token)} ;;`,
                "esac",
                "",
            ].join("\n");
            await writeFile(askpass, script, { mode: 0o700 });
            await chmod(askpass, 0o700);
            env.GIT_ASKPASS = askpass;
        }
        if (auth.sshKey) {
            const keyPath = join(dir, "id_key");
            const key = auth.sshKey.endsWith("\n") ? auth.sshKey : `${auth.sshKey}\n`;
            await writeFile(keyPath, key, { mode: 0o600 });
            await chmod(keyPath, 0o600);
            // IdentitiesOnly+BatchMode: only this key, never an interactive prompt.
            env.GIT_SSH_COMMAND =
                `ssh -i ${shellQuote(keyPath)} -o IdentitiesOnly=yes -o BatchMode=yes` +
                " -o StrictHostKeyChecking=accept-new";
        }
    } catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
    return { env, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

interface GitResult {
    stdout: string;
    stderr: string;
}

/**
 * Run git with `GIT_TERMINAL_PROMPT=0` (fail instead of hanging on a prompt) and
 * extra auth env. The error message is passed through `redact()` — git echoes its
 * arguments (and sometimes URL contents) back in failure output.
 */
function runGit(args: readonly string[], authEnv: NodeJS.ProcessEnv = {}): Promise<GitResult> {
    return new Promise<GitResult>((resolve, reject) => {
        const child = spawn("git", [...args], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...authEnv },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            const detail = stderr.trim() || stdout.trim() || "(no output)";
            reject(new Error(String(redact(`git ${args[0]} failed (exit ${code}): ${detail}`))));
        });
    });
}

/**
 * Ensure a mirror clone of `url` exists in the cache and is up to date.
 *
 * - First call: `git clone --mirror <url> <cachePath>` (partial clones are removed
 *   on failure so the next attempt starts clean).
 * - Later calls: `git fetch --prune` against the cached mirror.
 * - The whole operation runs under the repo lock keyed by `cachePath`.
 *
 * @returns the handle other workspace modules use for worktrees/merges.
 */
export async function ensureRepo(url: string, auth?: GitAuth | null): Promise<RepoHandle> {
    const cachePath = repoCachePath(url);
    await withRepoLock(cachePath, async () => {
        const prepared = await prepareAuth(auth);
        try {
            await mkdir(dirname(cachePath), { recursive: true });
            if (!(await pathExists(cachePath))) {
                log.debug("cloning repo", { url, cachePath });
                try {
                    await runGit(["clone", "--mirror", "--", url, cachePath], prepared.env);
                } catch (err) {
                    // A half-written cache dir would make the next call take the
                    // fetch branch against garbage — remove it and let the retry re-clone.
                    await rm(cachePath, { recursive: true, force: true });
                    throw err;
                }
            } else {
                log.debug("fetching repo", { url, cachePath });
                await runGit(["-C", cachePath, "fetch", "--prune"], prepared.env);
            }
        } finally {
            await prepared.cleanup();
        }
    });
    return { cachePath, gitDir: cachePath, bare: true };
}
