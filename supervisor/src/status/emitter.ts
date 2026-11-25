/**
 * S→W `agent.status` emitter (wave 1).
 *
 * Owns the outbound status frame for a task: it validates the update against the
 * schema's rules *before* anything reaches the wire (garbage frames are worse than
 * dropped ones), redacts every wire-bound string, and hands the frame to the current
 * session. Validation failures and transport failures both drop with a `log.warn`
 * and `false` — this module NEVER throws.
 *
 * Session handling is a lazy read: `index.ts` reassigns the holder on every
 * reconnect (client.ts builds a NEW Session per connect), so `emitStatus` reads
 * the holder at call time instead of capturing a session that would go stale.
 * Wave 2 adds an offline outbox; wave 1 just drops when unauthenticated.
 */

import type { Session } from "../client.ts";
import type { TaskContext, TaskQuestion, TaskStatusDetail } from "../tasks/store.ts";
import { updateTask } from "../tasks/store.ts";
import { log, redact } from "../log.ts";

/** Longest `statusMessage` allowed on the wire (schema limit), after `redact()`. */
const MAX_STATUS_MESSAGE = 1000;
/** Longest `reviewSummary` allowed on the wire (schema limit). */
const MAX_REVIEW_SUMMARY = 10_000;
/** `data` budget in bytes — DB CHECK `agentTasks_data_size`. */
const MAX_DATA_BYTES = 100_000;

/** Statuses that may carry a `statusDetail`; `running` never does. */
const DETAIL_ALLOWED_STATUS = new Set<TaskContext["status"]>(["waiting", "paused", "completed", "cancelled"]);

/**
 * One status update to emit as an `agent.status` frame.
 * Optional fields are validated/normalized to `null` in the outgoing payload.
 */
export interface StatusEmit {
    status: "running" | "waiting" | "completed" | "paused" | "cancelled";
    statusDetail?: TaskStatusDetail | null;
    statusMessage?: string | null;
    questions?: TaskQuestion[] | null;
    reviewSummary?: string | null;
    data?: Record<string, unknown> | null;
}

/**
 * The wire payload — exact key set, nothing extra (schema `agent.status`).
 * `data` is already a JSON string when non-null so byte length was measured once.
 */
interface StatusPayload {
    agentTaskId: number;
    status: StatusEmit["status"];
    statusDetail: TaskStatusDetail | null;
    statusMessage: string | null;
    questions: TaskQuestion[] | null;
    reviewSummary: string | null;
    data: Record<string, unknown> | null;
}

/**
 * Session holder. `index.ts` calls this right after `connectOnce` resolves and
 * passes `null` in the `onClose` handler; `emitStatus` reads it lazily, so a
 * reconnect simply reassigns the holder underneath.
 */
let currentSession: Session | null = null;

/** Reassign the live session (index.ts: after connect, and null on close). */
export function setSession(session: Session | null): void {
    currentSession = session;
}

/** Current session holder, or null when offline. */
export function getSession(): Session | null {
    return currentSession;
}

/** Drop with a warning and return false — the single non-throwing failure path. */
function drop(task: TaskContext, reason: string, fields: Record<string, unknown>): boolean {
    log.warn(`emitStatus dropped: ${reason}`, { task: task.agentTaskId, ...fields });
    return false;
}

/**
 * Emit `update` as an `agent.status` frame on the live session.
 *
 * Returns true iff the frame was handed to `session.send` (including when `data`
 * was oversized and dropped — the frame still goes out with `data: null`).
 * Returns false on any validation failure, missing/unauthenticated session, or
 * a throwing `send`. Never throws.
 */
export function emitStatus(task: TaskContext, update: StatusEmit): boolean {
    const status = update.status;

    // 1. statusDetail only on waiting | paused | completed | cancelled (running ⇒ null).
    let statusDetail: TaskStatusDetail | null = update.statusDetail ?? null;
    if (statusDetail !== null && !DETAIL_ALLOWED_STATUS.has(status)) {
        return drop(task, "statusDetail not allowed for status", { status, statusDetail });
    }

    // 2. reviewSummary required (non-empty, ≤ 10000) IFF statusDetail === "inReview".
    let reviewSummary: string | null = null;
    if (statusDetail === "inReview") {
        const summary = update.reviewSummary;
        if (typeof summary !== "string" || summary.length === 0 || summary.length > MAX_REVIEW_SUMMARY) {
            return drop(task, "inReview requires a non-empty reviewSummary ≤ 10000 chars", {
                status,
                statusDetail,
                reviewSummaryLength: typeof summary === "string" ? summary.length : null,
            });
        }
        reviewSummary = summary;
    }

    // 3. statusMessage ≤ 1000 chars after redact(); String() the Redacted result.
    let statusMessage: string | null = null;
    if (update.statusMessage !== undefined && update.statusMessage !== null) {
        statusMessage = String(redact(update.statusMessage));
        if (statusMessage.length > MAX_STATUS_MESSAGE) {
            return drop(task, `statusMessage exceeds ${MAX_STATUS_MESSAGE} chars after redact()`, {
                status,
                statusMessageLength: statusMessage.length,
            });
        }
    }

    // 4. questions only on waiting + question; otherwise forced to null.
    let questions: TaskQuestion[] | null = null;
    if (update.questions !== undefined && update.questions !== null) {
        if (status === "waiting" && statusDetail === "question") {
            questions = update.questions;
        } else {
            // Not an error: the schema only carries questions during a question round.
            log.debug("emitStatus: questions forced to null (needs waiting + question)", {
                task: task.agentTaskId,
                status,
                statusDetail,
            });
        }
    }

    // 5. data: JSON bytes ≤ 100_000, else drop the data only — frame still goes out.
    let data: Record<string, unknown> | null = null;
    if (update.data !== undefined && update.data !== null) {
        let json: string | undefined;
        try {
            json = JSON.stringify(update.data);
        } catch {
            json = undefined; // cyclic / BigInt / throwing toJSON → treated as oversized
        }
        if (json === undefined) {
            log.warn("emitStatus: data not JSON-serializable; sending frame with data=null", {
                task: task.agentTaskId,
            });
        } else if (Buffer.byteLength(json, "utf8") > MAX_DATA_BYTES) {
            log.warn("emitStatus: data exceeds 100000 bytes; sending frame with data=null", {
                task: task.agentTaskId,
                dataBytes: Buffer.byteLength(json, "utf8"),
            });
        } else {
            data = update.data;
        }
    }

    // 6. Session: lazy read (holder may be reassigned by a reconnect at any time).
    const session = currentSession;
    if (!session) {
        return drop(task, "no session", { status });
    }
    if (session.state !== "authenticated") {
        return drop(task, `session not authenticated (state=${session.state})`, { status });
    }

    const payload: StatusPayload = {
        agentTaskId: task.agentTaskId,
        status,
        statusDetail,
        statusMessage,
        questions,
        reviewSummary,
        data,
    };

    try {
        session.send("agent.status", payload);
    } catch (error) {
        // NEVER throw out of emitStatus — wave 1 drops, wave 2 queues offline.
        return drop(task, "session.send threw", {
            status,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    updateTask(task.agentTaskId, { lastReportedAt: Date.now() });
    return true;
}
