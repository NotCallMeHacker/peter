/**
 * Supervisor entry point (service A).
 *
 * Boots the instance identity (Ed25519 keypair, generated once on first
 * start), then keeps one authenticated WSS session to B's /api/agent-runner
 * alive: connect -> sign B's nonce -> stay on, heartbeating supervisor.status
 * and answering B's requests (today: supervisor.status; agent.* →
 * notImplemented until the Docker runtime lands).
 *
 * WebSocket transport: the `ws` package (custom CA via BRIDGE_CA_PATH).
 *
 * Reconnects forever with a fixed backoff (RECONNECT_MS) — B never dials A
 * (A opens no port), so A is the only side that can re-establish the channel.
 *
 *   node --env-file-if-exists=../.env --env-file-if-exists=.env src/index.ts
 */

import { connectOnce, type Session, type SessionState } from "./client.ts";
import { loadConfig } from "./config.ts";
import { ensureKeys } from "./keys.ts";
import { SCHEMA_VERSION, type Envelope } from "./protocol.ts";

const config = loadConfig();
const keys = ensureKeys(config);

/** `supervisor.status` payload (webCommunicationSchemas.md → S->W | Supervisor Status). */
export interface SupervisorStatus {
    status: "available" | "full" | "error" | "unavailable";
    statusMessage: string;
    data: Record<string, unknown> | null;
}

/** Current supervisor status payload. */
function statusPayload(): SupervisorStatus {
    return {
        status: "available",
        statusMessage: "bridge link up",
        data: {
            instanceId: config.instanceId,
            schemaVersion: SCHEMA_VERSION,
            uptimeSeconds: Math.round(process.uptime()),
            startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        },
    };
}

/** Answer schema requests from B. Throws to produce an error frame. */
function handleRequest(frame: Envelope): SupervisorStatus {
    if (frame.action === "supervisor.status") return statusPayload();
    // Per schema rules: unknown action on a request → error code unknownAction.
    const error = new Error(`No handler registered for action "${frame.action}"`) as Error & { code: string };
    error.code = "unknownAction";
    throw error;
}

let heartbeat: NodeJS.Timeout | undefined;

function startHeartbeat(session: Session): void {
    stopHeartbeat();
    heartbeat = setInterval(() => {
        session.send("supervisor.status", statusPayload());
    }, config.heartbeatMs);
}

function stopHeartbeat(): void {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
}

/** Errors arrive as Error, AggregateError (empty message) or strings. */
function describeError(error: unknown): string {
    if (error instanceof AggregateError && error.errors.length > 0) {
        return error.errors.map(describeError).join("; ");
    }
    if (error instanceof Error) return error.message || String(error);
    return String(error);
}

/** One connection cycle: connect + authenticate + run until closed. */
async function runSession(): Promise<void> {
    let closed!: () => void;
    const done = new Promise<void>((resolve) => {
        closed = resolve;
    });
    const session = await connectOnce({
        config,
        keys,
        onRequest: handleRequest,
        onMessage: (frame) => {
            // Fire-and-forget from B: only supervisor.status broadcasts exist
            // in the schema today; anything else is logged and dropped.
            console.warn(`[supervisor] dropped message with action "${frame.action}"`);
        },
        onStateChange: (state: SessionState) => {
            console.log(`[supervisor] session state: ${state}`);
        },
        onClose: () => {
            stopHeartbeat();
            closed();
        },
    });
    // Initial heartbeat right away (B also asks once on its own).
    session.send("supervisor.status", statusPayload());
    startHeartbeat(session);
    // Resolves when the socket dies — the reconnect loop then takes over.
    await done;
}

/** Forever: one session at a time, reconnecting on any failure until shutdown. */
async function main(): Promise<void> {
    console.log(`[supervisor] instance "${config.instanceId}" -> ${config.bridgeUrl}`);
    let running = true;
    const shutdown = () => {
        running = false;
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    while (running) {
        try {
            await runSession();
        } catch (error) {
            console.error(`[supervisor] session failed: ${describeError(error)}`);
        }
        stopHeartbeat();
        if (!running) break;
        console.log(`[supervisor] reconnecting in ${config.reconnectMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, config.reconnectMs));
    }
    process.exit(0);
}

void main();