/**
 * Board reads: rows from the `app` schema (via Supabase/PostgREST) mapped onto
 * the view model in `app/kanban/data.ts`.
 *
 * The tables are the ones Sequelize created, so the row shapes are the model
 * attributes from `web/db/models` plus the timestamps Sequelize maintains.
 *
 * **Every read is scoped to the caller, twice.** The filters below are the
 * first layer: a project is reachable only through the group whose `ownerId`
 * is the session user (`sub`), so anything foreign answers as if it did not
 * exist. The second layer is Row Level Security (migration
 * `20261108000002-row-level-security`): every query runs with the signed-in
 * user's GoTrue access token (forwarded by `appSchema()` — see `db.ts`), whose
 * `sub` the policies resolve the caller from, so a future query that forgets a
 * filter returns nothing instead of somebody else's board. Never use the
 * service role for a user-facing read: it bypasses RLS.
 *
 * Server-only: reads the session cookie, so it must not be imported from a
 * client component.
 */

import type { GroupAttributes } from "../../db/models/group";
import type { ProjectAttributes } from "../../db/models/project";
import type { LabelAttributes } from "../../db/models/label";
import type { ColumnAttributes, SpecialType } from "../../db/models/column";
import type { IssueAttributes } from "../../db/models/issue";
import type { CommentAttributes } from "../../db/models/comment";
import type { AgentTaskAttributes, StatusDetail } from "../../db/models/agentTask";
import type { LogAttributes } from "../../db/models/log";

import { appSchema } from "./db";
import { toPublic } from "./idConversion";
import type { Board, ChatMessage, Column, ColumnKey, HeroProject, Issue, IssueType } from "../kanban/data";

/* ------------------------------------------------------------------ */
/* Row shapes                                                          */
/* ------------------------------------------------------------------ */

type Stamped<T> = T & { createdAt: string; updatedAt?: string };

type ProjectRow = Stamped<ProjectAttributes>;
type GroupRow = Stamped<GroupAttributes>;
type ColumnRow = Stamped<ColumnAttributes>;
type IssueRow = Stamped<IssueAttributes>;
type LabelRow = Stamped<LabelAttributes>;
type CommentRow = Stamped<CommentAttributes>;
type AgentTaskRow = Stamped<AgentTaskAttributes>;
type LogRow = Stamped<LogAttributes>;
type IssueLabelRow = { issueId: number; labelId: number };

/* ------------------------------------------------------------------ */
/* Query helpers                                                       */
/* ------------------------------------------------------------------ */

type QueryResult = { data: unknown; error: { message: string } | null };

function rows<T>(table: string, res: QueryResult): T[] {
    if (res.error) throw new Error(`Supabase: could not read ${table} (${res.error.message})`);
    return (res.data ?? []) as T[];
}

function row<T>(table: string, res: QueryResult): T | null {
    if (res.error) throw new Error(`Supabase: could not read ${table} (${res.error.message})`);
    return (res.data ?? null) as T | null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type ProjectListItem = {
    /** Cyphered project id — the `/kanban/[id]` segment (see idConversion). */
    publicId: string;
    name: string;
    description: string | null;
    unicodeIcon: string | null;
    archived: boolean;
    columnCount: number;
    issueCount: number;
};

/** Ids of the groups this user owns — models.md maps a group 1:1 to a user. */
async function ownedGroupIds(ownerId: string): Promise<number[]> {
    if (!ownerId) return [];
    const db = await appSchema();
    const res = await db
        .from("Groups")
        .select("id")
        .eq("ownerId", ownerId)
        .eq("deleted", false);
    return rows<Pick<GroupRow, "id">>("Groups", res).map((group) => group.id);
}

/** The caller's live projects, with cheap board sizes for the picker. */
export async function listProjects(ownerId: string): Promise<ProjectListItem[]> {
    const db = await appSchema();
    const groupIds = await ownedGroupIds(ownerId);
    if (groupIds.length === 0) return [];

    const projectsRes = await db
        .from("Projects")
        .select("*")
        .eq("deleted", false)
        .in("groupId", groupIds)
        .order("name");
    const projects = rows<ProjectRow>("Projects", projectsRes);
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) return [];

    const columnsRes = await db
        .from("Columns")
        .select("id, projectId")
        .eq("deleted", false)
        .in("projectId", projectIds);
    const columns = rows<Pick<ColumnRow, "id" | "projectId">>("Columns", columnsRes);
    const columnIds = columns.map((column) => column.id);

    const issuesRes = columnIds.length
        ? await db.from("Issues").select("id, columnId").eq("deleted", false).in("columnId", columnIds)
        : null;
    const issues = issuesRes ? rows<Pick<IssueRow, "id" | "columnId">>("Issues", issuesRes) : [];

    const projectOfColumn = new Map(columns.map((column) => [column.id, column.projectId]));
    const columnCount = new Map<number, number>();
    const issueCount = new Map<number, number>();

    for (const column of columns) {
        columnCount.set(column.projectId, (columnCount.get(column.projectId) ?? 0) + 1);
    }
    for (const issue of issues) {
        const projectId = projectOfColumn.get(issue.columnId);
        if (projectId !== undefined) issueCount.set(projectId, (issueCount.get(projectId) ?? 0) + 1);
    }

    return projects.map((project) => ({
        publicId: toPublic(project.id),
        name: project.name,
        description: project.description ?? null,
        unicodeIcon: project.unicodeIcon ?? null,
        archived: project.archived,
        columnCount: columnCount.get(project.id) ?? 0,
        issueCount: issueCount.get(project.id) ?? 0,
    }));
}

/**
 * The board of one project, or `null` when the public id is unknown **or**
 * the project belongs to another user — both answer as 404, so an id cannot
 * even be used to probe which projects exist.
 */
export async function loadBoard(ownerId: string, internalId: number): Promise<Board | null> {
    const db = await appSchema();
    const projectRes = await db
        .from("Projects")
        .select("*")
        .eq("id", internalId)
        .eq("deleted", false)
        .maybeSingle();
    const project = row<ProjectRow>("Projects", projectRes);
    if (!project) return null;

    const groupRes = await db.from("Groups").select("*").eq("id", project.groupId).maybeSingle();
    const group = row<GroupRow>("Groups", groupRes);
    if (!group || group.ownerId !== ownerId) return null;

    const [columnsRes, labelsRes] = await Promise.all([
        db.from("Columns").select("*").eq("projectId", project.id).eq("deleted", false).order("position"),
        db.from("Labels").select("*").eq("projectId", project.id).eq("deleted", false),
    ]);

    const columns = rows<ColumnRow>("Columns", columnsRes);
    const labels = rows<LabelRow>("Labels", labelsRes);
    const columnIds = columns.map((column) => column.id);

    const [issuesRes, logsRes] = await Promise.all([
        columnIds.length
            ? db.from("Issues").select("*").in("columnId", columnIds).eq("deleted", false)
            : Promise.resolve({ data: [], error: null } as QueryResult),
        db
            .from("Logs")
            .select("*")
            .eq("projectId", project.id)
            .gte("createdAt", new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString()),
    ]);

    const issues = rows<IssueRow>("Issues", issuesRes).sort(
        (a, b) => a.columnId - b.columnId || a.position - b.position
    );
    const issueIds = issues.map((issue) => issue.id);
    const logs = rows<LogRow>("Logs", logsRes);

    const [issueLabelsRes, tasksRes, commentsRes] = await Promise.all([
        issueIds.length
            ? db.from("IssueLabels").select("*").in("issueId", issueIds)
            : Promise.resolve({ data: [], error: null } as QueryResult),
        issueIds.length
            ? db.from("AgentTasks").select("*").in("issueId", issueIds).order("id")
            : Promise.resolve({ data: [], error: null } as QueryResult),
        issueIds.length
            ? db
                  .from("Comments")
                  .select("*")
                  .in("issueId", issueIds)
                  .eq("deleted", false)
                  .order("createdAt", { ascending: false })
                  .limit(CHAT_LIMIT * 2)
            : Promise.resolve({ data: [], error: null } as QueryResult),
    ]);

    const issueLinks = rows<IssueLabelRow>("IssueLabels", issueLabelsRes);
    const tasks = rows<AgentTaskRow>("AgentTasks", tasksRes);
    const comments = rows<CommentRow>("Comments", commentsRes);

    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    const labelsById = new Map(labels.map((label) => [label.id, label]));
    const labelIdsByIssue = new Map<number, number[]>();
    for (const link of issueLinks) {
        const list = labelIdsByIssue.get(link.issueId) ?? [];
        list.push(link.labelId);
        labelIdsByIssue.set(link.issueId, list);
    }
    const tasksByIssue = new Map<number, AgentTaskRow>();
    for (const task of tasks) tasksByIssue.set(task.issueId, task); // ascending id: last wins

    const code = issueCode(project.name);
    const viewColumns: Column[] = columns.map((column) => {
        const cardIssues = issues
            .filter((issue) => issue.columnId === column.id)
            .map((issue) =>
                viewIssue(
                    issue,
                    tasksByIssue.get(issue.id),
                    labelIdsByIssue.get(issue.id) ?? [],
                    labelsById,
                    code
                )
            );

        return {
            key: columnKey(column),
            label: column.name,
            count: cardIssues.length,
            running: cardIssues.filter((card) => card.run?.state === "running").length,
            delegated: cardIssues.filter((card) => card.run !== undefined).length || undefined,
            issues: cardIssues,
        };
    });

    return {
        publicId: toPublic(project.id),
        project: hero(project, issueById, tasks, logs),
        columns: viewColumns,
        chat: chat(comments, tasks, group, code, issueById),
    };
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

const ISSUE_TYPES: IssueType[] = ["bug", "improvement", "chore", "docs"];

function viewIssue(
    issue: IssueRow,
    task: AgentTaskRow | undefined,
    labelIds: number[],
    labelsById: Map<number, LabelRow>,
    code: (id: number) => string
): Issue {
    const type = labelIds
        .map((id) => labelsById.get(id)?.name.trim().toLowerCase())
        .find((name): name is IssueType => name !== undefined && ISSUE_TYPES.includes(name as IssueType));

    const view: Issue = {
        id: code(issue.id),
        title: issue.name,
        date: stamp(issue.updatedAt ?? issue.createdAt),
    };

    if (type) view.type = type;
    if (task) {
        view.avatar = agentInitials(task);
        view.avatarTone = isFailure(task) ? "coral" : task.status === "completed" ? "green" : "blue";
        if (task.runnerId) view.worktree = worktreeName(task.runnerId);
        const run = runFor(task);
        if (run) view.run = run;
        if (isFailure(task)) view.flagged = true;
    }

    return view;
}

/** The card's run chip, read from the issue's agent task. */
function runFor(task: AgentTaskRow): NonNullable<Issue["run"]> {
    const ref = `run #${task.id}`;
    const failed = isFailure(task);

    switch (task.status) {
        case "running":
            return { label: `${ref} · running`, state: "running", progress: progressOf(task) };
        case "scheduled":
            return { label: `queued · ${ref}`, state: "queued" };
        case "completed":
            return { label: `${ref} · done`, state: "done" };
        case "waiting":
            return { label: `needs you · ${ref}`, state: "queued" };
        case "paused":
            return failed
                ? { label: "failed · assist?", state: "failed" }
                : { label: `paused · ${ref}`, state: "queued" };
        case "cancelled":
            return { label: `cancelled · ${ref}`, state: "queued" };
        default:
            return { label: ref, state: "queued" };
    }
}

const FAILURE_DETAILS: StatusDetail[] = ["failed", "runnerError", "webError", "stuck"];

function isFailure(task: AgentTaskRow): boolean {
    return task.statusDetail != null && FAILURE_DETAILS.includes(task.statusDetail);
}

/** Progress is optional run data — only cards whose task carries it show a bar. */
function progressOf(task: AgentTaskRow): number | undefined {
    const progress = task.data?.progress;
    return typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : undefined;
}

function agentInitials(task: AgentTaskRow): string {
    const fromRunner = task.runnerId?.match(/(\d+)\s*$/)?.[1];
    return `A${fromRunner ?? task.id}`;
}

function worktreeName(runnerId: string): string {
    return runnerId.startsWith("wt/") ? runnerId : `wt/${runnerId}`;
}

/**
 * Short display code for an issue, e.g. "PC 142". Issue ids are the one id
 * models.md keeps public, so no cyphering here.
 */
function issueCode(projectName: string): (id: number) => string {
    const initials = projectName
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 3)
        .toUpperCase();
    const prefix = initials || "KB";
    return (id: number) => `${prefix} ${id}`;
}

/* ------------------------------------------------------------------ */
/* Hero panel                                                          */
/* ------------------------------------------------------------------ */

const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_BUCKETS = 8;
const ACTIVE_STATUSES = ["scheduled", "running", "waiting", "paused"];
/** Log values that mark an activity bucket as a failure (coral bar). */
const FAILURE_VALUES = new Set(["failed", "runnerError", "webError", "stuck"]);

function hero(
    project: ProjectRow,
    issues: Map<number, IssueRow>,
    tasks: AgentTaskRow[],
    logs: LogRow[]
): HeroProject {
    const failedRuns = tasks.filter(isFailure).length;
    const needYou = tasks.filter(
        (task) =>
            task.status === "waiting" ||
            task.statusDetail === "question" ||
            task.statusDetail === "helpRequested"
    ).length;

    // A worktree per runner: the branch of that runner's most recent active
    // task (active = scheduled, running, waiting or paused).
    const active = new Map<string, AgentTaskRow>();
    for (const task of tasks) {
        if (!task.runnerId || !ACTIVE_STATUSES.includes(task.status)) continue;
        const name = worktreeName(task.runnerId);
        const current = active.get(name);
        if (!current || (task.updatedAt ?? "") > (current.updatedAt ?? "")) active.set(name, task);
    }

    const worktrees: HeroProject["worktrees"] = [];
    for (const [name, task] of Array.from(active.entries())) {
        const branch =
            typeof task.data?.branch === "string"
                ? task.data.branch
                : (issues.get(task.issueId)?.name ?? project.defaultBranch ?? "main");
        worktrees.push({ name, branch });
    }
    worktrees.sort((a, b) => a.name.localeCompare(b.name));

    return {
        name: project.name,
        worktrees,
        failedRuns,
        needYou,
        activity: activity(logs),
    };
}

/** 24h run activity, one bar per 3h bucket; `failed` buckets read coral. */
function activity(logs: LogRow[]): HeroProject["activity"] {
    const now = Date.now();
    const bucketMs = ACTIVITY_WINDOW_MS / ACTIVITY_BUCKETS;
    const counts = Array<number>(ACTIVITY_BUCKETS).fill(0);
    const failed = Array<boolean>(ACTIVITY_BUCKETS).fill(false);

    for (const log of logs) {
        const age = now - new Date(log.createdAt).getTime();
        if (age < 0 || age >= ACTIVITY_WINDOW_MS) continue;
        const index = ACTIVITY_BUCKETS - 1 - Math.floor(age / bucketMs);
        counts[index] += 1;
        if (log.newValue != null && FAILURE_VALUES.has(log.newValue)) failed[index] = true;
    }

    const max = Math.max(...counts);
    return counts.map((count, index) => ({
        h: count === 0 || max === 0 ? 0 : Math.max(12, Math.round((count / max) * 100)),
        failed: failed[index],
    }));
}

/* ------------------------------------------------------------------ */
/* Agent chat                                                          */
/* ------------------------------------------------------------------ */

type ChatEntry = ChatMessage & { at: string };

const CHAT_LIMIT = 4;

/** Latest agent notes and comments on this board's issues, oldest first. */
function chat(
    comments: CommentRow[],
    tasks: AgentTaskRow[],
    group: GroupRow | null,
    code: (id: number) => string,
    issues: Map<number, IssueRow>
): ChatMessage[] {
    const entries: ChatEntry[] = [];

    for (const comment of comments) {
        const issue = issues.get(comment.issueId);
        if (!issue) continue;
        const mine = group !== null && comment.userId === group.ownerId;
        entries.push({
            at: comment.createdAt,
            meta: `${mine ? "YOU" : `AGENT-${comment.userId}`} · ${code(issue.id)} · ${ago(comment.createdAt)}`,
            text: comment.content,
            mine,
        });
    }

    for (const task of tasks) {
        if (!task.statusMessage) continue;
        const issue = issues.get(task.issueId);
        if (!issue) continue;
        const at = task.updatedAt ?? task.createdAt;
        const who = (task.runnerId ?? `agent-${task.id}`).toUpperCase();
        entries.push({
            at,
            meta: `${who} · ${code(issue.id)} · ${ago(at)}`,
            text: task.statusMessage,
            mine: false,
        });
    }

    entries.sort((a, b) => b.at.localeCompare(a.at));
    return entries
        .slice(0, CHAT_LIMIT)
        .reverse()
        .map(({ meta, text, mine }) => ({ meta, text, mine }));
}

/* ------------------------------------------------------------------ */
/* Column mapping                                                      */
/* ------------------------------------------------------------------ */

const SPECIAL_KEY: Record<SpecialType, ColumnKey> = {
    backlog: "backlog",
    inProgress: "progress",
    inReview: "review",
    done: "review",
};
const POSITION_KEYS: ColumnKey[] = ["backlog", "ready", "progress", "review"];

/** Pill variant for a column: its special type, else its place on the board. */
function columnKey(column: ColumnRow): ColumnKey {
    if (column.specialType) return SPECIAL_KEY[column.specialType];
    return POSITION_KEYS[column.position % POSITION_KEYS.length];
}

/* ------------------------------------------------------------------ */
/* Date rendering                                                      */
/* ------------------------------------------------------------------ */

/** "14:15" for the last 24h, otherwise "Jul 25" (always local time). */
function stamp(iso: string): string {
    const date = new Date(iso);
    if (Date.now() - date.getTime() < ACTIVITY_WINDOW_MS) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Chat ages: "4M", "3H", older falls back to "JUL 25". */
function ago(iso: string): string {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 60) return `${Math.max(minutes, 1)}M`;
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)}H`;
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase();
}
