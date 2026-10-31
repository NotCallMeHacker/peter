/** @type {import('next').NextConfig} */
const nextConfig = {
    // Emit a self-contained server (see Dockerfile) instead of relying on
    // the full node_modules at runtime.
    output: "standalone",
};

module.exports = nextConfig;
