/**
 * Bridge action dispatch (webCommunicationSchemas.md → W<-S requests).
 *
 * One dispatch table per frame type: `REQUEST_HANDLERS` answers a request
 * (the returned value becomes the response payload; `null` is the optimistic
 * ack) and `MESSAGE_HANDLERS` routes fire-and-forget message frames — S→W
 * statuses are emitted, never received, so that table is empty at wave 1 but
 * still consulted so wave 3 adds entries here rather than inline.
 *
 * Error contract (client.ts's responder maps a thrown `.code` onto the error
 * frame, falling back to `internalError`):
 *   - unknown request action            → code "unknownAction"
 *   - malformed payload / illegal jump  → code "invalidPayload"
 *   - unknown message action            → log.warn + drop (no reply on a message)
 */

import { log, redact } from "./log.ts";
import type { Envelope } from "./protocol.ts";
import { assertTransition, type TransitionStatus } from "./stateMachine.ts";
import { buildSupervisorStatus } from "./status/supervisorStatus.ts";
import { createTask, getTask, updateTask } from "./tasks/store.ts";

/** Optimistic ack: client.ts sends it as the response payload (`payload: null`). */
type Ack = null;

/** A request handler: its resolved value is the response payload (`null` = ack). */
type RequestHandler = (frame: Envelope) => Promise<unknown> | unknown;

/** A message handler: fire-and-forget, there is no frame to answer. */
type MessageHandler = (frame: Envelope) => void;

/** Protocol error carrying a `code` that client.ts puts on the error frame. */
function actionError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
}

function invalidPayload(message: string): Error {
    return actionError("invalidPayload", message);
}

function unknownAction(action: string): Error {
    return actionError("unknownAction", `No handler registered for action "${action}"`);
}

/* ------------------------------------------------------------------ *
 * Payload guards — first breach throws invalidPayload; extra unknown
 * fields are accepted (the schema adds placeholders over time).
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(record: Record<string, unknown>, field: string, path: string): string {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
        throw invalidPayload(`agent.new: ${path} must be a non-empty string`);
    }
    return value;
}

function requireString(record: Record<string, unknown>, field: string, path: string): string {
    const value = record[field];
    if (typeof value !== "string") {
        throw invalidPayload(`agent.new: ${path} must be a string`);
    }
    return value;
}

function requireNumber(record: Record<string, unknown>, field: string, path: string): number {
    const value = record[field];
    if (typeof value !== "number") {
        throw invalidPayload(`agent.new: ${path} must be a number`);
    }
    return value;
}

function requireObject(record: Record<string, unknown>, field: string, path: string): Record<string, unknown> {
    const value = record[field];
    if (!isRecord(value)) {
        throw invalidPayload(`agent.new: ${path} must be an object`);
    }
    return value;
}

/** The validated subset of the `agent.new` payload this handler acts on. */
interface AgentNewPayload {
    agentTaskId: number;
    containerImage: string;
    taskIssueId: number;
    taskName: string;
    branchName: string | null;
}

function parseAgentNew(payload: unknown): AgentNewPayload {
    if (!isRecord(payload)) throw invalidPayload("agent.new: payload must be an object");

    const agentTaskId = payload.agentTaskId;
    if (typeof agentTaskId !== "number" || !Number.isInteger(agentTaskId) || agentTaskId < 0) {
        throw invalidPayload("agent.new: agentTaskId must be an integer >= 0");
    }

    // container: image/tag/cpuLimit/ramLimit/startupScript validated; other placeholders accepted as-is.
    const container = requireObject(payload, "container", "container");
    const containerImage = requireNonEmptyString(container, "image", "container.image");
    requireString(container, "tag", "container.tag");
    requireNumber(container, "cpuLimit", "container.cpuLimit");
    requireNumber(container, "ramLimit", "container.ramLimit");
    requireString(container, "startupScript", "container.startupScript");

    // agent: runtime + model.{provider,defaultModelName}; placeholders accepted as-is.
    const agent = requireObject(payload, "agent", "agent");
    requireString(agent, "runtime", "agent.runtime");
    const model = requireObject(agent, "model", "agent.model");
    requireString(model, "provider", "agent.model.provider");
    requireString(model, "defaultModelName", "agent.model.defaultModelName");

    // git: url (non-empty), baseBranch, auth.type; branchName is string | null (null → generated below).
    const git = requireObject(payload, "git", "git");
    requireNonEmptyString(git, "url", "git.url");
    requireString(git, "baseBranch", "git.baseBranch");
    const auth = requireObject(git, "auth", "git.auth");
    requireString(auth, "type", "git.auth.type");
    const branchName = git.branchName ?? null;
    if (branchName !== null && typeof branchName !== "string") {
        throw invalidPayload("agent.new: git.branchName must be a string or null");
    }

    // task: issueId (number) + name (string).
    const task = requireObject(payload, "task", "task");
    const taskIssueId = task.issueId;
    if (typeof taskIssueId !== "number") throw invalidPayload("agent.new: task.issueId must be a number");
    const taskName = task.name;
    if (typeof taskName !== "string") throw invalidPayload("agent.new: task.name must be a string");

    return { agentTaskId, containerImage, taskIssueId, taskName, branchName };
}

/** `${task.issueId}-${slug(task.name)}` — tryNumber omitted on the first attempt, per schema. */
function branchNameFor(issueId: number, name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${issueId}-${slug}`;
}

/* ------------------------------------------------------------------ *
 * Request handlers
 * ------------------------------------------------------------------ */

function handleAgentNew(frame: Envelope): Ack {
    const payload = parseAgentNew(frame.payload);
    const { agentTaskId, containerImage, taskIssueId, taskName, branchName } = payload;

    // Duplicate *live* agentTaskId → invalidPayload (completed/cancelled are not live).
    const existing = getTask(agentTaskId);
    if (existing && existing.status !== "completed" && existing.status !== "cancelled") {
        throw invalidPayload(`agentTaskId ${agentTaskId} already live`);
    }

    const branch = branchName ?? branchNameFor(taskIssueId, taskName);
    try {
        createTask({ agentTaskId, branch });
    } catch (error) {
        // createTask throws on any id already in the store (incl. a terminal one
        // teardown has not removed yet) — that is a bad payload for B, not an internal fault.
        if (existing) throw invalidPayload(`agentTaskId ${agentTaskId} already live`);
        throw error;
    }

    // WAVE-3 HOOK: tasks/lifecycle.ts startTask() — spin container + worktree + ACP session.
    // At wave 1 it is log-only: nothing async stands between validation and the ack.
    log.info("agent.new: lifecycle.startTask stub (wave 3)", {
        agentTaskId,
        container: redact(containerImage),
        branch: redact(branch),
        name: redact(taskName),
    });

    // Optimistic ack: return null — client.ts sends the response the moment this returns,
    // before any (future) lifecycle work.
    return null;
}

/** The only statuses B may push W<-S: running only ever arrives from paused|waiting (state machine). */
const AGENT_STATUSES: readonly string[] = ["paused", "completed", "cancelled", "running"];

function handleAgentStatus(frame: Envelope): Ack {
    const payload = frame.payload;
    if (!isRecord(payload)) throw invalidPayload("agent.status: payload must be an object");

    const agentTaskId = payload.agentTaskId;
    if (typeof agentTaskId !== "number" || !Number.isInteger(agentTaskId) || agentTaskId < 0) {
        throw invalidPayload("agent.status: agentTaskId must be an integer >= 0");
    }
    const status = payload.status;
    if (typeof status !== "string" || !AGENT_STATUSES.includes(status)) {
        throw invalidPayload(
            `agent.status: status must be paused|completed|cancelled|running (got ${redact(status)})`,
        );
    }
    const to = status as TransitionStatus;

    const task = getTask(agentTaskId);
    if (!task) throw invalidPayload(`agent.status: unknown agentTaskId ${agentTaskId}`);

    const from = task.status;
    // Throws invalidPayload on an illegal jump (running only from paused|waiting; terminals frozen).
    assertTransition(from, to);

    // Wave-1 store write — the hook point wave 3 extends with the real effects below.
    updateTask(agentTaskId, { status: to, statusDetail: null });
    // WAVE-3 HOOK: paused → container pause; running → unpause + ACP reattach (§6); cancelled → teardown (§10); completed → merge (§5) then teardown.
    // Failures after the ack are reported via emitStatus(cancelled + runnerError) in wave 3; log only now.
    log.info("agent.status: lifecycle effect stub (wave 3)", { agentTaskId, from, to });

    // Optimistic ack: null goes out as soon as this returns; the effects above are
    // synchronous stand-ins, never container/ACP work.
    return null;
}

/* ------------------------------------------------------------------ *
 * Dispatch tables
 * ------------------------------------------------------------------ */

const REQUEST_HANDLERS: Record<string, RequestHandler> = {
    "agent.new": handleAgentNew,
    "agent.status": handleAgentStatus,
    "supervisor.status": () => buildSupervisorStatus(),
    // DECISION: agent.answer / agent.feedback are deliberately absent — an early
    // request falls through to unknownAction rather than half-answering.
    // wave 3: agent.answer / agent.feedback land here.
};

/**
 * S→W only at wave 1: the supervisor EMITS statuses, it never receives them.
 * Still routed through the table so wave 3 registers entries here (not inline).
 */
const MESSAGE_HANDLERS: Record<string, MessageHandler> = {};

/** Answer a request frame; the returned value becomes the response payload. */
export function handleRequest(frame: Envelope): Promise<unknown> | unknown {
    const handler = frame.action != null ? REQUEST_HANDLERS[frame.action] : undefined;
    if (!handler) throw unknownAction(frame.action ?? "");
    return handler(frame);
}

/** Route a fire-and-forget message frame; unknown actions are logged and dropped. */
export function handleMessage(frame: Envelope): void {
    const handler = frame.action != null ? MESSAGE_HANDLERS[frame.action] : undefined;
    // No reply exists on a message — drop with a warning (per schema rules).
    if (!handler) {
        log.warn(`No handler registered for message action "${redact(frame.action)}"`, {
            action: frame.action,
        });
        return;
    }
    handler(frame);
}