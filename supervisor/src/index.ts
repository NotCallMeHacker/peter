/**
 * Supervisor entry point (service A).
 *
 * Boots the instance identity (Ed25519 keypair, generated once on first
 * start), then keeps one authenticated WSS session to B's /api/agent-runner
 * alive: connect -> sign B's nonce -> stay on, heartbeating supervisor.status
 * and answering B's requests. Routing lives in actions.ts (agent.new,
 * agent.status, supervisor.status → buildSupervisorStatus()); this module only
 * wires the session to it — payload building has one source of truth:
 * status/supervisorStatus.ts.
 *
 * WebSocket transport: the `ws` package (custom CA via BRIDGE_CA_PATH).
 *
 * Reconnects forever with a fixed backoff (RECONNECT_MS) — B never dials A
 * (A opens no port), so A is the only side that can re-establish the channel.
 *
 *   node --env-file-if-exists=../.env --env-file-if-exists=.env src/index.ts
 */

import { handleMessage, handleRequest } from "./actions.ts";
import { connectOnce, type Session, type SessionState } from "./client.ts";
import { loadConfig } from "./config.ts";
import { ensureKeys } from "./keys.ts";
import { setSession } from "./status/emitter.ts";
import { buildSupervisorStatus } from "./status/supervisorStatus.ts";

const config = loadConfig();
const keys = ensureKeys(config);

let heartbeat: NodeJS.Timeout | undefined;

function startHeartbeat(session: Session): void {
    stopHeartbeat();
    heartbeat = setInterval(() => {
        session.send("supervisor.status", buildSupervisorStatus());
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
        onMessage: handleMessage,
        onStateChange: (state: SessionState) => {
            console.log(`[supervisor] session state: ${state}`);
        },
        onClose: () => {
            // client.ts builds a NEW Session per reconnect → drop the stale holder.
            setSession(null);
            stopHeartbeat();
            closed();
        },
    });
    // Module-scoped holder: emitStatus reads it lazily; reassign on every reconnect.
    setSession(session);
    // Initial heartbeat right away (B also asks once on its own).
    session.send("supervisor.status", buildSupervisorStatus());
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