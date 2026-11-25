/**
 * Boot-time container re-adoption (plan §4 `[W1/A]` `runtime/recover.ts`).
 *
 * Lists every container labelled `peter.agentTaskId` and reports what is there
 * after a restart. POC policy (plan §4): re-adopt and report — this module is
 * READ-ONLY, it never kills, stops or removes anything, not even clear orphans;
 * a stale container costs a label-filtered list, while killing a live one could
 * destroy work the in-memory task state simply lost track of. Cleanup is an
 * explicit caller decision (wave 3's bringup), not a boot side effect.
 *
 * Classification per container:
 *  - running and carrying THIS instance's `peter.instanceId` label → `adopted`
 *    (orphan from our own previous run — bringup re-associates it with a task);
 *  - anything else → `stale`: non-running, or owned by another instance; logged,
 *    never auto-killed. `config.keepContainersOnComplete` (test mode) explains
 *    intentionally-kept completed containers, so those are logged at debug.
 */

import { loadConfig } from "../config.ts";
import { log } from "../log.ts";
import { getDocker } from "./docker.ts";

const config = loadConfig();

export interface RecoveryResult {
    /** Running containers from this instance, safe to re-adopt. */
    adopted: string[];
    /** Non-running / foreign-instance containers — reported, never auto-killed. */
    stale: string[];
}

/**
 * Scan for labelled agent containers. Throws only when the daemon itself cannot
 * answer (caller decides whether boot continues — `ensureDockerReady` gates that).
 */
export async function recoverContainers(): Promise<RecoveryResult> {
    const result: RecoveryResult = { adopted: [], stale: [] };
    const containers = await getDocker().listContainers({
        all: true,
        filters: { label: ["peter.agentTaskId"] },
    });

    for (const info of containers) {
        const taskLabel = info.Labels["peter.agentTaskId"] ?? "?";
        const instanceLabel = info.Labels["peter.instanceId"] ?? "";
        const id = info.Id;
        const name = info.Names[0]?.replace(/^\//, "") ?? id.slice(0, 12);

        if (info.State === "running" && instanceLabel === config.instanceId) {
            result.adopted.push(id);
            log.info("recover: re-adopting running container", { task: taskLabel, containerId: id, name });
            continue;
        }

        result.stale.push(id);
        const reason = info.State === "running" ? `foreign instance=${instanceLabel || "<none>"}` : `state=${info.State}`;
        const kept = config.keepContainersOnComplete && info.State !== "running";
        const fields = { task: taskLabel, containerId: id, name, reason };
        // keepContainersOnComplete: completed containers are kept on purpose (test mode).
        if (kept) log.debug("recover: keeping completed container (keepContainersOnComplete)", fields);
        else log.warn("recover: stale container found — reported, not killed", fields);
    }

    log.info("recover: scan complete", {
        adopted: result.adopted.length,
        stale: result.stale.length,
        keepContainersOnComplete: config.keepContainersOnComplete,
    });
    return result;
}
