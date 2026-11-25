#!/bin/sh
# Build the agent runtime image and save it into the ./supervisor build context as
# agent-image.tar, which supervisor/Dockerfile COPYs to /opt/agent-image.tar for
# start.sh to `docker load` into the inner daemon (plan.md §0 DECIDED: save/load path).
#
# Run before `docker compose -f docker-compose.supervisor.yml build supervisor`
# (the compose build fails on COPY agent-image.tar if this was never run).
# Works from supervisor/ (its documented home); resolves its own directory either way.
set -eu
cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { echo "FATAL: docker not found on PATH" >&2; exit 1; }

docker build -f Dockerfile.agent -t peter-agent:dev .
docker save peter-agent:dev -o agent-image.tar
echo "wrote $(pwd)/agent-image.tar (git-ignored, kept in the docker build context)"
