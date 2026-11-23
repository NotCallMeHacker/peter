/**
 * The WSS envelope from supervisor/docs/webCommunicationSchemas.md.
 *
 * Every frame is one WebSocket message. `type` is one of
 * message | request | response | error; `action` names the payload for
 * message/request frames; request/response/error carry a correlation `id`.
 * Auth is a handshake that happens before any schema frame flows — it reuses
 * the envelope (`action: "auth.challenge"` / `"auth"` / `"auth.ok"` /
 * `"auth.fail"`) so B routes it through the same validation.
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

/** Build a request frame (type=request + id + action). */
export function request(action: string, payload: unknown, id: string): Envelope {
    return { ...envelope("request", action, payload), id };
}

/** Build a message frame (fire-and-forget). */
export function message(action: string, payload: unknown): Envelope {
    return { ...envelope("message", action, payload), id: null };
}

/** Build an error frame (echoes the request id). */
export function errorFrame(code: string, errorMessage: string, id: string | null): Envelope {
    return {
        schemaVersion: SCHEMA_VERSION,
        type: "error",
        id,
        action: null,
        timestamp: new Date().toISOString(),
        payload: null,
        error: { code, message: errorMessage.slice(0, 1000) },
    };
}

/**
 * Parse + structurally validate an inbound frame.
 * Returns null when the frame cannot be trusted (wrong shape, wrong version).
 */
export function parseEnvelope(raw: string): Envelope | null {
    let frame: Partial<Envelope> | null = null;
    try {
        frame = JSON.parse(raw) as Partial<Envelope>;
    } catch {
        return null;
    }
    if (!frame || typeof frame !== "object") return null;
    if (frame.schemaVersion !== SCHEMA_VERSION) return null; // unknown major → reject
    if (typeof frame.type !== "string" || !["message", "request", "response", "error"].includes(frame.type)) return null;
    if (frame.id != null && typeof frame.id !== "string") return null;
    if (frame.type === "request" && (typeof frame.action !== "string" || typeof frame.id !== "string")) return null;
    return frame as Envelope;
}
