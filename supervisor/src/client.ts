/**
 * The bridge client: one WSS connection to B's /api/agent-runner with
 * challenge–response auth on every (re)connect. Transport: the `ws` package
 * (hand-rolled RFC 6455 framing was replaced by it; see git history).
 *
 * Handshake (before any schema frame flows):
 *   S -> B : connect (HTTP Upgrade)
 *   B -> S : { type:"message", action:"auth.challenge", payload:{ nonce } }
 *   S -> B : { type:"message", action:"auth",
 *              payload:{ instanceId, signature } }     // base64 Ed25519 over raw nonce
 *   B -> S : { action:"auth.ok" } | { action:"auth.fail", payload:{ reason } }
 *
 * The nonce is random and single-use on B's side, so a captured frame cannot
 * be replayed; the private key never crosses the wire — only signatures.
 * After `auth.ok` the session carries schema frames (supervisor.status
 * heartbeats today; agent.* later).
 */

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import type { Config } from "./config.ts";
import { type InstanceKeys, signChallenge } from "./keys.ts";
import { envelope, errorFrame, parseEnvelope, SCHEMA_VERSION, type Envelope } from "./protocol.ts";

/** How long to wait for B's challenge after the socket opens. */
const CHALLENGE_TIMEOUT_MS = 10_000;

export type SessionState = "connecting" | "authenticating" | "authenticated" | "closed";

export interface Session {
    readonly state: SessionState;
    /** Send a fire-and-forget message frame (no-op once closed). */
    send(action: string, payload: unknown): void;
    /** Send a request frame; resolves with the response, rejects on error/timeout. */
    request(action: string, payload: unknown, timeoutMs?: number): Promise<Envelope>;
}

export interface ConnectOptions {
    config: Config;
    keys: InstanceKeys;
    /** Handle a schema request from B. Return the response payload or throw. */
    onRequest?: (frame: Envelope) => Promise<unknown> | unknown;
    /** Handle a fire-and-forget message from B (after auth). */
    onMessage?: (frame: Envelope) => void;
    /** Called once when the socket dies, authenticated or not. */
    onClose?: () => void;
    /** Lifecycle hook for logging. */
    onStateChange?: (state: SessionState) => void;
}

// ---------------------------------------------------------------------------
// Connection (ws package + TLS trust anchor)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connect + handshake + session
// ---------------------------------------------------------------------------

type Phase = "challenge" | "result" | "session";

/** Connect once, run the handshake, resolve with a live session (or throw). */
export async function connectOnce(opts: ConnectOptions): Promise<Session> {
    const { config, keys } = opts;
    // Construct the socket synchronously so every listener below is attached
    // in this same turn — ws cannot emit before then, which closes the race
    // where B's challenge could land before the handshake waiter exists.
    // `ws` handles the HTTP Upgrade and RFC 6455 framing; `ca` wires B's
    // trust anchor (BRIDGE_CA_PATH) into the TLS options. A non-1xx upgrade
    // response surfaces as an "error" event (no `unexpected-response`
    // listener is attached, so ws aborts with the status line).
    const ws = new WebSocket(config.bridgeUrl, {
        // Trust anchor for B. wss:// with default CAs works too
        // (when BRIDGE_CA_PATH is unset, only system CAs are trusted).
        ...(config.caPath ? { ca: readFileSync(config.caPath) } : {}),
        handshakeTimeout: 10_000,
    });
    const opened = new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });

    let phase: Phase = "challenge";
    let state: SessionState = "connecting";
    const setState = (s: SessionState) => {
        state = s;
        opts.onStateChange?.(s);
    };

    const send = (raw: string) => {
        // ws queues sends while CONNECTING; `terminate()` hard-kills the
        // socket on every abort path below, so "readyState OPEN" is the
        // same guard as the old "!sock.destroyed".
        if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    };

    const pending = new Map<string, { resolve: (f: Envelope) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

    // Handshake waiters — set only while the matching promise is live.
    let onChallenge: ((f: Envelope) => void) | null = null;
    let onResult: ((f: Envelope) => void) | null = null;
    // ws can emit `open` and the first `message` in the same tick (101 +
    // first frame in one TCP chunk), so B's challenge may land before the
    // challenge waiter above is armed (it's armed after `await opened`).
    // Stash it here; the waiter picks it up when it arms.
    let earlyChallenge: Envelope | null = null;

    // Frames that arrive between `auth.ok` and the phase flip to "session"
    // (B may pipeline its first request right behind the auth result). They
    // are replayed through the session handler the moment we are ready.
    const deferred: Envelope[] = [];

    const handleSessionFrame = (frame: Envelope) => {
        if (frame.type === "response" || frame.type === "error") {
            const entry = frame.id ? pending.get(frame.id) : undefined;
            if (entry) {
                pending.delete(frame.id!);
                clearTimeout(entry.timer);
                if (frame.type === "error") entry.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
                else entry.resolve(frame);
            } else {
                console.warn(`[bridge] dropped unsolicited ${frame.type} (id=${frame.id})`);
            }
            return;
        }
        if (frame.type === "message") {
            opts.onMessage?.(frame);
            return;
        }
        // request: answer exactly once (response echoes id + action, per the schema)
        void (async () => {
            try {
                const payload = await opts.onRequest?.(frame);
                send(JSON.stringify(envelope("response", frame.action, payload ?? null, frame.id)));
            } catch (e) {
                const code = typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "internalError";
                send(JSON.stringify({ ...envelope("error", null, null, frame.id), error: { code, message: String(e).slice(0, 1000) } }));
            }
        })();
    };

    const dispatch = (frame: Envelope) => {
        if (phase === "challenge") {
            if (frame.type === "message" && frame.action === "auth.challenge") {
                if (onChallenge) onChallenge(frame);
                else earlyChallenge ??= frame; // arrived before the waiter armed
            } else {
                ws.terminate();
                console.warn(`[bridge] unexpected pre-auth frame: ${frame.type}/${frame.action}`);
            }
            return;
        }
        if (phase === "result") {
            if (frame.action === "auth.ok" || frame.action === "auth.fail") onResult?.(frame);
            else deferred.push(frame); // pipelined behind auth.ok — handled after the flip
            return;
        }
        handleSessionFrame(frame);
    };

    ws.on("message", (data, isBinary) => {
        if (isBinary) return; // schema frames are text-only
        const parsed = parseEnvelope(data.toString());
        if (!parsed.ok) {
            if (parsed.reason === "unsupportedVersion" && parsed.id != null) {
                // schema rule: wrong version on a request → error frame echoing the id
                send(JSON.stringify(errorFrame("unsupportedSchemaVersion",
                    `Unsupported schemaVersion; this supervisor speaks ${SCHEMA_VERSION}`, parsed.id)));
                console.warn(`[bridge] rejected frame: unsupported schemaVersion (id=${parsed.id})`);
            } else {
                // malformed, or version-mismatch with no id
                console.warn(`[bridge] dropped ${parsed.reason} frame`);
            }
            return;
        }
        dispatch(parsed.frame);
    });
    ws.on("error", (e) => console.warn(`[bridge] socket error: ${e.message}`));
    ws.on("close", () => {
        for (const [, entry] of pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error("connection closed"));
        }
        pending.clear();
        setState("closed");
        opts.onClose?.();
    });

    // Upgrade finished (or failed — `opened` rejects with the ws error).
    await opened;

    // --- challenge ---------------------------------------------------------
    setState("authenticating");
    const challenge = await new Promise<Envelope>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no challenge from B")), CHALLENGE_TIMEOUT_MS);
        onChallenge = (f) => {
            clearTimeout(timer);
            resolve(f);
        };
        if (earlyChallenge) {
            const f = earlyChallenge;
            earlyChallenge = null;
            onChallenge(f); // challenge beat the waiter — deliver it now
        }
    }).catch((e) => {
        ws.terminate();
        setState("closed");
        throw e;
    });
    onChallenge = null;

    const nonce = Buffer.from(String((challenge.payload as { nonce?: string } | null)?.nonce ?? ""), "base64");
    if (nonce.length !== 32) {
        ws.terminate();
        throw new Error(`challenge nonce missing or wrong length (${nonce.length})`);
    }
    send(JSON.stringify(envelope("message", "auth", { instanceId: config.instanceId, signature: signChallenge(keys, nonce) })));

    // --- auth result -------------------------------------------------------
    phase = "result";
    const result = await new Promise<Envelope>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("auth timed out")), config.authTimeoutMs);
        onResult = (f) => {
            clearTimeout(timer);
            resolve(f);
        };
    }).catch((e) => {
        ws.terminate();
        setState("closed");
        throw e;
    });
    onResult = null;

    if (result.action !== "auth.ok") {
        const reason = String((result.payload as { reason?: string } | null)?.reason ?? "unknown");
        ws.terminate();
        throw new Error(`bridge rejected auth: ${reason}`);
    }

    phase = "session";
    setState("authenticated");
    for (const queued of deferred) handleSessionFrame(queued);
    deferred.length = 0;

    return {
        get state() {
            return state;
        },
        send(action, payload) {
            send(JSON.stringify(envelope("message", action, payload)));
        },
        request(action, payload, timeoutMs = 15_000) {
            if (state !== "authenticated") return Promise.reject(new Error("not authenticated"));
            const id = crypto.randomUUID();
            return new Promise<Envelope>((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`request ${action} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                pending.set(id, { resolve, reject, timer });
                send(JSON.stringify({ ...envelope("request", action, payload), id }));
            });
        },
    };
}
