/**
 * The agent-runner bridge hub: B's side of the WSS channel to the supervisors.
 *
 * Why this lives outside `app/`: Next.js does not support WebSocket route
 * handlers, and its own upgrade handler ends the socket for anything that
 * matches a route (see next/dist/server/lib/router-server.js: "If there's no
 * matched output, we don't handle the request as user's custom WS server may
 * be listening on the same path"). So `instrumentation.ts` patches the
 * http.Server `upgrade` event and hands `/api/agent-runner` to
 * `attachUpgrade()` here before Next ever sees it — in dev and in the
 * standalone production server alike, since `register()` runs in the process
 * that owns the HTTP server.
 *
 * Handshake (envelope actions, before any schema frame is accepted):
 *   B -> S : message auth.challenge { nonce }        (32 random bytes, base64)
 *   S -> B : message auth { instanceId, signature }  (base64 Ed25519 over the raw nonce)
 *   B -> S : message auth.ok {} | auth.fail { reason } (+ close)
 *
 * The nonce is random and single-use per connection, so a captured signature
 * cannot be replayed on a new connection. The private key never crosses the
 * wire. The public key comes from `app."RunnerInstances"` (registry.ts) —
 * rows are written only by the dashboard-gated `runner-keys` edge function,
 * and `revokedAt` always wins: a revoked identity is refused at handshake.
 *
 * After `auth.ok` the session carries schema frames (webCommunicationSchemas.md):
 * today `supervisor.status` heartbeats are stored for the status route and B
 * issues one `supervisor.status` request per session to prove delegation over
 * the verified channel; `agent.*` actions answer `notImplemented`.
 */

import { randomBytes, randomUUID, createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { errorFrame, message, parseEnvelope, request, type Envelope } from "./protocol";
import { getRunnerInstance } from "./registry";

/** The one path B accepts runner upgrades on (see webCommunicationSchemas.md). */
export const BRIDGE_PATH = "/api/agent-runner";

/** How long the socket may idle in the unauthenticated state. */
const AUTH_TIMEOUT_MS = 10_000;

/** Schema `data` packages cap at 10MB; give the frame a little headroom. */
const MAX_PAYLOAD_BYTES = 11 * 1024 * 1024;

/** Default request timeout when B delegates to a supervisor. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Best-effort status mirror so other processes (and humans) can peek.
 *
 * The path must stay a literal constant: Turbopack's file tracer cannot resolve
 * a path computed at runtime (`process.env`, `os.tmpdir()`) and falls back to
 * tracing the entire project — which silently copies `web/.env` and every other
 * untracked file into `.next/standalone`.
 */
const STATUS_FILE = "/tmp/peter-runner-bridge-status.json";

export interface RunnerStatusEntry {
    instanceId: string;
    connectedAt: string;
    lastSeenAt: string;
    /** Last `supervisor.status` payload the runner reported (schema shape). */
    status: unknown;
}

interface RunnerSession {
    instanceId: string;
    socket: WebSocket;
    connectedAt: string;
    lastSeenAt: string;
    status: unknown;
}

interface PendingRequest {
    resolve: (frame: Envelope) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

/**
 * Verify an Ed25519 signature over the raw challenge nonce.
 * `publicKey` is base64url (32 raw bytes), `signature` base64 (64 raw bytes).
 */
function verifySignature(publicKey: string, nonce: Buffer, signature: string): boolean {
    try {
        const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
        return cryptoVerify(null, nonce, key, Buffer.from(signature, "base64"));
    } catch {
        return false;
    }
}

class RunnerHub {
    private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: false });
    private sessions = new Map<string, RunnerSession>();
    private pending = new Map<string, PendingRequest>();

    constructor() {
        try {
            mkdirSync(dirname(STATUS_FILE), { recursive: true });
        } catch {
            // Status mirroring is best-effort; the hub works without it.
        }
    }

    /**
     * Called from the patched `upgrade` event with the raw req/socket/head.
     * Runs the WebSocket handshake, then the auth handshake.
     */
    attachUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
        this.wss.handleUpgrade(req, socket, head, (ws) => this.authenticate(ws));
    }

    /** Live view of authenticated sessions (for the status route). */
    describe(): { updatedAt: string; runners: RunnerStatusEntry[] } {
        const runners = Array.from(this.sessions.values())
            .map((s) => ({ instanceId: s.instanceId, connectedAt: s.connectedAt, lastSeenAt: s.lastSeenAt, status: s.status }))
            .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
        return { updatedAt: new Date().toISOString(), runners };
    }

    /**
     * Delegate one request to a connected runner and resolve with its reply.
     * Throws when the runner is absent or silent (the caller maps to 404/504).
     */
    requestFrom(instanceId: string, action: string, payload: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Envelope> {
        const session = this.sessions.get(instanceId);
        if (!session) return Promise.reject(new Error(`runner "${instanceId}" is not connected`));
        const id = randomUUID();
        return new Promise<Envelope>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`runner "${instanceId}" did not answer ${action} within ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            session.socket.send(JSON.stringify(request(action, payload, id)));
        });
    }

    // -- handshake ---------------------------------------------------------

    private authenticate(ws: WebSocket): void {
        const nonce = randomBytes(32);
        const failAndClose = (reason: string) => {
            try {
                ws.send(JSON.stringify(message("auth.fail", { reason })));
            } catch {
                // Socket may already be gone; closing below is enough.
            }
            ws.close(4401, reason.slice(0, 100));
        };

        ws.send(JSON.stringify(message("auth.challenge", { nonce: nonce.toString("base64") })));

        const timer = setTimeout(() => failAndClose("authentication timed out"), AUTH_TIMEOUT_MS);
        let phase: "auth" | "session" | "closed" = "auth";

        ws.on("message", (data) => {
            const frame = parseEnvelope(data.toString());
            if (!frame) {
                console.warn("[agent-runner] dropped malformed frame");
                return;
            }
            if (phase === "auth") {
                if (frame.type !== "message" || frame.action !== "auth") {
                    phase = "closed";
                    clearTimeout(timer);
                    failAndClose(`expected an auth message, got ${frame.type}/${frame.action}`);
                    return;
                }
                phase = "closed"; // one auth attempt per connection
                clearTimeout(timer);
                void this.completeAuth(ws, frame, nonce).then(
                    (session) => {
                        if (!session) return; // completeAuth already replied + closed
                        phase = "session";
                        this.attachSession(ws, session);
                        this.probeStatus(session);
                    },
                    (error: unknown) => {
                        console.error("[agent-runner] auth failed", error);
                        failAndClose("internal error during authentication");
                    },
                );
                return;
            }
            if (phase !== "session") return; // auth attempt still in flight or failed
            this.handleFrame(ws, frame);
        });

        ws.on("error", (error) => console.warn(`[agent-runner] socket error: ${error.message}`));
        ws.on("close", () => {
            clearTimeout(timer);
            // Array.from: tsconfig targets es5, where Map iterators are not
            // iterable without --downlevelIteration.
            for (const [id, entry] of Array.from(this.sessions.entries())) {
                if (entry.socket === ws) {
                    this.sessions.delete(id);
                    this.persist();
                    console.log(`[agent-runner] runner "${id}" disconnected`);
                }
            }
        });
    }

    /**
     * Validate the auth message against the registry and the nonce signature.
     * Replies `auth.ok` on success, `auth.fail` + close on any rejection.
     * Resolves with the session on success, null when it answered `auth.fail`.
     */
    private async completeAuth(
        ws: WebSocket,
        frame: Envelope,
        nonce: Buffer,
    ): Promise<RunnerSession | null> {
        const payload = (frame.payload ?? null) as { instanceId?: unknown; signature?: unknown } | null;
        const instanceId = String(payload?.instanceId ?? "");
        const signature = String(payload?.signature ?? "");

        const reject = (reason: string): null => {
            console.warn(`[agent-runner] auth rejected (${reason})`);
            try {
                ws.send(JSON.stringify(message("auth.fail", { reason })));
            } catch {
                // Socket may already be gone.
            }
            ws.close(4401, reason.slice(0, 100));
            return null;
        };

        if (!instanceId || instanceId.length > 100 || !/^[a-zA-Z0-9._-]+$/.test(instanceId)) {
            return reject("invalid instance id");
        }
        if (!signature) return reject("missing signature");

        let instance;
        try {
            instance = await getRunnerInstance(instanceId);
        } catch (error) {
            // Distinguish "we don't know" from "the registry is unreachable" so
            // operators are not misled into revoking a healthy instance.
            console.error("[agent-runner] registry lookup failed", error);
            return reject("registry unavailable");
        }
        if (!instance) return reject("unknown instance");
        if (instance.revokedAt) return reject("instance revoked");
        if (!verifySignature(instance.publicKey, nonce, signature)) {
            return reject("signature verification failed");
        }

        ws.send(JSON.stringify(message("auth.ok", { instanceId })));
        console.log(`[agent-runner] runner "${instanceId}" authenticated`);

        const now = new Date().toISOString();
        return { instanceId, socket: ws, connectedAt: now, lastSeenAt: now, status: null };
    }

    private attachSession(ws: WebSocket, session: RunnerSession): void {
        const previous = this.sessions.get(session.instanceId);
        if (previous && previous.socket !== ws) {
            // One live session per instance: the newest connection wins, so a
            // half-dead socket cannot shadow a healthy reconnect.
            try {
                previous.socket.close(4409, "replaced by a newer connection");
            } catch {
                // Already gone.
            }
        }
        this.sessions.set(session.instanceId, session);
        this.persist();
    }

    /**
     * Exercise delegation over the fresh channel: ask the runner for its
     * status once (the answer doubles as the first stored status).
     */
    private probeStatus(session: RunnerSession): void {
        this.requestFrom(session.instanceId, "supervisor.status", {}).then(
            (reply) => {
                session.status = reply.payload ?? null;
                this.persist();
            },
            (error: unknown) => console.warn(`[agent-runner] status request failed: ${(error as Error).message}`),
        );
    }

    // -- session traffic ---------------------------------------------------

    private handleFrame(ws: WebSocket, frame: Envelope): void {
        const session = Array.from(this.sessions.values()).find((s) => s.socket === ws);
        if (!session) return;
        session.lastSeenAt = new Date().toISOString();

        if (frame.type === "response" || frame.type === "error") {
            const id = frame.id;
            const entry = id ? this.pending.get(id) : undefined;
            if (!entry || !id) {
                console.warn(`[agent-runner] dropped unsolicited ${frame.type} (id=${frame.id})`);
                return;
            }
            this.pending.delete(id);
            clearTimeout(entry.timer);
            if (frame.type === "error") entry.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
            else entry.resolve(frame);
            return;
        }

        if (frame.type === "message") {
            if (frame.action === "supervisor.status") {
                // Fire-and-forget heartbeat: store it, the status route serves it.
                session.status = frame.payload ?? null;
                this.persist();
            } else {
                console.warn(`[agent-runner] dropped message with unknown action "${frame.action}"`);
            }
            return;
        }

        // Requests from S are answered exactly once (schema rule). Nothing is
        // defined for S->W requests yet, so everything is unknownAction.
        ws.send(JSON.stringify(errorFrame("unknownAction", `No handler registered for action "${frame.action}"`, frame.id)));
    }

    /** Mirror the public view to disk — cheap, atomic, best-effort. */
    private persist(): void {
        try {
            const tmp = `${STATUS_FILE}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.describe(), null, 2));
            renameSync(tmp, STATUS_FILE);
        } catch {
            // Non-fatal: the in-process map is authoritative.
        }
    }
}

/** Singleton that survives dev HMR module reloads. */
export function getHub(): RunnerHub {
    const globalState = globalThis as { __peterRunnerHub?: RunnerHub };
    return (globalState.__peterRunnerHub ??= new RunnerHub());
}

/** Hand a raw HTTP upgrade to the hub (used by instrumentation.ts). */
export function attachUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    getHub().attachUpgrade(req, socket, head);
}

/**
 * The mirrored status snapshot. Used as a cross-process fallback by the
 * status route when the in-process hub has no sessions (Next may run route
 * handlers in another process than the one that owns the socket).
 */
export function readStatusSnapshot(): { updatedAt: string; runners: RunnerStatusEntry[] } | null {
    try {
        return JSON.parse(readFileSync(STATUS_FILE, "utf8")) as { updatedAt: string; runners: RunnerStatusEntry[] };
    } catch {
        return null;
    }
}