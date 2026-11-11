/**
 * View model of the kanban board: exactly what the client renders.
 *
 * Every value is derived from the database — `app/_lib/kanbanRepo.ts` reads
 * the `app` schema over Supabase and maps the rows of `web/db/models` onto
 * these types. Nothing here is authored sample data.
 */

export type IssueType = "bug" | "improvement" | "chore" | "docs";

export type RunState = "queued" | "running" | "failed" | "done";

/** Status pill variant — the four pill colours in board.css. */
export type ColumnKey = "backlog" | "ready" | "progress" | "review";

export type Issue = {
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
};

export type Column = {
    key: ColumnKey;
    /** Column name as stored in the database. */
    label: string;
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
