/**
 * Echo attribution: recognising the WebSocket echo of our own write.
 *
 * A successful POST /api/kanban/reorder runs `app.move_issue` /
 * `app.reorder_columns`, and both RPCs rewrite *every* row they touch (a
 * park pass at position ≥ 500000, then a dense reassignment) — each rewrite
 * emits a `postgres_changes` event. The optimistic board already applied
 * that move, so refetching on our own echo would cost a GET per drag.
 *
 * Before the POST leaves, `buildEchoExpectation` records exactly which
 * (id → columnId, position) pairs the RPC will produce — mirroring what
 * `dndLogic.ts` already put on screen. `matchesEcho` then claims an event
 * as ours only when its row matches that prediction (a park row counts:
 * those positions only our RPC writes). Anything else — a remote edit, an
 * insert/delete, a column change during an issue move, a conflicting
 * concurrent move — falls through to the refetch, so only *unexpected*
 * changes ever hit the network.
 *
 * Known limit: a remote edit that touches only payload fields we don't
 * predict (e.g. a rename of an issue inside the window) looks identical to
 * our echo and is dropped; the next event, refetch or tab-visible sync
 * picks it up.
 */
import { parsePublicId } from "@/app/_lib/idConversion";
import type { Board, ReorderBody } from "./data";

/** A `postgres_changes` row event (both `Issues` and `Columns`). */
export type RealtimeRowEvent = {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    table: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
};

export type EchoExpectation = {
    /** Epoch ms after which nothing is attributed to us any more. */
    until: number;
    /** Internal issue id → the final (column, position) our write produces. */
    issues: Map<number, { columnId: number; position: number }>;
    /** Internal column id → final position; null when the write was an issue move. */
    columns: Map<number, number> | null;
};

/** Park floor of the RPCs' rewrite pass — unreachable by any remote session. */
const PARK_POSITION = 500_000;
/** How long after a write its echoes are still considered ours. */
export const ECHO_TTL_MS = 3_000;

function numberOf(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
    }
    return null;
}

/**
 * Predict our write's echo set: the affected columns of the *post-move*
 * board (`next` mirrors the RPC's ordering) keyed by internal id, plus the
 * final column order for a column move. `null` when an id won't decode —
 * then nothing is suppressed and every event refetches (safe default).
 */
export function buildEchoExpectation(
    body: ReorderBody,
    snapshot: Board,
    next: Board,
    until: number
): EchoExpectation | null {
    if (body.kind === "column") {
        const columns = new Map<number, number>();
        let decodable = true;
        next.columns.forEach((column, position) => {
            const id = parsePublicId(column.uid);
            if (id === null) decodable = false;
            else columns.set(id, position);
        });
        return decodable ? { until, issues: new Map(), columns } : null;
    }

    const issueId = parsePublicId(body.issue);
    const targetId = parsePublicId(body.toColumn);
    const source = snapshot.columns.find((column) =>
        column.issues.some((issue) => issue.uid === body.issue)
    );
    const sourceId = source ? parsePublicId(source.uid) : null;
    if (issueId === null || targetId === null || sourceId === null) return null;

    const issues = new Map<number, { columnId: number; position: number }>();
    let decodable = true;
    next.columns.forEach((column) => {
        const columnId = parsePublicId(column.uid);
        if (columnId === null) {
            decodable = false;
            return;
        }
        if (columnId !== sourceId && columnId !== targetId) return;
        column.issues.forEach((issue, position) => {
            const uid = parsePublicId(issue.uid);
            if (uid === null) decodable = false;
            else issues.set(uid, { columnId, position });
        });
    });
    return decodable ? { until, issues, columns: null } : null;
}

/** `true` when the event is the echo of the write `expectation` describes. */
export function matchesEcho(expectation: EchoExpectation, event: RealtimeRowEvent): boolean {
    const id = numberOf(event.new.id);
    if (id === null) return false;

    if (event.table === "Issues") {
        const expected = expectation.issues.get(id);
        if (!expected) return false;
        const position = numberOf(event.new.position);
        const columnId = numberOf(event.new.columnId);
        if (position === null || columnId === null) return false;
        if (position >= PARK_POSITION) return true; // our park pass
        return columnId === expected.columnId && position === expected.position;
    }

    if (event.table === "Columns") {
        if (!expectation.columns) return false; // an issue move never touches Columns
        const expectedPosition = expectation.columns.get(id);
        if (expectedPosition === undefined) return false;
        const position = numberOf(event.new.position);
        if (position === null) return false;
        if (position >= PARK_POSITION) return true; // our park pass
        return position === expectedPosition;
    }

    return false;
}