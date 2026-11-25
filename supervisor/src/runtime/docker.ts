/**
 * Docker client singleton + readiness probing (plan §4 `[W1/A]` `runtime/docker.ts`).
 *
 * One `dockerode` client for the whole supervisor, built from `config.dockerHost`
 * (the Supervisor's own inner DinD daemon — never a host socket, plan §0).
 *
 * Readiness is a retry loop, never fail-fast: verified that inside a fresh DinD
 * container `/var/run/docker.sock` does not exist for the first ~10-20s while
 * `dockerd` boots (`dial unix /var/run/docker.sock: connect: no such file or
 * directory` on an otherwise healthy daemon). `pingWithBackoff()` therefore keeps
 * probing until `dockerReadyTimeoutMs`, and only `ensureDockerReady()` throws —
 * boot code opts into that.
 *
 * `isDockerOk()` is the last observed ping result; track C's `CapacitySource`
 * (`status/supervisorStatus.ts`) reads it via injection for `supervisor.status`
 * (`data.dockerOk`). This module must not import `status/*` (track C owns it), so
 * the value only flows outward through this getter.
 */

import Docker from "dockerode";
import { loadConfig } from "../config.ts";
import { log } from "../log.ts";

const config = loadConfig();

/** Client options derived from `config.dockerHost` (unix socket or tcp/http URL). */
function clientOptions(host: string): Docker.DockerOptions {
    if (host.startsWith("unix://")) return { socketPath: host.slice("unix://".length) };
    const url = /^https?:\/\//.test(host) || host.startsWith("tcp://") ? new URL(host.replace(/^tcp:\/\//, "http://")) : null;
    if (url) {
        return {
            protocol: url.protocol === "https:" ? "https" : "http",
            host: url.hostname,
            port: Number(url.port || (url.protocol === "https:" ? 443 : 2375)),
        };
    }
    // Plain filesystem path — the DinD default `/var/run/docker.sock`.
    return { socketPath: host };
}

let client: Docker | undefined;

/** Lazy singleton Docker client (dockerode 5) from `config.dockerHost`. */
export function getDocker(): Docker {
    client ??= new Docker(clientOptions(config.dockerHost));
    return client;
}

/** Last observed ping result; `undefined` until the first probe finishes. */
let lastPingOk: boolean | undefined;

/** Probe the daemon once. True on success; never throws. */
async function pingOnce(timeoutMs: number): Promise<boolean> {
    // Raw dial of /_ping: a bare `ping()` has no per-attempt timeout, and one
    // attempt hanging on a half-open socket (stale DinD boot) would eat the whole
    // budget — so the dial races a timer instead.
    const probe = new Promise<void>((resolve, reject) => {
        getDocker().modem.dial({ path: "/_ping", method: "GET", statusCodes: { 200: true } }, (err) =>
            err ? reject(err) : resolve(),
        );
    });
    // The timer may win the race — keep the late dial outcome handled.
    probe.catch(() => undefined);
    const timedOut = Symbol("ping-timeout");
    try {
        const winner = await Promise.race([
            probe.then(() => "ok" as const),
            new Promise((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
        ]);
        if (winner === timedOut) {
            lastPingOk = false;
            log.debug("docker ping timed out", { timeoutMs });
            return false;
        }
        lastPingOk = true;
        return true;
    } catch (err) {
        lastPingOk = false;
        log.debug("docker ping failed", { error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}

/**
 * Retry pings until one succeeds or `timeoutMs` elapses (default
 * `config.dockerReadyTimeoutMs`). Returns true iff the daemon answered in time;
 * does not throw — a missing socket during DinD boot is normal, not an error.
 */
export async function pingWithBackoff(timeoutMs?: number): Promise<boolean> {
    const budget = timeoutMs ?? config.dockerReadyTimeoutMs;
    const deadline = Date.now() + budget;
    let delayMs = 250;
    for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        if (await pingOnce(Math.min(2_000, Math.max(remaining, 100)))) return true;
        const wait = Math.min(delayMs, Math.max(deadline - Date.now(), 0));
        if (wait <= 0) return false;
        await new Promise((resolve) => setTimeout(resolve, wait));
        delayMs = Math.min(delayMs * 2, 2_000);
    }
}

/**
 * Last observed ping result for `supervisor.status`
 * (`CapacitySource.dockerOk`). `true` only after a successful probe; before the
 * first probe it reads `true` so a boot-time status is not falsely "error".
 */
export function isDockerOk(): boolean {
    return lastPingOk ?? true;
}

/**
 * Ping until ready or timeout, then return true / throw. Boot paths (bringup)
 * call this so a dead daemon surfaces as one clear message instead of N opaque
 * container-creation failures.
 */
export async function ensureDockerReady(timeoutMs?: number): Promise<boolean> {
    const budget = timeoutMs ?? config.dockerReadyTimeoutMs;
    if (await pingWithBackoff(budget)) return true;
    throw new Error(
        `docker daemon not ready after ${budget}ms: cannot reach ${config.dockerHost} — ` +
            `if this is a fresh DinD boot the daemon may still be starting; ` +
            `raise DOCKER_READY_TIMEOUT_MS or check the supervisor's dockerd log`,
    );
}
