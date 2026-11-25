/**
 * Task state machine: the single authority on legal `status` transitions.
 *
 * Rejected transitions are logged loudly FIRST (log.error / log.warn with
 * from/to/detail fields) and then thrown as `Error` with
 * `(error as { code: string }).code = "invalidPayload"` — client.ts's responder
 * already maps a thrown `.code` to an error frame.
 */
import { log } from "./log.ts";
import type { TaskStatus, TaskStatusDetail } from "./tasks/store.ts";

/** Same value domain as TaskStatus; spelled out for the transition API. */
export type TransitionStatus = "scheduled" | "running" | "waiting" | "paused" | "completed" | "cancelled";

/** Terminal states: from them every transition is rejected (including self). */
const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["completed", "cancelled"]);

/**
 * Transition table — encode exactly:
 *   scheduled → cancelled | running
 *   running   → waiting | paused | completed | cancelled
 *   waiting   → running | completed (inReview only) | cancelled
 *   paused    → running | cancelled
 * SETTLED DOC INCONSISTENCY: the doc's flow list omits `waiting→completed`,
 * but the review path ("approve → merge → completed") and the S→W status section
 * require it → ACCEPT `waiting→completed` ONLY when `statusDetail === "inReview"`;
 * REJECT it from waiting when statusDetail is "question" or anything else (a
 * question round cannot be approved). Do not "fix" this back.
 * `cancelled` is accepted from EVERY non-terminal state: scheduled | running |
 * waiting | paused (user cancelling a stuck task is the main use of the command;
 * the doc's list would reject it from waiting) — handled below via TERMINAL.
 * completed and cancelled are terminal: every transition from them is rejected.
 */
const ALLOWED: Readonly<Record<Exclude<TaskStatus, "completed" | "cancelled">, readonly TransitionStatus[]>> = {
    scheduled: ["running"],
    running: ["waiting", "paused", "completed"],
    waiting: ["running", "completed"], // completed accepted ONLY with statusDetail === "inReview" (checked below)
    paused: ["running"],
};

function reject(from: TaskStatus, to: TransitionStatus, statusDetail: TaskStatusDetail | null | undefined, message: string): never {
    const fields = { from, to, detail: statusDetail ?? null };
    if (from === "completed" || from === "cancelled") {
        log.error("transition rejected: task is in a terminal state", fields);
    } else if (from === "waiting" && to === "completed") {
        log.error("transition rejected: waiting→completed requires statusDetail \"inReview\"", fields);
    } else {
        log.warn("transition rejected: illegal status transition", fields);
    }
    const error = new Error(message) as Error & { code: string };
    error.code = "invalidPayload";
    throw error;
}

/**
 * Asserts that `from → to` (with optional `statusDetail`) is a legal transition.
 * Throws an `Error` with `.code = "invalidPayload"` on a rejected transition,
 * after logging loudly. Returns `void` on success.
 */
export function assertTransition(from: TaskStatus, to: TransitionStatus, statusDetail?: TaskStatusDetail | null): void {
    if (TERMINAL.has(from)) {
        reject(from, to, statusDetail, `Invalid status transition: ${from} → ${to} (terminal state)`);
    }

    // cancelled is accepted from every non-terminal state (scheduled | running | waiting | paused).
    if (to === "cancelled") {
        return;
    }

    const allowed = ALLOWED[from as Exclude<TaskStatus, "completed" | "cancelled">];
    if (allowed === undefined || !allowed.includes(to)) {
        reject(from, to, statusDetail, `Invalid status transition: ${from} → ${to}`);
    }

    // SETTLED DOC INCONSISTENCY: waiting→completed exists only for the review path.
    if (from === "waiting" && to === "completed") {
        if (statusDetail !== "inReview") {
            reject(
                from,
                to,
                statusDetail,
                `Invalid status transition: waiting → completed requires statusDetail "inReview" (got ${statusDetail ?? "null"})`,
            );
        }
    }
}
