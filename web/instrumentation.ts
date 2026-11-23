/**
 * Server boot hooks.
 *
 * This file is compiled for BOTH runtimes (edge included — `proxy.ts` runs on
 * edge and `register()` is called in every environment), so it must not
 * reference any Node.js module: even an unreachable `import("node:http")`
 * makes the edge build fail with "A Node.js module is loaded ... not supported
 * in the Edge Runtime". The documented pattern is to gate the import behind
 * `NEXT_RUNTIME` and keep the node-only code in its own module, which the edge
 * build then never pulls into its graph.
 *
 * What the node-only side does (see server/bridge/install.ts): intercept the
 * `upgrade` event of the HTTP server and hand /api/agent-runner to the
 * agent-runner bridge before Next sees it — the only way to host a WebSocket
 * endpoint in Next 16 (no WS route handlers, no custom server with standalone).
 */

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { installBridgeUpgradeHook } = await import("./server/bridge/install");
        installBridgeUpgradeHook();
    }
}