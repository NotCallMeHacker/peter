/**
 * Installs the agent-runner bridge's WebSocket hook (node-only).
 *
 * Next.js (v16) has no WebSocket route handlers: its own upgrade handler ends
 * the socket for anything that matches a route, and explicitly leaves unmatched
 * upgrade paths to "user's custom WS server" (see next/dist/server/lib/
 * router-server.js). There is no public hook to install such a server, and
 * standalone output (the Dockerfile runs `node server.js`) is generated and
 * cannot be wrapped in a custom server. So this installs one narrow hook: the
 * `upgrade` event of `http.Server.prototype` is intercepted before any
 * per-server listener runs (listeners are only invoked through `emit`), and
 * exactly one path — /api/agent-runner — is handed to the bridge hub. Every
 * other upgrade (Next HMR in dev, anything else) falls through to Next
 * untouched.
 *
 * Called from `instrumentation.ts` `register()`, which runs once per server
 * boot in the same process that owns the socket (verified in dev and in
 * standalone `node server.js`), so the hub's in-process session map is the
 * live view; other processes fall back to the hub's status snapshot.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import http from "node:http";
import { attachUpgrade, BRIDGE_PATH } from "./hub";

export function installBridgeUpgradeHook(): void {
    try {
        // Survive dev HMR re-evaluation: patch exactly once per process.
        const marker = Symbol.for("peter.agentRunner.upgradeHook");
        const state = globalThis as Record<symbol, unknown>;
        if (state[marker]) return;
        state[marker] = true;

        // Imported statically at the top of this node-only module: the edge
        // compile of instrumentation.ts never reaches it (it is only imported
        // from the nodejs branch of register()), so node:http stays out of the
        // edge graph entirely.
        const original = http.Server.prototype.emit as (this: unknown, event: string, ...args: unknown[]) => boolean;
        http.Server.prototype.emit = function (this: unknown, event: string, ...args: unknown[]): boolean {
            if (event === "upgrade") {
                const req = args[0] as { url?: string } | undefined;
                const path = (req?.url ?? "").split("?")[0];
                if (path === BRIDGE_PATH) {
                    attachUpgrade(
                        args[0] as IncomingMessage,
                        args[1] as Duplex,
                        (args[2] as Buffer | undefined) ?? Buffer.alloc(0),
                    );
                    return true;
                }
            }
            return original.call(this, event, ...args);
        };
        console.log(`[agent-runner] bridge attached to ${BRIDGE_PATH}`);
    } catch (error) {
        // Degrade, don't die: the web UI must stay up even if the bridge can't.
        console.error("[agent-runner] bridge failed to attach", error);
    }
}