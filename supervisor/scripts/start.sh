#!/bin/sh
# Supervisor container entrypoint (plan.md §1 [W1/A], mechanism (a) for env plumbing).
#
# Runs as root under dumb-init, in WORKDIR /app:
#   1. start the inner dockerd (DinD) and wait for /var/run/docker.sock (~60s budget);
#   2. mkdir -p + chown the bind-mounted dirs to the app uid (binds arrive owned by
#      the host uid — a non-root app that cannot write them fails on the first agent.new);
#   3. load the agent image into the inner daemon, failing fast if it is missing/broken
#      (an empty daemon would turn every agent.new into a confusing "image not found");
#   4. exec the app as node --env-file-if-exists=/run/config/.env (the file only exists
#      when compose bind-mounts ./.env read-only; the flag keeps host runs working too).
set -eu

SOCK=/var/run/docker.sock
# App uid/user: the base image's `node` user — uid 1000 ALREADY exists in node:26-alpine,
# so `adduser -u 1000` fails; we reuse `node` and never rename it.
APP_USER=node
DOCKER_READY_TIMEOUT_S=60

log() { printf '[start.sh] %s\n' "$*" >&2; }

# --- 1. inner dockerd ---------------------------------------------------------
log "starting dockerd..."
dockerd >/var/log/dockerd.log 2>&1 &
i=0
while [ "$i" -lt "$DOCKER_READY_TIMEOUT_S" ]; do
    if [ -S "$SOCK" ] && docker info >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 1
done
if ! docker info >/dev/null 2>&1; then
    log "FATAL: inner docker daemon not ready after ${DOCKER_READY_TIMEOUT_S}s (${SOCK} missing or not answering)."
    log "--- last dockerd log lines ---"
    tail -n 50 /var/log/dockerd.log >&2 || true
    exit 1
fi
log "inner docker daemon ready after ${i}s"

# The socket's group is created at boot by dockerd — put the app user in it so the
# non-root app can talk to the daemon (failures here are non-fatal: the app dials
# the socket and will report a clear EACCES itself).
addgroup "$APP_USER" docker 2>/dev/null || true

# --- 2. bind-mounted dirs -----------------------------------------------------
# Container paths must match config.ts defaults (GIT_CACHE_DIR / SOCKETS_DIR /
# WORKTREES_DIR / LOGS_DIR) unless those env vars are overridden.
for d in /var/lib/peter/git /var/lib/peter/worktrees /var/lib/peter/sockets /var/lib/peter/logs; do
    mkdir -p "$d"
    chown -R "$APP_USER":"$APP_USER" "$d"
done

# --- 3. agent image into the inner daemon ------------------------------------
TAR=/opt/agent-image.tar
if [ ! -f "$TAR" ]; then
    log "FATAL: ${TAR} is missing from the image. Rebuild it after running"
    log "       supervisor/scripts/build-agent-image.sh (the tar must exist in the"
    log "       ./supervisor build context before 'docker compose build supervisor')."
    exit 1
fi
if ! docker load -i "$TAR"; then
    log "FATAL: 'docker load -i ${TAR}' failed — the inner daemon has no agent image, so"
    log "       every agent.new would fail later with 'image not found'."
    exit 1
fi
log "agent image loaded from ${TAR}"

# --- 4. the app ---------------------------------------------------------------
# --env-file-if-exists: compose mechanism (a) bind-mounts ./.env here read-only, so one
# file is the source of truth; a host run without the mount still starts.
exec node --env-file-if-exists=/run/config/.env src/index.ts
