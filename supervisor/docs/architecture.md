# Architecture

## Overview

This document outlines the architecture of the agent runner system.

There is **no separate "border" process**. The Supervisor drives the agent runtime
(Pi / OMP) directly over **stdio using the Agent Client Protocol (ACP)**; Docker is
what carries that stdio across the container wall. The only other thing that needs to
leave the container is the agent's tool traffic to the Supervisor's MCP servers, and
that goes through a small **MCP proxy** on a mounted UNIX socket.

```mermaid
architecture-beta
    group web(cloud)[Web]

    service interface(internet)[Web Interface] in web
    service db(database)[Database] in web

    db:T -- B:interface

    group host(cloud)[Supervisor Host]

    group supervisor(server)[Supervisor Container] in host

    service control(cloud)[Supervisor] in supervisor
    service mcp-servers(server)[MCP Servers (git/question)] in supervisor

    group agent(server)[Agent Containers] in supervisor

    service runtime(server)[Pi / OMP] in agent
    service mcp-proxy(server)[MCP Proxy] in agent
    service worktree(disk)[/workspace] in agent

    control:L <-[WSS]-> R:interface
    control:R <-[ACP over stdio]-> L:runtime
    mcp-servers:R -[Unix Socket]- L:mcp-proxy
    mcp-servers:T -- B:control
    mcp-proxy:T -- B:runtime
    worktree:B -- T:runtime
```

The nesting is load-bearing: the **agent containers are children of the Supervisor
container**, not siblings on the host. The Supervisor container runs its own Docker daemon
(Docker-in-Docker) and creates agent containers on *that* daemon, so the host's Docker
daemon never sees them and the host needs no Docker access from the Supervisor. "Inside the
Supervisor container" is the Docker-in-Docker sense: a child container on the Supervisor's
own daemon.

## Components

### Supervisor

The Supervisor is itself **only ever deployed as a Docker container** so that it can be
managed and scaled by the orchestrator; it is not a host process. The current
`supervisor/src/` implementation is the bridge client only — the real Supervisor
(Docker runtime, git, ACP) does not exist yet.

- Runs agent runtimes in isolated containers via **Docker-in-Docker**: it talks to its
  own Docker daemon, not the host's, and the agent containers are therefore children of
  the Supervisor container. The Supervisor must hold no mount of the host's socket and
  must not create containers on the host daemon, otherwise this isolation is gone.
- One agent container per `agentTaskId`. The agent runtime has no lifecycle of its own:
  it is only ever created, configured and destroyed by the Supervisor.
- Owns the **ACP session** with Pi / OMP over the container's stdio (attach/exec with
  stdin+stdout).
- Monitors CPU and RAM usage per container. `cpuLimit` / `ramLimit` **throttle**, they
  never kill the container on their own. Disk and network limits are not enforced (Docker
  has none out of the box); they are accepted in the payload and ignored for now.
- Sets up and mounts `/workspace`: it clones the project repo (if it does not have it
  already), creates the worktree and mounts it into the container. See
  [Git workspaces](#git-workspaces).
- Mounts the pi/omp session log dirs and general log dirs for collection
- Mounts and configures the MCP Proxy socket in `/sockets`
- Runs the **Question MCP Server** (a real MCP server) that the agent's tools talk to
  through the MCP proxy.
- Supervisor <-> Web Interface communication is a single WSS connection to
  `wss://URL/api/agent-runner`, using the schemas in
  [webCommunicationSchemas.md](webCommunicationSchemas.md).
- If the Web Interface is unreachable for **30s**, the Supervisor **pauses all**
  containers instead of killing them. Once the link is back, the containers resume and
  the ACP sessions are re-attached.
- Token accounting and log streaming are done at a later date; both will be derived
  from ACP `session_update`s (see [Later versions](#later-versions)).

### Runtime (in container)

#### Container

- Minimal filesystem. Only `/workspace`, `/tmp`, the log directories and the Pi/OMP
  code and runtime directories are writable.
- No git access, no repo and no credentials: the repo, worktree, branches, commits and
  merges are all managed by the Supervisor.
- Cannot reach the host filesystem (only the explicit mounts below) and cannot talk to
  the Docker daemon. It is a child of the Supervisor container on the Supervisor's own
  DinD daemon, so it can neither see nor be seen by host containers.
- Has its own loopback interface. Outbound internet is allowed, but the host machine's
  public address range is blocked so a container cannot call back into the host.
- CPU and RAM are limited (throttling, not killing) by the Supervisor. Disk and network
  limits are deferred.
- Only mounts:
    - the task's `/workspace` worktree (read/write, owned by the Supervisor),
    - the log directories,
    - the MCP proxy's UNIX socket (the only channel back to the Supervisor's MCP
      servers).
- The container image provides Pi / OMP and has to be built to fit these restrictions;
  the Supervisor never installs or configures a runtime beyond passing its startup
  arguments, environment, model provider, model name and token.
- `startupScript` from `agent.new` is executed inside the container. The Web Interface
  is fully trusted, so the Supervisor treats the script as legitimate input

#### Agent

- Runs Pi or OMP as the agent runtime (extendable to more).
- Configured once at start — for the whole session — with the model (provider, base URL,
  model name) and its key. **Only the model token ever enters the container.** Git
  credentials, database credentials and everything else stay in the Supervisor.
- Plugins and runtime configuration are supplied by the Supervisor at session start.
- Has no git repository or git binary contract of its own: every git operation is an MCP
  tool call served by the Supervisor (read-only operations plus commits on its own
  branch).
- Talks ACP over stdio to the Supervisor and calls the Supervisor's MCP servers through
  the mounted MCP proxy socket.

#### MCP proxy

- A tiny process/entrypoint in the container that exposes a UNIX socket (mounted from the Supervisor) as an MCP endpoint to the agent runtime. It does not interpret the MCP
  traffic; it only forwards it across the container wall.
- This is how the agent reaches the **Question MCP Server** (and any future Supervisor
  MCP servers) without any network access to the Supervisor.
- The proxy is an implementation detail of the image, not a separate application layer.
- MCP Messages to the Supervisor can't be ran by a sub-agent and can't have a timeout, especially when waiting for the user to answer a question.

#### Question MCP Server (Supervisor side)

- The product's question tool is rebuilt as a real **MCP server running inside the
  Supervisor**. It is not a special ACP permission request.
- An agent call to `ask_user_question` becomes an S->W `agent.status` message with
  `status: "waiting"`, `statusDetail: "question"` and the `questions` array. The W->S
  `agent.answer` request resolves the pending MCP tool call with the user's answers
  (one entry per question in `questions`, all covered in a single request), and the
  session resumes.
- The same server exposes the **review summary** call: when a round is finished, the agent
  makes one final MCP call carrying the review summary, and only then pauses. The
  Supervisor turns that into the `waiting` / `inReview` `agent.status` message with
  `reviewSummary`, so the web interface can persist it as the review comment.

### Git workspaces

- The Supervisor owns all git state; the container only ever sees a mounted worktree.
- On `agent.new` the Supervisor clones the project repository (if not already present on
  its volume), then creates a worktree for the task from `git.baseBranch`.
- Branch naming is `ISSUEID-TRYNUMBER-name-of-the-issue`: the issue id, then the try
  number, then the issue title shortened and sanitized to be git-safe. The try number is
  omitted on the first attempt, e.g. `42-fix-login-redirect` and then
  `42-2-fix-login-redirect`. A caller-supplied `git.branchName` overrides the generated
  name.
- Commits happen **only on the task's own branch**; the agent may inspect the workspace
  (status, diff, log) but cannot switch branches, check out arbitrary refs, push or merge.
- When the task is reported `completed` (W->S `agent.status`), the Supervisor merges the
  task's branch into `git.baseBranch`.
    - Merge conflicts are handed to a human, the same agent, or a dedicated merge agent,
      depending on configuration.
- For testing purposes the created branches and the session are kept after completion.
  A later version removes the branch after a successful merge; an even later one may
  merge without keeping the worktree.
- Git credentials (`token`, `sshKey`) and the git URL stay in the Supervisor and are
  never mounted into or exported to the container.

### Logs and reconstruction (POC scope)

- Pi / OMP write their own code logs; the Supervisor writes supervisor logs.
- The **POC assumes the Supervisor does not restart.** If only the Supervisor restarts,
  the agent containers keep running; the Supervisor re-attaches to the running containers
  and the ACP sessions and continues.
- Full reconstruction (restoring state from backups and logs after a Supervisor crash or
  reboot) is a later version.

## Lifecycle

1. W->S `agent.new`. The Supervisor replies with `null` **on reception** — acceptance, not
   startup (see the schema doc).
2. The Supervisor clones/updates the repo and creates the worktree, pulls the
   container image, creates the container (limits, env, mounts, startup script), mounts the worktree into it (with no .git exposed to the container) and
   starts the agent runtime with the model configuration.
3. The Supervisor opens the ACP session over stdio and reports `running` via S->W
   `agent.status`.
4. The agent works. Questions become `waiting` / `question` messages; the review summary
   produces `waiting` / `inReview`.
5. `agent.feedback` is delivered as a new prompt in the **same** ACP session and resumes
   it; `agent.answer` resolves the pending question tool call once every question of the
  round is answered.
6. W->S `agent.status` commands pause/resume/cancel; `completed` triggers the merge.
7. Containers are destroyed (or kept, in test mode) when the task reaches a terminal
   state, or paused after the 30s Web Interface outage rule.

## Failure handling

- Everything is optimistic: W->S `agent.new` and W->S `agent.status` are acknowledged as
  soon as they are received, not when the effect lands. Failures are reported back with
  an S->W `agent.status` message.
- Startup problems (clone failure, image pull failure, container start failure, ACP
  handshake failure) are reported as `cancelled` + `statusDetail: "runnerError"` with a
  `statusMessage` describing what happened. The same applies to OOM, unexpected container
  exit and merge failures.
- A dropped WSS link does not stop the agents immediately: after 30s without the Web
  Interface, all containers are paused. On reconnect they are resumed and re-attached.

## Later versions

- Enforce disk and network limits.
- Log stream: derive `agent.log` chunks from ACP `session_update`s and write them to the
  log store directly.
- Token accounting: read usage from ACP and write it to the metrics store.
- Metrics (CPU/RAM/disk/network, tokens) and program logs in the database.
- Publish ports so a human can interact with an agent directly.
- Restricted internet proxy for agent containers.
- State backups, reconstruction after a Supervisor crash/reboot, run logs.
- Branch cleanup after merge; alternative merge strategies (remove branch, merge agent).
