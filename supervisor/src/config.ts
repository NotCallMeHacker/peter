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
}

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
    };
}
