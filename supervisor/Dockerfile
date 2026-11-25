# syntax=docker/dockerfile:1
# Supervisor image — DinD (its own inner docker daemon) + node 26 (plan.md §1 [W1/A]).
# Build context is ./supervisor:
#   ./scripts/build-agent-image.sh && docker compose -f docker-compose.supervisor.yml build supervisor
FROM node:26-alpine

# docker/docker-cli = inner daemon + client (NOT docker:dind: sharing the node:26-alpine
# base with the agent image gives us layer sharing and one apk line for the toolchain);
# iptables = bridge networking for the nested containers; git = clone/worktree work
# (git lives ONLY in this image, never in the agent image); dumb-init = pid 1 reaping
# for the entrypoint script; ca-certificates = TLS to the web bridge.
RUN apk add --no-cache docker docker-cli iptables git dumb-init ca-certificates

WORKDIR /app

# node_modules needed at runtime (ws, dockerode, the ACP/MCP SDKs) — nothing else
# from the repo comes along, and devDependencies stay out (--omit=dev).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/

# Build artifact of supervisor/scripts/build-agent-image.sh: git-ignored on purpose,
# but it must NOT be docker-ignored (see .dockerignore `!agent-image.tar`) or this COPY fails.
COPY agent-image.tar /opt/agent-image.tar

COPY scripts/start.sh /usr/local/bin/start.sh
RUN chmod 0755 /usr/local/bin/start.sh

# No EXPOSE: the Supervisor opens no port (it dials the bridge as a WebSocket client).
ENTRYPOINT ["dumb-init", "/usr/local/bin/start.sh"]
