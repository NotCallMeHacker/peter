/**
 * View model of the kanban board: exactly what the client renders.
 *
 * Every value is derived from the database — `app/_lib/kanbanRepo.ts` reads
 * the `app` schema over Supabase and maps the rows of `web/db/models` onto
 * these types. Nothing here is authored sample data.
 */

export type IssueType = "bug" | "improvement" | "chore" | "docs";

type RunState = "queued" | "running" | "failed" | "done";

/** Status pill variant — the four pill colours in board.css. */
export type ColumnKey = "backlog" | "ready" | "progress" | "review";

export type Issue = {
    /**
     * Stable row/dnd id — ciphered internal issue id (`toPublic`). This is
     * what drag-and-drop keys on; `id` is only a display code.
     */
    uid: string;
    /** Display id, e.g. "PC 142" — issue ids stay public (see db/models/models.md). */
    id: string;
    title: string;
    /** From the issue's labels; absent when it carries no type label. */
    type?: IssueType;
    date: string;
    avatar?: string;
    avatarTone?: "blue" | "green" | "coral";
    run?: { label: string; state: RunState; progress?: number };
    worktree?: string;
    flagged?: boolean;
    /** DB `Issues.locked` — a locked issue must not be draggable. */
    locked?: boolean;
};

/**
 * POST /api/kanban/reorder payload (discriminated on `kind`) — shared by the
 * client planner (`dndLogic.ts`) and the route's parser.
 */
export type ReorderBody =
    | { kind: "issue"; project: string; issue: string; toColumn: string; index: number }
    | { kind: "column"; project: string; columns: string[] };

export type Column = {
    /**
     * Stable row/dnd id — ciphered internal column id (`toPublic`). This is
     * what column reordering keys on; `key` is only the pill variant.
     */
    uid: string;
    key: ColumnKey;
    /** Column name as stored in the database. */
    label: string;
    /** The column's own color (`Columns.color`) — the pill keeps it across a reorder. */
    color?: string;
    count: number;
    running: number;
    delegated?: number;
    issues: Issue[];
};

export type HeroProject = {
    name: string;
    worktrees: { name: string; branch: string }[];
    failedRuns: number;
    needYou: number;
    /** 24h run activity, one bar per 3h bucket; `failed` buckets read coral. */
    activity: { h: number; failed: boolean }[];
};

export type ChatMessage = {
    meta: string;
    text: string;
    mine: boolean;
};

export type Board = {
    /** Cyphered project id — the `/kanban/[id]` segment. */
    publicId: string;
    project: HeroProject;
    columns: Column[];
    chat: ChatMessage[];
};

/** i18n fallback for a column name, keyed by pill variant. */
export const columnLabelKey = {
    backlog: "columns.backlog",
    ready: "columns.ready",
    progress: "columns.progress",
    review: "columns.review",
} as const;
