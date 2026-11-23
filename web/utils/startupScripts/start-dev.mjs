#!/usr/bin/env node
/**
 * Dev orchestration: `next dev` + one supervisor instance (service A).
 *
 * `npm run dev` in web/ starts the stack (supabase, no web container) and then
 * this script, which runs the Next dev server on :3000 and the supervisor from
 * ../supervisor in parallel. The supervisor dials ws://localhost:3000/
 * /api/agent-runner, so the bridge only accepts it once Next is listening —
 * until then the supervisor just retries (RECONNECT_MS), so start order does
 * not matter.
 *
 * Lives in web/utils/startupScripts/ so it is not mistaken for app code or build
 * tooling: `utils/startupScripts` holds the local-development harness (no
 * imports from it at runtime), the app itself stays under app/ and server/.
 *
 * Why a node script instead of `concurrently` / `&`: no new dependency, one
 * prefixed log stream, and Ctrl+C (or the dev server dying) tears both down
 * instead of orphaning a backgrounded process.
 *
 * Knobs:
 *   SKIP_SUPERVISOR=1   only run `next dev` (e.g. to test the web UI alone)
 *   SUPERVISOR_DIR=...  supervisor checkout location (default ../supervisor)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** web/ — three levels up from web/utils/startupScripts/start-dev.mjs. */
const webDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const supervisorDir = resolve(process.env.SUPERVISOR_DIR?.trim() || join(webDir, "..", "supervisor"));

/** Grace period between SIGTERM and SIGKILL when shutting down. */
const KILL_GRACE_MS = 5_000;

/** @type {Map<string, import("node:child_process").ChildProcess>} */
const children = new Map();
let shuttingDown = false;

/**
 * Spawn a child with inherited stdio (so its output interleaves in the same
 * terminal) and register it for shutdown handling.
 */
function start(name, command, args, cwd) {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    children.set(name, child);
    child.on("error", (error) => {
        console.error(`[dev] ${name} failed to start: ${error.message}`);
        children.delete(name);
    });
    child.on("exit", (code, signal) => {
        children.delete(name);
        if (shuttingDown) return;
        const how = signal ? `signal ${signal}` : `code ${code}`;
        console.log(`[dev] ${name} exited (${how})`);
    });
    return child;
}

/** Ask every child to stop, escalating to SIGKILL after the grace period. */
async function shutdown(signal = "SIGTERM") {
    if (shuttingDown) return;
    shuttingDown = true;

    const running = Array.from(children.entries()).filter(([, child]) => child.exitCode === null && !child.killed);
    for (const [name, child] of running) {
        console.log(`[dev] stopping ${name}`);
        child.kill(signal);
    }

    const waitAll = Promise.all(
        running.map(
            ([, child]) =>
                new Promise((done) => {
                    if (child.exitCode !== null) return done();
                    child.once("exit", () => done());
                }),
        ),
    );

    const timer = setTimeout(() => {
        for (const [name, child] of running) {
            if (child.exitCode === null) {
                console.log(`[dev] ${name} did not stop, sending SIGKILL`);
                child.kill("SIGKILL");
            }
        }
    }, KILL_GRACE_MS);

    await waitAll;
    clearTimeout(timer);
}

// Ctrl+C / terminal close in the foreground process group reaches the children
// too, but forwarding keeps a non-interactive run (`npm run dev | tee`) from
// leaking the supervisor.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
        void shutdown(signal).then(() => process.exit(0));
    });
}

const next = start("next dev", process.execPath, [join(webDir, "node_modules/next/dist/bin/next"), "dev"], webDir);

if (process.env.SKIP_SUPERVISOR?.trim()) {
    console.log("[dev] SKIP_SUPERVISOR set — not starting the supervisor");
} else if (!existsSync(join(supervisorDir, "src/index.ts"))) {
    console.warn(`[dev] no supervisor at ${supervisorDir} — running next dev alone (set SKIP_SUPERVISOR=1 to silence)`);
} else {
    console.log(`[dev] starting supervisor from ${supervisorDir}`);
    // Same invocation as supervisor/package.json "start": node directly runs
    // the .ts entry (native type stripping, engines: node >=24.6) and loads
    // the repo-root + supervisor env files when present.
    start(
        "supervisor",
        process.execPath,
        ["--env-file-if-exists=../.env", "--env-file-if-exists=.env", "src/index.ts"],
        supervisorDir,
    );
}

// `next dev` owns the lifecycle: when it exits, the dev session is over.
next.on("exit", (code, signal) => {
    void shutdown().then(() => process.exit(signal ? 1 : (code ?? 0)));
});
