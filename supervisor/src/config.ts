/**
 * Runtime configuration for the supervisor's bridge connection.
 *
 * Everything has a working default for local dev: the instance id, the bridge
 * address (the web app's /api/agent-runner) and the registry directory that
 * holds this instance's keypair and public-key entry. All of it is overridable
 * through env vars (supervisor/.env, loaded by `npm start`).
 */

import { resolve } from "node:path";

/** Repo-root `secrets/instances/` — two levels up from `src/` (supervisor/../secrets). */
const DEFAULT_REGISTRY_DIR = resolve(new URL("../../secrets/instances", import.meta.url).pathname);

export interface Config {
    /** Stable identity of this instance, e.g. "dev-a1". B's registry key. */
    instanceId: string;
    /** Bridge URL, e.g. ws://localhost:3000/api/agent-runner (dev). */
    bridgeUrl: string;
    /** Directory for the keypair + local public-key entry. */
    registryDir: string;
    /** CA bundle for wss:// (PEM path). Required when bridgeUrl is wss://. */
    caPath: string | undefined;
    /** ms B waits for our auth answer after the challenge. */
    authTimeoutMs: number;
    /** ms between reconnect attempts after an unexpected drop. */
    reconnectMs: number;
    /** ms between supervisor.status heartbeats once authenticated. */
    heartbeatMs: number;
    /** Docker socket of the Supervisor's own inner (DinD) daemon. */
    dockerHost: string;
    /** ms to keep retrying docker ping at boot — the inner daemon needs 10-20s, never fail fast. */
    dockerReadyTimeoutMs: number;
    /** Bare/mirror clone cache, bind-mounted from the host (host addressable by the inner daemon). */
    gitCacheDir: string;
    /** Dir holding the per-task MCP sockets (one socket file bind-mounted into the container). */
    socketsDir: string;
    /** Parent dir of the per-task worktrees (mounted at /workspace, no .git inside). */
    worktreesDir: string;
    /** Parent dir of per-task logs (agent dir mount + container.log + startup.log). */
    logsDir: string;
    /** Default agent image (name without tag). */
    agentImage: string;
    /** Default agent image tag. Payload container.image wins when set. */
    agentImageTag: string;
    /** Optional comma-separated allowlist of images a payload may name (beyond agentImage). */
    agentImageAllowlist: string[];
    /** ms of bridge outage before every live container is paused (never killed). */
    offlinePauseMs: number;
    /** ms between stats polls per live container. */
    containerPollMs: number;
    /** Test mode: keep containers after completion instead of removing them. */
    keepContainersOnComplete: boolean;
    /** Concurrent task capacity; beyond it supervisor.status reports `full`. */
    maxConcurrentTasks: number;
    /** Agent runtime — only "pi" in the POC; "omp" is rejected as invalidPayload. */
    agentRuntime: "pi" | "omp";
    /** ms budget for a task's startupScript before it counts as failed. */
    startupScriptTimeoutMs: number;
}

/** Container-absolute defaults — the same code runs on a host and in the image, nothing may assume the repo path. */
const defaultDir = (env: string | undefined, fallback: string): string =>
    env?.trim() || fallback;

export function loadConfig(): Config {
    const bridgeUrl = process.env.BRIDGE_URL?.trim() || "ws://localhost:3000/api/agent-runner";
    if (bridgeUrl.startsWith("wss://") && !process.env.BRIDGE_CA_PATH?.trim()) {
        // Refusing to skip verification: wss:// without a trust anchor would
        // accept any MITM as "B", defeating the one-sided trust we rely on.
        throw new Error("BRIDGE_CA_PATH must point to B's CA certificate when BRIDGE_URL is wss://");
    }
    return {
        instanceId: process.env.INSTANCE_ID?.trim() || "dev-a1",
        bridgeUrl,
        registryDir: process.env.REGISTRY_DIR?.trim() || DEFAULT_REGISTRY_DIR,
        caPath: process.env.BRIDGE_CA_PATH?.trim() || undefined,
        authTimeoutMs: Number(process.env.AUTH_TIMEOUT_MS ?? 5_000),
        reconnectMs: Number(process.env.RECONNECT_MS ?? 5_000),
        heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 30_000),
        dockerHost: process.env.DOCKER_HOST?.trim() || "/var/run/docker.sock",
        dockerReadyTimeoutMs: Number(process.env.DOCKER_READY_TIMEOUT_MS ?? 60_000),
        gitCacheDir: defaultDir(process.env.GIT_CACHE_DIR, "/var/lib/peter/git"),
        socketsDir: defaultDir(process.env.SOCKETS_DIR, "/var/lib/peter/sockets"),
        worktreesDir: defaultDir(process.env.WORKTREES_DIR, "/var/lib/peter/worktrees"),
        logsDir: defaultDir(process.env.LOGS_DIR, "/var/lib/peter/logs"),
        agentImage: process.env.AGENT_IMAGE?.trim() || "peter-agent",
        agentImageTag: process.env.AGENT_IMAGE_TAG?.trim() || "dev",
        agentImageAllowlist: (process.env.AGENT_IMAGE_ALLOWLIST ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        offlinePauseMs: Number(process.env.OFFLINE_PAUSE_MS ?? 30_000),
        containerPollMs: Number(process.env.CONTAINER_POLL_MS ?? 5_000),
        keepContainersOnComplete: /^(1|true|yes)$/i.test(process.env.KEEP_CONTAINERS_ON_COMPLETE ?? ""),
        maxConcurrentTasks: Number(process.env.MAX_CONCURRENT_TASKS ?? 4),
        agentRuntime: (process.env.AGENT_RUNTIME?.trim() as "pi" | "omp" | undefined) || "pi",
        startupScriptTimeoutMs: Number(process.env.STARTUP_SCRIPT_TIMEOUT_MS ?? 600_000),
    };
}
