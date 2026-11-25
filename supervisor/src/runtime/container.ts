/**
 * Agent container lifecycle (plan §4 `[W1/A]` `runtime/container.ts`).
 *
 * The only module that creates/starts/inspects agent containers and the only one
 * that knows how to hijack a docker exec — `acp/spawn.ts` delegates its transport
 * to `execStream()` (plan §6). Self-contained: config + log + dockerode only.
 *
 * Verified mapping (plan §4, `docker inspect` round-trip):
 *  - `NanoCpus = cpuLimit * 1e6` (millicores → nanos; 1500 ⇒ 1500000000),
 *  - `Memory = ramLimit` bytes, `MemorySwap = Memory` (pins swap to zero headroom),
 *  - `PidsLimit = 128`, `NetworkMode = "bridge"`,
 *  - `LogConfig = json-file max-size 10m / max-file 3` — a chatty agent must not
 *    fill the DinD volume; the same log is mirrored to `<logsDir>/<id>/container.log`.
 *
 * Mounts — EXACTLY three (architecture.md §"Container"): worktree → `/workspace`,
 * `agentDir` → `/home/agent/.pi/agent`, the single proxy SOCKET FILE →
 * `/sockets/mcp.sock`. Never the git dir, never the repo, never credentials, and
 * never `socketsDir` itself (a directory mount would expose every sibling task's
 * socket — one shared dir, one socket per task).
 *
 * Env is composed here from the fixed keys only (`PI_CODING_AGENT_DIR`,
 * `PETER_MODEL_TOKEN`, `agent.runtimeConfig`, `startupScript`, `task.issueId`).
 * `spec.env` is an accepted placeholder and is NEVER merged: `container.env` would
 * let the payload inject arbitrary variables into a container that also holds the
 * model token (plan §4).
 *
 * Accepted-but-never-applied (doc mandates enforcement later): `diskLimit`,
 * `networkSpeedLimit`, `networkSendLimit`, `networkReceiveLimit`, plus the
 * placeholder fields `containerConfigId`/`ports`/`permissions`/`plugins` — all
 * logged, none reach the daemon.
 *
 * Errors from the daemon carry `.code = "runnerError"` so wave 3 maps them onto
 * `cancelled` + `runnerError` + `statusMessage`; payload-shape violations use
 * `.code = "invalidPayload"`.
 */

import { mkdirSync, statSync, createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { Duplex, PassThrough } from "node:stream";
import type Docker from "dockerode";
import { loadConfig } from "../config.ts";
import { log } from "../log.ts";
import { getDocker } from "./docker.ts";

const config = loadConfig();

/** Lifecycle handle handed to bringup/ACP (plan §4/§6 contract). */
export interface ContainerHandle {
    containerId: string;
    worktreePath: string;
    gitDir: string;
    branch: string;
    agentDir: string;
    socketPath: string;
    /** Bidirectional exec stream — the only ACP transport (plan §0, verified). */
    exec(cmd: string[]): Promise<Duplex>;
}

/**
 * Everything a payload carries into container creation. Fields marked "accepted
 * placeholder" are validated into place and deliberately dropped.
 */
export interface AgentContainerSpec {
    agentTaskId: number | string;
    instanceId?: string;
    issueId?: number | string;
    worktreePath: string;
    gitDir: string;
    branch: string;
    /** Host dir bind-mounted at `/home/agent/.pi/agent` (session logs + mcp.json). */
    agentDir: string;
    /** Host SOCKET FILE (never the dir) bind-mounted at `/sockets/mcp.sock`. */
    socketPath: string;
    /** Default `config.agentImage:config.agentImageTag`. */
    image?: string;
    /** Millicores; `NanoCpus = cpuLimit * 1e6`. Throttles, never kills. */
    cpuLimit: number;
    /** Bytes; `Memory = MemorySwap = ramLimit`. Throttles, never kills. */
    ramLimit: number;
    // Accepted + logged, NEVER applied (doc-mandated deferral).
    diskLimit?: number;
    networkSpeedLimit?: number;
    networkSendLimit?: number;
    networkReceiveLimit?: number;
    // The ONLY payload values that become env beyond the fixed keys.
    modelToken?: string;
    runtimeConfig?: string;
    startupScript?: string;
    // Accepted placeholders, IGNORED — never merged into the container.
    containerConfigId?: string;
    ports?: unknown;
    permissions?: unknown;
    plugins?: unknown;
    env?: unknown;
}

export interface ContainerStateInfo {
    Status: string;
    Running: boolean;
    Paused: boolean;
    OOMKilled: boolean;
    ExitCode: number;
    Error: string;
}

/** Pinned `stats({stream:false})` projection (verified keys, plan §4). */
export interface ContainerStatsSnapshot {
    cpuTotalUsage: number;
    cpuSystemUsage: number;
    memUsage: number;
    memLimit: number;
    onlineCpus: number;
}

/** Milliseconds `startContainer` waits for the container to leave `created`. */
const START_TIMEOUT_MS = 30_000;

function runnerError(message: string): Error {
    const err = new Error(message) as Error & { code: string };
    err.code = "runnerError";
    return err;
}

function invalidPayload(message: string): Error {
    const err = new Error(message) as Error & { code: string };
    err.code = "invalidPayload";
    return err;
}

function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Deterministic name so a restart re-finds its containers (recover.ts labels). */
export function containerName(agentTaskId: number | string): string {
    return `peter-agent-${String(agentTaskId).replace(/[^A-Za-z0-9_.-]/g, "-")}`;
}

/** True when a docker API error is a plain "not found" (404). */
function isNotFound(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const anyErr = err as { statusCode?: unknown; message?: unknown };
    return anyErr.statusCode === 404 || /not found|no such container/i.test(String(anyErr.message ?? ""));
}

/** True when the daemon refused an operation as already-done (HTTP 304). */
function isAlreadyDone(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as { statusCode?: unknown }).statusCode === 304;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Env handed to the container: fixed keys only, in a stable order. Payload
 * `runtimeConfig`/`startupScript`/`issueId` are the sanctioned values; `spec.env`
 * never appears here.
 */
function buildEnv(spec: AgentContainerSpec): string[] {
    const env: string[] = ["PI_CODING_AGENT_DIR=/home/agent/.pi/agent"];
    if (spec.modelToken) env.push(`PETER_MODEL_TOKEN=${spec.modelToken}`);
    if (spec.runtimeConfig) env.push(`agent.runtimeConfig=${spec.runtimeConfig}`);
    if (spec.startupScript) env.push(`startupScript=${spec.startupScript}`);
    if (spec.issueId !== undefined && spec.issueId !== null) env.push(`task.issueId=${String(spec.issueId)}`);
    return env;
}

/**
 * Create the agent container. Docker daemon failures throw with
 * `.code = "runnerError"`; a payload that names a missing mount source throws
 * `invalidPayload` before any daemon call (a bind source that does not exist is
 * created by dockerd as an empty *directory*, which would silently mount a dir
 * where the socket file must be).
 *
 * Name collision policy: the name is deterministic (`peter-agent-<agentTaskId>`),
 * so a leftover from a crash hits "name already in use". That leftover is always
 * garbage — either from a previous attempt at this same task or an orphan with the
 * same id — so this function inspects it, logs, REMOVES it and recreates, rather
 * than adopting: adopting could hand back a container created from a stale spec
 * (different worktree/branch/env) and hide the mismatch. Ids are unique anyway.
 */
export async function createAgentContainer(spec: AgentContainerSpec): Promise<ContainerHandle> {
    for (const [field, value] of [
        ["worktreePath", spec.worktreePath],
        ["agentDir", spec.agentDir],
        ["socketPath", spec.socketPath],
    ] as const) {
        // Checked on the host by the caller's own fs: docker would mkdir a missing
        // bind source instead of failing, silently mounting the wrong thing.
        try {
            statSync(value);
        } catch {
            throw invalidPayload(`${field} mount source does not exist: ${String(value)}`);
        }
    }

    // Doc-mandated deferrals + placeholders: log, never apply, never merge.
    log.debug("container limits accepted, not enforced", {
        task: spec.agentTaskId,
        diskLimit: spec.diskLimit ?? null,
        networkSpeedLimit: spec.networkSpeedLimit ?? null,
        networkSendLimit: spec.networkSendLimit ?? null,
        networkReceiveLimit: spec.networkReceiveLimit ?? null,
    });
    log.debug("container placeholders ignored", {
        task: spec.agentTaskId,
        containerConfigId: spec.containerConfigId ?? null,
        ports: spec.ports ?? null,
        permissions: spec.permissions ?? null,
        plugins: spec.plugins ?? null,
        env: spec.env ?? null,
    });

    const image = spec.image?.trim() || `${config.agentImage}:${config.agentImageTag}`;
    const name = containerName(spec.agentTaskId);

    // Name-collision policy above: remove leftovers before create.
    try {
        const existing = await getDocker().getContainer(name).inspect();
        log.warn("container name already exists, removing stale container", { task: spec.agentTaskId, name, containerId: existing.Id });
        await getDocker().getContainer(existing.Id).remove({ force: true });
    } catch (err) {
        if (!isNotFound(err)) throw runnerError(`inspect/remove of existing container ${name} failed: ${errText(err)}`);
    }

    const options: Docker.ContainerCreateOptions = {
        name,
        Image: image,
        // No Cmd: the image's own entrypoint is the runtime contract (§"Container");
        // ACP reaches the process through `execStream`, not this PID 1.
        Env: buildEnv(spec),
        Labels: {
            "peter.agentTaskId": String(spec.agentTaskId),
            "peter.instanceId": spec.instanceId?.trim() || config.instanceId,
        },
        HostConfig: {
            NanoCpus: Math.round(spec.cpuLimit * 1e6),
            Memory: spec.ramLimit,
            MemorySwap: spec.ramLimit,
            PidsLimit: 128,
            NetworkMode: "bridge",
            LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
            Mounts: [
                { Type: "bind", Source: spec.worktreePath, Target: "/workspace" },
                { Type: "bind", Source: spec.agentDir, Target: "/home/agent/.pi/agent" },
                { Type: "bind", Source: spec.socketPath, Target: "/sockets/mcp.sock" },
            ],
        },
    };

    let container: Docker.Container;
    try {
        container = await getDocker().createContainer(options);
    } catch (err) {
        throw runnerError(`createContainer(${name}, ${image}) failed: ${errText(err)}`);
    }
    log.info("container created", { task: spec.agentTaskId, containerId: container.id, image, name });

    return {
        containerId: container.id,
        worktreePath: spec.worktreePath,
        gitDir: spec.gitDir,
        branch: spec.branch,
        agentDir: spec.agentDir,
        socketPath: spec.socketPath,
        exec: (cmd: string[]) => execStream(container.id, cmd),
    };
}

/**
 * Start and wait until the container leaves `created`. When `logMirrorPath` is
 * given, follow the daemon's json-file log and tee it there (docker's stdout/
 * stderr framing stripped); the file's parent is created. Mirror breakage only
 * warns — the bounded json-file log on the daemon side is the source of truth.
 */
export async function startContainer(containerId: string, logMirrorPath?: string): Promise<void> {
    try {
        await getDocker().getContainer(containerId).start();
    } catch (err) {
        if (!isAlreadyDone(err)) throw runnerError(`start(${containerId}) failed: ${errText(err)}`);
    }

    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
        const state = await inspectState(containerId);
        if (state.Running || state.Status !== "created") {
            if (!state.Running) log.warn("container exited immediately after start", { containerId, status: state.Status, exitCode: state.ExitCode });
            break;
        }
        if (Date.now() > deadline) throw runnerError(`container ${containerId} did not start within ${START_TIMEOUT_MS}ms (status=${state.Status})`);
        await sleep(200);
    }

    if (logMirrorPath) {
        try {
            mkdirSync(dirname(logMirrorPath), { recursive: true });
            const sink: WriteStream = createWriteStream(logMirrorPath, { flags: "a" });
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            stdout.pipe(sink, { end: false });
            stderr.pipe(sink, { end: false });
            // `follow: true` keeps this open for the container's life; the stream
            // ends with the container, closing the mirror (flags "a" keeps appends safe).
            const stream = await getDocker().getContainer(containerId).logs({ follow: true, stdout: true, stderr: true });
            getDocker().modem.demuxStream(stream, stdout, stderr);
            log.debug("log mirror attached", { containerId, logMirrorPath });
        } catch (err) {
            log.warn("log mirror failed to attach", { containerId, error: errText(err) });
        }
    }
}

/** SIGSTOP the container (plan §3: `paused` command → pauseContainer). */
export async function pauseContainer(containerId: string): Promise<void> {
    try {
        await getDocker().getContainer(containerId).pause();
    } catch (err) {
        if (!isAlreadyDone(err)) throw runnerError(`pause(${containerId}) failed: ${errText(err)}`);
    }
}

/** SIGCONT a paused container. */
export async function unpauseContainer(containerId: string): Promise<void> {
    try {
        await getDocker().getContainer(containerId).unpause();
    } catch (err) {
        if (!isAlreadyDone(err)) throw runnerError(`unpause(${containerId}) failed: ${errText(err)}`);
    }
}

/** Stop the container (already-stopped and missing are both fine). */
export async function stopContainer(containerId: string): Promise<void> {
    try {
        await getDocker().getContainer(containerId).stop();
    } catch (err) {
        if (!isNotFound(err) && !isAlreadyDone(err)) throw runnerError(`stop(${containerId}) failed: ${errText(err)}`);
    }
}

/** Remove the container; idempotent — a missing container is not an error. */
export async function removeContainer(containerId: string): Promise<void> {
    try {
        await getDocker().getContainer(containerId).remove({ force: true });
    } catch (err) {
        if (!isNotFound(err)) throw runnerError(`remove(${containerId}) failed: ${errText(err)}`);
    }
}

/**
 * Open a hijacked, multiplexed exec: `exec({AttachStdin,AttachStdout,AttachStderr})`
 * + `start({hijack:true, stdin:true})` + `modem.demuxStream`. Verified
 * bidirectional (`got:one` round-trip, plan §0) — this is the ONLY ACP transport,
 * so stdout and stderr are merged into the single Duplex the ACP layer reads and
 * writes (docker frames them with its 8-byte header; demuxStream unwraps).
 */
export async function execStream(containerId: string, cmd: string[]): Promise<Duplex> {
    if (!Array.isArray(cmd) || cmd.length === 0) throw invalidPayload("execStream requires a non-empty cmd array");
    let socket: Duplex;
    try {
        const exec = await getDocker().getContainer(containerId).exec({
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Cmd: cmd,
        });
        socket = await exec.start({ hijack: true, stdin: true });
    } catch (err) {
        throw runnerError(`exec ${cmd.join(" ")} on ${containerId} failed: ${errText(err)}`);
    }

    // docker's multiplex framing: 8-byte header + payload per stdout/stderr chunk,
    // stdin raw. demuxStream unwraps stdout+stderr; the Duplex below merges them
    // into the single stream the ACP layer reads, and writes go to stdin.
    const output = new PassThrough();
    const input = new PassThrough();
    getDocker().modem.demuxStream(socket, output, output);
    input.pipe(socket);

    const duplex = new Duplex({
        read() {
            output.resume();
        },
        write(chunk, encoding, callback) {
            input.write(chunk, encoding, callback);
        },
        final(callback) {
            input.end(callback);
        },
        destroy(err, callback) {
            input.destroy();
            socket.destroy();
            callback(err);
        },
    });
    output.on("data", (chunk) => {
        if (!duplex.push(chunk)) output.pause(); // honour downstream backpressure
    });
    output.on("end", () => duplex.push(null));
    socket.on("close", () => {
        if (!output.writableEnded) output.end();
    });
    socket.on("error", (err) => duplex.destroy(err));
    return duplex;
}

/**
 * Sole source of OOM/exit truth (plan §4): `State` from `docker inspect`, never
 * log parsing. Throws `runnerError` when the daemon cannot answer (e.g. daemon
 * down); a missing container surfaces as `runnerError` from docker's 404.
 */
export async function inspectState(containerId: string): Promise<ContainerStateInfo> {
    try {
        const info = await getDocker().getContainer(containerId).inspect();
        const state = info.State;
        return {
            Status: state.Status,
            Running: state.Running,
            Paused: state.Paused,
            OOMKilled: state.OOMKilled,
            ExitCode: state.ExitCode,
            Error: state.Error,
        };
    } catch (err) {
        throw runnerError(`inspect(${containerId}) failed: ${errText(err)}`);
    }
}

/**
 * One `stats({stream:false})` sample for metrics (plan `[W2/F]`): CPU throttle
 * math needs `cpu_stats`/`precpu_stats`, RAM needs `memory_stats.usage/limit`.
 * Returns `null` when the daemon cannot sample (container not running / going
 * away) — a normal race for a poller, not an error.
 */
export async function statsOnce(containerId: string): Promise<ContainerStatsSnapshot | null> {
    try {
        const stats = await getDocker().getContainer(containerId).stats({ stream: false });
        if (!stats?.cpu_stats || !stats.memory_stats) return null;
        return {
            cpuTotalUsage: stats.cpu_stats.cpu_usage.total_usage,
            cpuSystemUsage: stats.cpu_stats.system_cpu_usage,
            memUsage: stats.memory_stats.usage,
            memLimit: stats.memory_stats.limit,
            onlineCpus: stats.cpu_stats.online_cpus,
        };
    } catch (err) {
        log.debug("stats unavailable", { containerId, error: errText(err) });
        return null;
    }
}
