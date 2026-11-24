# Wrapper
Bcs there is no request/response model in WS/WSS we are building our own simplified version

## General Wrapper
Every frame sent over the WSS connection is wrapped in this envelope. The actual payload (as defined in the sections below) goes into `payload`.

```json
{
    "schemaVersion": "string", // semver of this schema; current: "1.0.0"; receivers must reject any version they do not support exactly
    "type": "message|request|response|error",
    "id": "string|null", // correlation id (UUIDv4); required for request/response/error, always null for message
    "action": "string|null", // identifies the payload, e.g. "agent.new" | "agent.status" | "agent.answer" | "supervisor.status"; required for message and request, null for response/error (taken from the request)
    "payload": {}|null, // the schema defined by the matching section below; null when error
    "error": { // only set when type is "error", otherwise null
        "code": "string", // machine readable, e.g. "unknownAction" | "invalidPayload" | "unsupportedSchemaVersion" | "internalError"
        "message": "string" // human readable (max 1000 chars)
    }|null
}
```

### Rules
- `type` semantics:
    - `message`: fire-and-forget, no response is sent (e.g. S->W status updates, log stream chunks)
    - `request`: expects exactly one `response` or `error` with the same `id`
    - `response`: successful reply to a `request`, echoes the request's `id` and `action`, carries the result in `payload`
    - `error`: failed reply to a `request`, echoes the request's `id`, `action` is null, `payload` is null, details in `error`
- Unknown `action` on a `request` → reply with `type: "error"`, `code: "unknownAction"`
- Invalid `payload` → reply with `type: "error"`, `code: "invalidPayload"`
- Unsupported `schemaVersion` → reply with `type: "error"`, `code: "unsupportedSchemaVersion"`
    - The rule is to reject **any** wrong version, not only a different major. Both implementations currently support exactly `"1.0.0"` (`supervisor/src/protocol.ts`, `web/server/bridge/protocol.ts`); bumping the constant is what adds support for a new version.
- Requests must be answered exactly once; unsolicited `response`/`error` frames (unknown `id`) must be dropped and logged
- One frame per WebSocket message; frames must not be fragmented across messages

Example request:
```json
{
    "schemaVersion": "1.0.0",
    "type": "request",
    "id": "6f1d2b7e-9c4a-4f0b-8e3d-2a5c7b9d1e4f",
    "action": "supervisor.status",
    "timestamp": "2026-11-21T12:00:00Z",
    "payload": {},
    "error": null
}
```

Example error response:
```json
{
    "schemaVersion": "1.0.0",
    "type": "error",
    "id": "6f1d2b7e-9c4a-4f0b-8e3d-2a5c7b9d1e4f",
    "action": null,
    "timestamp": "2026-11-21T12:00:01Z",
    "payload": null,
    "error": {
        "code": "unknownAction",
        "message": "No handler registered for action \"supervisor.statusx\""
    }
}
```

# Schemas for communication between the supervisor and web interface
- Everything is sent over WSS.
- We communicate with WSS://URL/api/agent-runner
- Metrics and program logs are **not** part of this schema and their storage is deferred (see `architecture.md` → Later versions). Everything a user needs (status, agent logs, questions, ...) goes through the web interface.
- The web interface owns all state: it validates transitions and persists status to the DB. The Supervisor only *reports* observed state (S->W) and *executes* commands (W->S).
- Every ID is internal, except when explicitly stated otherwise
- Agent containers are children of the Supervisor container on its own Docker-in-Docker daemon; the host Docker daemon is never involved (see `architecture.md` → Overview).

## Delivery and acknowledgement
- Commands are acknowledged **optimistically**: W->S `agent.new` and W->S `agent.status` reply with `null` as soon as the frame is received and validated, not when the effect has landed (a container may take minutes to pull and start).
- Any failure after that acknowledgement is reported back with an S->W `agent.status` message carrying `status: "cancelled"` and `statusDetail: "runnerError"` (or the appropriate status). This includes **startup problems**: clone failure, image pull failure, container start failure, ACP handshake failure, and the startup script failing.
- A dropped WSS link does not immediately stop the agents. If the Supervisor cannot reach the Web Interface for **30s**, it pauses all containers. When the link returns it resumes them and re-attaches the ACP sessions; nothing is lost because the containers were paused, not killed.

## Transport and the ACP session
- The Supervisor talks the Agent Client Protocol to Pi / OMP over the container's **stdio**, so Docker carries the protocol across the container wall.
- `agent.feedback` is a new prompt in that same session; `agent.answer` resolves a pending Question MCP tool call; a task's model and key are configured into the runtime once, for the whole session.
- The only other channel into the container is the MCP proxy's mounted UNIX socket, which carries the Supervisor's MCP servers (questions, review summary, git) without network access to the Supervisor.

Definitions:
- W: Web interface
- S: Supervisor

so:
W->S: Web interface sends a message to the supervisor
S->W: Supervisor sends a message to the web interface

## W->S | New Agent
- `type`: `request`
- `action`: `agent.new`
- Response payload: `null` (accepted) or `error`

Creates one agent task. The Supervisor owns everything the agent does not need to see:
the container, the worktree and the git credentials. 
Only the model token is handed to the container.

The Supervisor accepts the frame and replies `null` immediately; it then clones the repo, creates the worktree, pulls the image, starts the container, mounts the worktree and opens the ACP session.
**Startup problems are reported with an S->W `agent.status` message**
(`cancelled` + `runnerError`), never by failing this request late.

```json
{
    "agentTaskId": number,
    "containerConfigId": "string", // Placeholder for later use
    "container": { // May be removed later
        "image": "string",
        "tag": "string",
        "env": {}, // Placeholder for later use
        "ports": [number], // Placeholder for later use
        "cpuLimit": number, // in millicores, e.g. 1000 = 1 core; throttles, never kills
        "ramLimit": number, // in bytes; throttles, never kills
        "diskLimit": number, // in bytes; accepted but NOT enforced yet
        "networkSpeedLimit": number|null, // in bits per second; accepted but NOT enforced yet
        "networkSendLimit": number|null, // max total bytes sent; accepted but NOT enforced yet
        "networkReceiveLimit": number|null, // max total bytes received; accepted but NOT enforced yet
        "startupScript": "string" // executed inside the container; the web interface is trusted
    },
    "agent":{
        "runtime": "pi|omp", // more will be added
        "runtimeConfig": {}, // Placeholder for more config
        "model": {
            "provider": "openrouter|openai|anthropic|...",
            "baseUrl": "string|null",
            "defaultModelName": "string",
            "token": "string|null", // Will be replaced with a secrets ref later on
        }
    },
    "git": {
        "url": "string",
        "branchName": "string|null", // working branch. When null the Supervisor generates ISSUEID-TRYNUMBER-name-of-the-issue (try number omitted on the first attempt, e.g. "42-fix-login", then "42-2-fix-login")
        "baseBranch": "string", // source and merge target
        "auth": {
            "type": "none|token|ssh",
            "token": "string|null", // PAT / deploy token / GitHub App installation token; never logged; used only by the Supervisor, never mounted into the container; will be replaced by a secrets ref later on
            "sshKey": "string|null", // SSH private key; never logged; used only by the Supervisor, never mounted into the container; will be replaced by a secrets ref later on
        }
    },
    "permissions": {}, // Placeholder
    "plugins": {}, // Placeholder
    "task": {
        "issueId": number,
        "column": "string",
        "name": "string",
        "description": "string",
        "labels": ["string"],
        "discussion": DISCUSSION, // see below
        "additionalInfo": "string" // everything else the agent needs to know about the task and the project including setup instructions, test instructions,...
    }
}
```
The Supervisor clones the repository (if it does not already have it), creates a worktree
for this task from `baseBranch` and mounts it as `/workspace`. The container gets no repo
of its own, no git credentials and no git binary contract: every git operation the agent
performs is an MCP tool call served by the Supervisor (read-only operations, plus commits
on its own branch — no checkout, no push, no merge). Only the model token is configured
into the runtime.

On `completed` the Supervisor merges the task branch into `baseBranch`. Merge conflicts
are handed to a human, the same agent, or a dedicated merge agent, depending on
configuration. For the POC the branch and the session are kept after completion.

### DISCUSSION
List of all comments and discussions attached to the task
TODO: Cap discussion size
```json
[
    {
        "id": "string",
        "replyTo": "string|null", // id of the comment this is replying to
        "author": "string",
        "timestamp": "string", // ISO 8601 format
        "content": "string",
        "isEdited": "boolean"
    }
]
```

## S->W | Agent Status Update
- `type`: `message`
- `action`: `agent.status`

Reports the observed state of the agent task to the web interface, which validates the transition and persists it to the DB (the Supervisor has no direct write access to task status). Details are only needed, when the status is not "running"

```json
{
    "agentTaskId": number,
    "status": "running|waiting|completed|paused|cancelled", // ENUM from web/db/models/models.md#Models##agentTask.status
    "statusDetail": "question|inReview|stuck|helpRequested|failed|runnerError|null", // ENUM from web/db/models/models.md#Models##agentTask.statusDetail
    "statusMessage": "string|null", // further details about the status (max 1000 chars)
    "questions": QUESTION|null,
    "reviewSummary": "string|null", // the round's review summary (markdown: what changed and why, max 10000 chars); required when statusDetail is "inReview", null otherwise
    "data": {}|null, // full data package (up to 10MB)
}
```
For status: 
- The WebError can only be produced on the Web Interface, so the Supervisor cant send it
- The scheduled status is the default when starting a new Task, so we also cant send it
- The cancelled status is also used for critical errors in both the supervisor, the runtime or the agent runtime. The RunnerError is to be set in those cases.
- Paused means the user paused the task. The container still exists and is Docker-paused.
- Waiting means the task is blocked on human interaction (question, inReview, helpRequested). The container stays alive so the round can resume with warm context. It may be Docker-paused after a timeout.
- inReview is always paired with waiting: the round is finished and the container idles (it may be paused) until the review resolves 
    - request changes -> waiting -> running
    - approve -> merge -> completed
- question is also paired with waiting
- The agent calls the Supervisor's Question MCP server (`ask_user_question`), the Supervisor forwards it here as `waiting`/`question`, and W->S `agent.answer` resolves that pending MCP call.
- **The review summary is produced by the agent itself.** When a round is done the agent makes one final MCP call carrying the summary and only then pauses; the Supervisor reports it as `waiting`/`inReview` with `reviewSummary` filled.
- If the Supervisor loses the Web Interface for 30s it pauses all containers and reports `paused` when the link returns. Reconnect/resume is a pause + re-attach, not a restart.
- When `statusDetail` is `"inReview"`, `reviewSummary` carries the round's summary (markdown: what changed and why, max 10000 chars — the comment length limit). The web interface persists it as a special review comment on the issue (authored by the agent) [#11](https://github.com/NotCallMeHacker/peter/issues/11), so the reviewer sees what this round changed and why without reading raw logs. The comment becomes part of the issue discussion and is therefore included in `task.discussion` on the next `agent.new` and in `agent.feedback`. This was previously a separate `agent.review` message sent alongside `agent.status`; it is now part of this payload so one message carries the whole state change (web implementations must reject a `waiting`/`inReview` status update without a `reviewSummary`).

Flow: 
- scheduled -> cancelled|running 
- running -> waiting|paused|completed|cancelled
- waiting -> running|cancelled
- paused -> running|cancelled

### QUESTION
One or many questions that the agent has for the user (no timeout for now).

```json
[
    {
        "questionId": "string",
        "questionText": "string",
        "options": ["string"],
        "allowFreeText": "boolean",
        "allowMultipleSelections": "boolean",
        "allowFileUpload": "boolean", // Placeholder for later use
    }
]
```

## W->S | Agent Status Update
- `type`: `request`
- `action`: `agent.status`
- Response payload: `null` (accepted) or `error`

Commands the Supervisor to act on the container (pause, resume, cancel, merge). The web
interface has already persisted the status; the Supervisor confirms as soon as the frame
is received and reports any failure afterwards with an S->W `agent.status` message. Only
paused, completed or cancelled are allowed

```json
{
    "agentTaskId": number,
    "status": "paused|completed|cancelled|running", // ENUM from web/db/models/models.md#Models##agentTask.status
}
```
status running can only be set, when old status is paused or waiting (resume after a user pause, or after the review resolved with request changes)

`completed` merges the task branch into `baseBranch` before the container is removed. A
merge conflict is reported back as an S->W `agent.status` message and handled per
configuration (human, same agent, or a merge agent). For the POC the branch and the ACP
session are kept after completion.

## W->S | Agent Answer
- `type`: `request`
- `action`: `agent.answer`
- Response payload: `null` (accepted) or `error`

Sends the answer to a question from the agent. On the Supervisor this resolves the
pending Question MCP tool call, which resumes the agent session.

```json
{
    "agentTaskId": number,
    "questionId": "string",
    "answerText": "string|null", // free text answer
    "selectedOptions": ["string"], // selected options from the question
    "uploadedFiles": ["string"], // Placeholder for later use
}
```

## W->S | Agent Feedback
- `type`: `request`
- `action`: `agent.feedback`
- Response payload: `null` (accepted) or `error`

Sends the review feedback to the agent so it can address it. Sent while the task is
`waiting`/`inReview`. The Supervisor delivers the comments as a **new prompt in the same
ACP session**; that prompt is what ends the wait, so **`agent.feedback` resumes the session
by itself** — no separate `agent.status` request is needed to go `waiting -> running`. The
Supervisor reports the resulting `running` state with an S->W `agent.status` message.

```json
{
    "agentTaskId": number,
    "comments": DISCUSSION // review comments to address, same shape as agent.new task.discussion
}
```

## S->W | Agent Log Stream
- `type`: `message`
- `action`: `agent.log`

For later versions
Sends a log stream from the agent to the web interface. The log stream is sent in chunks,
each chunk is a JSON object. Source: ACP `session_update`s, written to the log store.

## W->S | Start interactive session
- `type`: `request`
- `action`: `session.start`
- Response payload: `null` (accepted) or `error`

For later versions. Opens a human-facing interactive session against a running agent. The Supervisor owns the ACP session, so this is a second view onto it, not a second agent.

## W->S | Get Supervisor Status
- `type`: `request`
- `action`: `supervisor.status`
- Response payload: see S->W | Supervisor Status

Requests the current status of the Supervisor
(empty)

## S->W | Supervisor Status
- `type`: `message`
- `action`: `supervisor.status`

Sends the current status of the Supervisor itself

```json
{
    "status": "available|full|error|unavailable",
    "statusMessage": "string", // human readable status message (max 1000chars)
    "data": {}|null // full data package (up to 10MB)
}
```

A supervisor that cannot reach the web interface cannot report anything; the 30s pause
rule in [Delivery and acknowledgement](#delivery-and-acknowledgement) is the recovery path.