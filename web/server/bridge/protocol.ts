/**
 * The agent-runner wire envelope — B's mirror of
 * `supervisor/docs/webCommunicationSchemas.md`.
 *
 * Every WebSocket message is exactly one JSON envelope; there is no
 * fragmentation. `type` is message | request | response | error; requests
 * carry a correlation `id` that exactly one response/error echoes. The auth
 * handshake (`auth.challenge` / `auth` / `auth.ok` / `auth.fail`) reuses the
 * envelope with `type: "message"` so it flows through the same validation as
 * everything else, but it only ever happens before `auth.ok`.
 *
 * Keep this file free of `ws`/node imports: it is pure parsing/shape logic
 * shared by the hub and (conceptually) the supervisor.
 */

export const SCHEMA_VERSION = "1.0.0";

export type EnvelopeType = "message" | "request" | "response" | "error";

export interface Envelope {
    schemaVersion: string;
    type: EnvelopeType;
    id: string | null;
    action: string | null;
    timestamp: string;
    payload: unknown;
    error: { code: string; message: string } | null;
}

export function envelope(type: EnvelopeType, action: string | null, payload: unknown, id: string | null = null): Envelope {
    return {
        schemaVersion: SCHEMA_VERSION,
        type,
        id,
        action,
        timestamp: new Date().toISOString(),
        payload,
        error: null,
    };
}

/** Fire-and-forget message frame (`id` is always null). */
export function message(action: string, payload: unknown): Envelope {
    return envelope("message", action, payload, null);
}

/** Request frame: carries a fresh correlation id the reply must echo. */
export function request(action: string, payload: unknown, id: string): Envelope {
    return envelope("request", action, payload, id);
}

/** Error frame replying to a request (`action`/`payload` are null per spec). */
export function errorFrame(code: string, errorMessage: string, id: string | null): Envelope {
    const frame = envelope("error", null, null, id);
    frame.error = { code, message: errorMessage.slice(0, 1000) };
    return frame;
}

/**
 * Parse + structurally validate an inbound frame. Returns null when the frame
 * cannot be trusted (bad JSON, wrong shape, unsupported major version) — the
 * caller logs and drops it, per the schema rules.
 */
export function parseEnvelope(raw: string): Envelope | null {
    let frame: Partial<Envelope> | null = null;
    try {
        frame = JSON.parse(raw) as Partial<Envelope>;
    } catch {
        return null;
    }
    if (!frame || typeof frame !== "object") return null;
    if (frame.schemaVersion !== SCHEMA_VERSION) return null;
    if (typeof frame.type !== "string" || !["message", "request", "response", "error"].includes(frame.type)) return null;
    if (frame.id != null && typeof frame.id !== "string") return null;
    if (frame.type === "request" && (typeof frame.action !== "string" || typeof frame.id !== "string")) return null;
    return frame as Envelope;
}