import type {
    Collision,
    CollisionDetection,
    DroppableContainer,
} from "@dnd-kit/core";
import { closestCorners } from "@dnd-kit/core";
import { arrayMove, type SortingStrategy } from "@dnd-kit/sortable";
import type { Board, Column, ReorderBody } from "./data";

export type { ReorderBody };

/**
 * Pure drag-and-drop planning for the kanban board — no React, no network.
 *
 * Every dnd-kit id is namespaced so the uid spaces can never collide:
 *   iss:<uid>    issue card (its droppable; also the sortable item id)
 *   col:<uid>    sortable column — the pill is its drag handle
 *   zone:<uid>   one droppable per column covering its card list. NOT in any
 *                SortableContext items array: it is the stable "pin" target
 *                for issue drops, so dnd-kit's sibling displacement (which
 *                keys on `over.id` being a sortable item) never fights the
 *                controlled preview.
 *
 * THE MODEL — controlled preview, one resolver:
 *   On every dragMove AND on dragEnd the SAME call resolves the placement:
 *       const target = issueTargetFromCollisions(event.collisions);
 *       const plan = planIssueDrop(current, preDrag, issueUid, target);
 *   `plan.next` is the preview; `plan.body` is exactly what the server is
 *   told. Preview == drop == POST body, so they can never disagree.
 *
 * WHY THE TARGET COMES FROM `collisions`, NOT `over.data`:
 *   dnd-kit builds `over` from the droppable's own data ref — a custom
 *   collisionDetection's payload is DISCARDED. Every DragEvent carries
 *   `collisions` (the exact array our detector returned), so the resolved
 *   target rides in `collisions[0].data.target`.
 *
 * INDEX SEMANTICS: `index` is the 0-based insertion index into the target
 * column's issues list EXCLUDING the dragged card — the semantics of SQL
 * `app.move_issue(p_issue_id, p_to_column_id, p_index)`.
 *
 * COLLISION RULES:
 *   - The dragged item's own droppable is never a candidate, so a drop over
 *     the dragged card itself still resolves a real target.
 *   - Issue drags pin exactly ONE collision on the target column's zone.
 *   - Column drags use closestCorners restricted to `col:` droppables, so
 *     `over.id` is always a sortable column item.
 */

export const ISSUE_PREFIX = "iss:";
export const COLUMN_PREFIX = "col:";
export const ZONE_PREFIX = "zone:";

export type DropPlan =
    | { kind: "none" }
    | { kind: "issue"; body: Extract<ReorderBody, { kind: "issue" }>; next: Board }
    | { kind: "column"; body: Extract<ReorderBody, { kind: "column" }>; next: Board };

/** Where an issue drop lands. `index` is the 0-based insertion index in the
 *  target column's issues list EXCLUDING the dragged card (exactly the
 *  semantics of SQL app.move_issue(p_issue_id, p_to_column_id, p_index)). */
export type IssueTarget = { columnUid: string; index: number };

export function issueKey(uid: string): string {
    return ISSUE_PREFIX + uid;
}

export function columnKey(uid: string): string {
    return COLUMN_PREFIX + uid;
}

export function zoneKey(uid: string): string {
    return ZONE_PREFIX + uid;
}

type OverKey =
    | { type: "issue"; uid: string }
    | { type: "zone"; uid: string }
    | { type: "column"; uid: string }
    | null;

/** Decode a dnd-kit droppable id back to its target (also used for the
 *  active id: `decodeOverKey(String(event.active.id))`). */
export function decodeOverKey(key: string): OverKey {
    if (key.startsWith(ISSUE_PREFIX)) return { type: "issue", uid: key.slice(ISSUE_PREFIX.length) };
    if (key.startsWith(ZONE_PREFIX)) return { type: "zone", uid: key.slice(ZONE_PREFIX.length) };
    if (key.startsWith(COLUMN_PREFIX)) return { type: "column", uid: key.slice(COLUMN_PREFIX.length) };
    return null;
}

export function findColumn(board: Board, columnUid: string): Column | undefined {
    return board.columns.find((column) => column.uid === columnUid);
}

/**
 * Strategy for issue SortableContexts: NO dnd-kit transforms at all. The
 * controlled preview already places every card through state, so any
 * sibling displacement would fight it (and with `over.id` pinned on the
 * zone, `overIndex` is -1, which makes the stock strategies misbehave).
 */
export const noShiftStrategy: SortingStrategy = () => null;

/** Clamp an insertion index into [0, list length]. */
function clampIndex(index: number, length: number): number {
    return Math.max(0, Math.min(index, length));
}

/* ------------------------------------------------------------------ */
/* Geometry helpers (unit-tested)                                      */
/* ------------------------------------------------------------------ */

// The six rect fields we measure against (the DOM's ClientRect is deprecated).
type DndRect = {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
};

function rectCenterY(rect: DndRect): number {
    return rect.top + rect.height / 2;
}

/**
 * Insertion index over a card: the slot below the card once the pointer is
 * past its vertical midline. `cardIndex` is into the target list.
 */
function insertOverCard(cardIndex: number, cardRect: DndRect, y: number): number {
    return y >= rectCenterY(cardRect) ? cardIndex + 1 : cardIndex;
}

/**
 * Nearest entry to `y` by vertical centre distance. Ties resolve to the
 * topmost entry (strict `<`), so the result is deterministic.
 */
function nearestCardIndex(list: { rect: DndRect }[], y: number): number | undefined {
    let best: number | undefined;
    let bestDistance = Infinity;
    list.forEach((entry, i) => {
        const d = Math.abs(rectCenterY(entry.rect) - y);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    });
    return best;
}

/** Containment test for pointer-within, order-independent. */
function contains(rect: DndRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Resolve the insertion index inside one column's target list (`entries` =
 * that column's issues minus the dragged card, in render order, each with its
 * measured rect). `y` is the pointer Y in pointer mode or the collision-rect
 * centre Y in keyboard mode.
 */
function resolveIssueIndex(
    over: { kind: "issue" | "zone" | "column"; key: string; rect: DndRect },
    entries: { key: string; rect: DndRect }[],
    y: number
): number | null {
    if (over.kind === "issue") {
        const i = entries.findIndex((entry) => entry.key === over.key);
        if (i < 0) {
            // Defensive: the over card is not in the target list (e.g. it is
            // the dragged card) — fall back to the nearest card.
            const j = nearestCardIndex(entries, y);
            return j === undefined ? 0 : insertOverCard(j, entries[j].rect, y);
        }
        return insertOverCard(i, entries[i].rect, y);
    }
    // Gap / column body: nearest card with the same midline rule.
    if (entries.length === 0) return 0;
    const j = nearestCardIndex(entries, y);
    return j === undefined ? null : insertOverCard(j, entries[j].rect, y);
}

/* ------------------------------------------------------------------ */
/* Droppable introspection                                             */
/* ------------------------------------------------------------------ */

type Candidate = {
    key: string;
    kind: "issue" | "zone" | "column";
    uid: string;
    /** Column this droppable lives in (cards + zones know; columns are theirs). */
    columnUid: string | null;
    /** `data.sortable.index` for cards, -1 otherwise. */
    index: number;
    rect: DndRect;
    container: DroppableContainer;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isIssueTarget(value: unknown): value is IssueTarget {
    return isRecord(value) && typeof value.columnUid === "string" && typeof value.index === "number";
}

/** `data` payload of a droppable (its `data` ref's current value). */
function containerData(container: DroppableContainer): Record<string, unknown> {
    const current: unknown = container.data.current;
    return isRecord(current) ? current : {};
}

/** Column uid a sortable card belongs to: `data.sortable.containerId` is the
 *  `id` of its SortableContext — columns.tsx passes `id={zoneKey(uid)}`. */
function columnUidFromSortable(data: Record<string, unknown>): string | null {
    const sortable = data.sortable;
    if (!isRecord(sortable)) return null;
    const containerId = sortable.containerId;
    if (typeof containerId === "string" && containerId.startsWith(ZONE_PREFIX)) {
        return containerId.slice(ZONE_PREFIX.length);
    }
    return null;
}

/**
 * Build the planning view of one droppable. We own every registration
 * (cards, zones, column sections), so unknown ids are ignored. The REAL
 * registered container is threaded through, so the pinned collision can hand
 * dnd-kit its own droppable back without any synthetic stand-ins.
 */
function toCandidate(container: DroppableContainer, rect: DndRect | null): Candidate | null {
    const key = String(container.id);
    const target = decodeOverKey(key);
    if (!target || !rect) return null;
    const payload = containerData(container);

    if (target.type === "issue") {
        const sortable = payload.sortable;
        const index = isRecord(sortable) && typeof sortable.index === "number" ? sortable.index : -1;
        return {
            key,
            kind: "issue",
            uid: target.uid,
            columnUid: columnUidFromSortable(payload),
            index,
            rect,
            container,
        };
    }
    if (target.type === "zone") {
        const uid = typeof payload.uid === "string" && payload.uid ? payload.uid : target.uid;
        return { key, kind: "zone", uid, columnUid: uid, index: -1, rect, container };
    }
    return { key, kind: "column", uid: target.uid, columnUid: target.uid, index: -1, rect, container };
}

/* ------------------------------------------------------------------ */
/* issueTargetFromCollisions                                           */
/* ------------------------------------------------------------------ */

/**
 * Pull the resolved target out of the collisions array every DragEvent
 * carries (`event.collisions`). `kanbanCollisionDetection` pins the single
 * issue-drop collision on the target column's zone with the target payload.
 * `null` when the event does not describe an issue drop (column drags,
 * drops outside the board).
 */
export function issueTargetFromCollisions(collisions: Collision[] | null | undefined): IssueTarget | null {
    if (!collisions) return null;
    for (const collision of collisions) {
        const data: Record<string, unknown> | undefined = collision.data;
        const target = data?.target;
        if (isIssueTarget(target)) return target;
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* kanbanCollisionDetection                                            */
/* ------------------------------------------------------------------ */

/**
 * Custom collision detection for the whole board context (both drag kinds).
 *
 * ISSUE drags return EXACTLY ONE collision pinned on the target column's
 * zone droppable with the resolved IssueTarget in `data.target` (read back
 * via `issueTargetFromCollisions(event.collisions)`).
 *
 * COLUMN drags return plain closestCorners restricted to `col:` droppables,
 * so `over.id` is always a sortable column item.
 *
 * Self-hit exclusion is DRAG-KIND SPECIFIC: an ISSUE drag hides the dragged
 * card's own droppable (its node follows the live preview and would swallow
 * every hit-test), while a COLUMN drag KEEPS its own droppable so the column
 * can be dropped back exactly where it started.
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
    const { active, collisionRect, droppableRects, droppableContainers, pointerCoordinates } = args;
    const activeId = String(active.id);

    // Issue drags exclude the dragged card's own droppable: the card's DOM
    // node follows the live preview, so it would win every hit-test. Column
    // drags run no live preview, so the source column must stay a candidate —
    // otherwise it could not be dropped back where it started.
    const isIssueDrag = activeId.startsWith(ISSUE_PREFIX);

    // `droppableContainers` ships as a plain array of enabled containers.
    const candidates: Candidate[] = [];
    for (const container of droppableContainers) {
        if (isIssueDrag && String(container.id) === activeId) continue;
        const rect = droppableRects.get(container.id) ?? null;
        const candidate = toCandidate(container, rect);
        if (candidate) candidates.push(candidate);
    }

    /* ---- column reorder: closestCorners among the column sections ---- */
    if (activeId.startsWith(COLUMN_PREFIX)) {
        const list = candidates
            .filter((candidate) => candidate.kind === "column")
            .map((candidate) => candidate.container);
        return closestCorners({
            ...args,
            droppableContainers: list,
        });
    }

    /* ---- issue move: exactly one collision, pinned on the target zone ---- */
    if (!activeId.startsWith(ISSUE_PREFIX)) return [];
    const activeUid = activeId.slice(ISSUE_PREFIX.length);

    let over: Candidate | null = null;
    let y: number;

    if (pointerCoordinates) {
        // Pointer mode: the droppable the pointer is inside, deepest match
        // (smallest area: a card beats its enclosing zone).
        y = pointerCoordinates.y;
        let bestArea = Infinity;
        for (const candidate of candidates) {
            if (!contains(candidate.rect, pointerCoordinates.x, pointerCoordinates.y)) continue;
            const area = candidate.rect.width * candidate.rect.height;
            if (area <= bestArea) {
                bestArea = area;
                over = candidate;
            }
        }
        // The pointer sits over the dragged card's own slot (excluded) or
        // outside the board (hero/chat): the zone still contains it if we are
        // inside a column body; otherwise there is nothing to resolve and the
        // caller reverts on drop (`kind: "none"`).
        if (!over) return [];
    } else {
        // Keyboard mode: closestCorners among the remaining candidates.
        const [first] = closestCorners({
            ...args,
            droppableContainers: candidates.map((candidate) => candidate.container),
        });
        if (!first) return [];
        over = candidates.find((candidate) => candidate.key === String(first.id)) ?? null;
        y = rectCenterY(collisionRect);
    }

    if (!over) return [];

    const targetColumn = over.columnUid;
    if (!targetColumn) return [];

    // The target column's issues minus the dragged card, in render order.
    const entries = candidates
        .filter((candidate) => candidate.kind === "issue" && candidate.columnUid === targetColumn && candidate.uid !== activeUid)
        .sort((a, b) => a.index - b.index)
        .map((candidate) => ({ key: candidate.key, rect: candidate.rect }));

    const index = resolveIssueIndex({ kind: over.kind, key: over.key, rect: over.rect }, entries, y);
    if (index === null) return [];

    // Pin the collision on the target column's zone droppable. If the zone is
    // not registered there is no honest pin target — resolve nothing rather
    // than hand dnd-kit a synthetic container.
    const zoneId = zoneKey(targetColumn);
    const zoneContainer = candidates.find((candidate) => candidate.key === zoneId)?.container;
    if (!zoneContainer) return [];

    return [
        {
            id: zoneId,
            data: {
                droppableContainer: zoneContainer,
                value: 0,
                target: { columnUid: targetColumn, index },
            },
        },
    ];
};

/* ------------------------------------------------------------------ */
/* planIssueDrop / planColumnMove                                      */
/* ------------------------------------------------------------------ */

/**
 * Preview + plan in one call (used for BOTH dragOver and dragEnd): `next` is
 * the board with the issue placed at `target`, and `body` describes exactly
 * that arrangement (`index` = insertion index in the target column's issues
 * list EXCLUDING the dragged card).
 *
 * `preDrag` is the board as of dragStart — the arrangement the SERVER still
 * has. A drop that lands back on the pre-drag arrangement returns
 * `{ kind: "none" }` (skip the POST). Comparing against `current` instead
 * would be wrong: after a cross-column preview the card already sits in the
 * target column, and a drop on its preview slot must still be POSTed.
 */
export function planIssueDrop(current: Board, preDrag: Board, issueUid: string, target: IssueTarget): DropPlan {
    const inColumn = (b: Board) => b.columns.find((c) => c.issues.some((i) => i.uid === issueUid));
    const live = inColumn(current);
    const original = inColumn(preDrag);
    const to = findColumn(current, target.columnUid);
    if (!live || !original || !to) return { kind: "none" };

    const moving = live.issues.find((issue) => issue.uid === issueUid);
    if (!moving || moving.locked === true) return { kind: "none" };

    // Target list = the target column's issues minus the dragged card.
    const targetList = to.issues.filter((issue) => issue.uid !== issueUid);
    const index = clampIndex(target.index, targetList.length);

    // No-op: the final arrangement equals what the server already has.
    const originalIndex = original.issues.findIndex((issue) => issue.uid === issueUid);
    if (to.uid === original.uid && index === originalIndex) {
        return { kind: "none" };
    }

    const toIssues = [...targetList.slice(0, index), moving, ...targetList.slice(index)];
    const columns = current.columns.map((column) => {
        if (column.uid === to.uid) return { ...column, issues: toIssues, count: toIssues.length };
        if (column.uid === live.uid) {
            const issues = column.issues.filter((issue) => issue.uid !== issueUid);
            return { ...column, issues, count: issues.length };
        }
        return column;
    });

    return {
        kind: "issue",
        body: {
            kind: "issue",
            project: current.publicId,
            issue: issueUid,
            toColumn: to.uid,
            index,
        },
        next: { ...current, columns },
    };
}

/** Column reorder: `overUid` is the column uid the drag ended over. The
 *  resulting full order IS the POST body. Self-drop → `{ kind: "none" }`. */
export function planColumnMove(current: Board, activeUid: string, overUid: string): DropPlan {
    const fromIndex = current.columns.findIndex((column) => column.uid === activeUid);
    const toIndex = current.columns.findIndex((column) => column.uid === overUid);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return { kind: "none" };
    const columns = arrayMove(current.columns, fromIndex, toIndex);
    return {
        kind: "column",
        body: { kind: "column", project: current.publicId, columns: columns.map((column) => column.uid) },
        next: { ...current, columns },
    };
}

/** POST the plan; `true` when the server accepted it. */
export async function postReorder(body: ReorderBody): Promise<boolean> {
    try {
        const res = await fetch("/api/kanban/reorder", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.ok;
    } catch {
        return false;
    }
}
