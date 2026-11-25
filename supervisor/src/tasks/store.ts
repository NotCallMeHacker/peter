/**
 * In-memory task store for the supervisor.
 *
 * Backed by a module-scoped `Map<number, TaskContext>` — deliberately NOT exported:
 * callers go through the accessors below so there is exactly one place that owns
 * task state (and one place to add validation/persistence later).
 *
 * Single-writer by convention: only the lifecycle (wave 3) mutates a task's runtime
 * fields; actions.ts creates/updates at wave 1. (The wave-1 exception is actions.ts's
 * initial creation + status transitions.)
 *
 * `TaskContext` is a FROZEN contract — other tracks read it; field names/types are exact.
 */

/** Lifecycle status of a task. Terminal states: `completed`, `cancelled`. */
export type TaskStatus = "scheduled" | "running" | "waiting" | "paused" | "completed" | "cancelled";

/** Why a task is in its current status (nullable — most statuses have no detail). */
export type TaskStatusDetail = "question" | "inReview" | "stuck" | "helpRequested" | "failed" | "runnerError";

/** QUESTION shape from webCommunicationSchemas.md */
export interface TaskQuestion {
    questionId: string;
    questionText: string;
    options: string[];
    allowFreeText: boolean;
    allowMultipleSelections: boolean;
    allowFileUpload: boolean;
}

/** FROZEN contract — other tracks read it, field names exact. */
export interface TaskContext {
    agentTaskId: number;
    status: TaskStatus;
    statusDetail: TaskStatusDetail | null;
    containerId?: string;
    worktreePath?: string;
    branch: string;
    question?: TaskQuestion[];
    acp?: unknown; // opaque ACP session handle (wave 3+ fills it)
    createdAt: number; // Date.now() ms
    lastReportedAt: number; // Date.now() ms
}

/** Module-scoped store; accessors only (not exported). */
const tasks = new Map<number, TaskContext>();

/**
 * Single-writer by convention: only the lifecycle (wave 3) mutates a task's runtime
 * fields; actions.ts creates/updates at wave 1. (The wave-1 exception is actions.ts's
 * initial creation + status transitions.)
 *
 * Creates a new task. Throws a plain `Error` if `agentTaskId` already exists.
 * `createdAt`/`lastReportedAt` = `Date.now()`; defaults: `status: "scheduled"`, `statusDetail: null`.
 */
export function createTask(input: {
    agentTaskId: number;
    branch: string;
    status?: TaskStatus;
    statusDetail?: TaskStatusDetail | null;
}): TaskContext {
    if (tasks.has(input.agentTaskId)) {
        throw new Error(`agentTaskId ${input.agentTaskId} already exists`);
    }
    const now = Date.now();
    const task: TaskContext = {
        agentTaskId: input.agentTaskId,
        status: input.status ?? "scheduled",
        statusDetail: input.statusDetail ?? null,
        branch: input.branch,
        createdAt: now,
        lastReportedAt: now,
    };
    tasks.set(input.agentTaskId, task);
    return task;
}

/** Returns the task, or `undefined` if the id is unknown. */
export function getTask(agentTaskId: number): TaskContext | undefined {
    return tasks.get(agentTaskId);
}

/**
 * Shallow-merges `patch` into the task (agentTaskId/createdAt are immutable).
 * Returns the updated task, or `undefined` if the id is unknown.
 */
export function updateTask(
    agentTaskId: number,
    patch: Partial<Omit<TaskContext, "agentTaskId" | "createdAt">>,
): TaskContext | undefined {
    const task = tasks.get(agentTaskId);
    if (task === undefined) {
        return undefined;
    }
    Object.assign(task, patch);
    return task;
}

/** Snapshot of all tasks in insertion order. */
export function listTasks(): TaskContext[] {
    return [...tasks.values()];
}

/** Removes a task; returns `true` if one was removed. */
export function removeTask(agentTaskId: number): boolean {
    return tasks.delete(agentTaskId);
}
