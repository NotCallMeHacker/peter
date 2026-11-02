/** @type {import('next').NextConfig} */
const nextConfig = {
    // Emit a self-contained server (see Dockerfile) instead of relying on
    // the full node_modules at runtime.
    output: "standalone",
    // FIXME: This is a workaround, remove for other dev environments
    watchOptions: {
        pollIntervalMs: 1000,
    },
};

module.exports = nextConfig;
