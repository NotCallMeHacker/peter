/**
 * `supervisor.status` payload builder — the single source of truth.
 *
 * Both the `supervisor.status` request handler and the heartbeat MUST call
 * `buildSupervisorStatus()`; the payload is never built inline anywhere else.
 *
 * Docker facts arrive through the injectable `CapacitySource` instead of an
 * import: this module must NOT import `runtime/docker.ts` (track A owns it),
 * so track A/F inject real probes via `setCapacitySource(...)` later.
 */

import { loadConfig, type Config } from "../config.ts";
import { log } from "../log.ts";
import { listTasks } from "../tasks/store.ts";

/**
 * `supervisor.status` payload (webCommunicationSchemas.md → S->W | Supervisor Status).
 * `data` is null only if a future path cannot compute it; wave 1 always fills it.
 */
export interface SupervisorStatusPayload {
    status: "available" | "full" | "error" | "unavailable";
    statusMessage: string; // ≤ 1000 chars, human-readable
    data: {
        instanceId: string;
        activeTasks: number;
        containerCount: number;
        dockerOk: boolean;
        uptimeSeconds: number;
    } | null;
}

/**
 * Injectable capacity facts. Defaults below are the wave-1 placeholders;
 * track A/F replace them with real probes.
 */
export interface CapacitySource {
    /** Docker daemon reachable. Default: `() => true`. */
    dockerOk(): boolean;
    /** Running containers this supervisor owns. Default: `() => 0`. */
    containerCount(): number;
    /**
     * Concurrency limit used for the "full" state. Default reads
     * `config.maxConcurrentTasks` (declared by wave 0); injectable so tests
     * and later tracks can override via `setCapacitySource`.
     */
    maxConcurrentTasks(): number;
}

/** Wave-1 defaults: docker assumed up, no containers, limit from config. */
const DEFAULT_CAPACITY: CapacitySource = {
    dockerOk: () => true,
    containerCount: () => 0,
    maxConcurrentTasks: () => config.maxConcurrentTasks,
};

let capacity: CapacitySource = { ...DEFAULT_CAPACITY };

/** Merge `source` over the current capacity source (defaults are the baseline). */
export function setCapacitySource(source: Partial<CapacitySource>): void {
    capacity = { ...capacity, ...source };
}

/** Graceful-shutdown flag; set by wave 2, read by buildSupervisorStatus. */
let shuttingDown = false;

/** Wave 2 flips this during graceful shutdown → status becomes "unavailable". */
export function setShuttingDown(value: boolean): void {
    shuttingDown = value;
}

/** Read-only config loaded once at module scope (instanceId never changes). */
const config: Config = loadConfig();

/**
 * Build the current `supervisor.status` payload.
 *
 * Derivation: shutting down → "unavailable"; !dockerOk → "error";
 * activeTasks >= maxConcurrentTasks → "full"; else "available".
 */
export function buildSupervisorStatus(): SupervisorStatusPayload {
    const dockerOk = capacity.dockerOk();
    const containerCount = capacity.containerCount();
    const maxConcurrentTasks = capacity.maxConcurrentTasks();
    const activeTasks = listTasks().filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
    const uptimeSeconds = Math.round(process.uptime());

    let status: SupervisorStatusPayload["status"];
    if (shuttingDown) {
        status = "unavailable";
    } else if (!dockerOk) {
        status = "error";
    } else if (activeTasks >= maxConcurrentTasks) {
        status = "full";
    } else {
        status = "available";
    }

    const data: NonNullable<SupervisorStatusPayload["data"]> = {
        instanceId: config.instanceId,
        activeTasks,
        containerCount,
        dockerOk,
        uptimeSeconds,
    };

    const statusMessage = describe(status, activeTasks, maxConcurrentTasks, containerCount);
    if (statusMessage.length > 1000) {
        // Defensive: our own messages are short, but the wire limit is hard.
        log.warn("buildSupervisorStatus: statusMessage exceeded 1000 chars, truncated", {
            length: statusMessage.length,
        });
    }

    return { status, statusMessage: statusMessage.slice(0, 1000), data };
}

/** Human-readable, ≤ 1000 chars, per status. */
function describe(
    status: SupervisorStatusPayload["status"],
    activeTasks: number,
    maxConcurrentTasks: number,
    containerCount: number,
): string {
    switch (status) {
        case "available":
            return `ready, ${activeTasks} of ${maxConcurrentTasks} tasks active`;
        case "full":
            return `at capacity, ${activeTasks} of ${maxConcurrentTasks} tasks active (${containerCount} containers)`;
        case "error":
            return `docker unavailable (containers: ${containerCount}), supervisor degraded`;
        case "unavailable":
            return "supervisor is shutting down and not accepting new work";
    }
}
