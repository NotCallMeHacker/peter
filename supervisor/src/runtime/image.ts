/**
 * Agent image resolution (plan §4 `[W1/A]` `runtime/image.ts`).
 *
 * `ensureImage()` guarantees `image:tag` exists on the daemon before a container
 * is created: allowlist check → inspect → pull when missing. Every failure
 * throws so wave 3's bringup maps it to `cancelled` + `runnerError` +
 * `statusMessage` in exactly one place.
 *
 * Allowlist (config `agentImageAllowlist`, comma-separated): a payload may only
 * name images on it, plus the default `config.agentImage`. The check happens
 * before any daemon I/O so a bad payload fails with a payload-shaped error
 * (`code: "invalidPayload"`), not a docker one.
 */

import { loadConfig } from "../config.ts";
import { log } from "../log.ts";
import { getDocker } from "./docker.ts";

const config = loadConfig();

/** Error codes wave 3 maps onto wire errors (client.ts maps `.code` onto the frame). */
type RunnerErrorCode = "runnerError" | "invalidPayload";

function taggedError(code: RunnerErrorCode, message: string): Error {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
}

/** True when a docker API error is a plain "not found" (image or container). */
function isNotFound(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const anyErr = err as { statusCode?: unknown; message?: unknown };
    return anyErr.statusCode === 404 || /not found|no such image/i.test(String(anyErr.message ?? ""));
}

/**
 * Ensure `image:tag` exists locally, pulling from the registry when missing.
 *
 * Defaults to `config.agentImage` / `config.agentImageTag`. Order:
 *  1. allowlist check — `agentImage` + `agentImageAllowlist`, mismatch throws
 *     `invalidPayload` naming the allowlist (never a docker error, never a pull);
 *  2. `getImage().inspect()` — already present → done;
 *  3. `docker.pull(image:tag)` (docker-modem `followProgress`, resolves only on
 *     a clean stream end) — covers registry images and images the inner daemon
 *     still has to fetch;
 *  4. pull failed AND the image is the default local agent image → the tar was
 *     not loaded at boot, so throw the actionable `build-agent-image.sh` message;
 *     otherwise rethrow the pull error (`runnerError`).
 */
/**
 * Split an image argument into the bare repo (allowlist key) and the full
 * `repo:tag` reference. A `:` only starts a tag when it follows the last `/`
 * (`localhost:5000/img` has a colon in the registry, no tag).
 */
function splitRef(image?: string, tag?: string): { repo: string; reference: string } {
    const raw = image?.trim() || config.agentImage;
    const colon = raw.lastIndexOf(":");
    const slash = raw.lastIndexOf("/");
    if (colon > slash) return { repo: raw.slice(0, colon), reference: raw };
    return { repo: raw, reference: `${raw}:${tag?.trim() || config.agentImageTag}` };
}

export async function ensureImage(image?: string, tag?: string): Promise<void> {
    const { repo: name, reference } = splitRef(image, tag);

    const allowlist = new Set([config.agentImage, ...config.agentImageAllowlist]);
    if (!allowlist.has(name)) {
        throw taggedError(
            "invalidPayload",
            `image "${name}" is not allowed: config agentImageAllowlist = ` +
                `[${[...allowlist].join(", ")}] (set AGENT_IMAGE_ALLOWLIST to permit it)`,
        );
    }

    try {
        await getDocker().getImage(reference).inspect();
        log.debug("image present", { image: reference });
        return;
    } catch (err) {
        if (!isNotFound(err)) {
            throw taggedError("runnerError", `docker image inspect failed for ${reference}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    log.info("pulling image", { image: reference });
    try {
        const stream = await getDocker().pull(reference);
        await new Promise<void>((resolve, reject) => {
            getDocker().modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
        });
        log.info("image pulled", { image: reference });
        return;
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (name === config.agentImage) {
            // The supervisor image ships agent-image.tar and start.sh loads it; a
            // failed local load is the only way the default image goes missing.
            throw taggedError(
                "runnerError",
                `agent image not loaded — run supervisor/scripts/build-agent-image.sh ` +
                    `(docker load of agent-image.tar failed for ${reference}: ${detail})`,
            );
        }
        throw taggedError("runnerError", `docker pull failed for ${reference}: ${detail}`);
    }
}
