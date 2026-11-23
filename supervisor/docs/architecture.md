# Architecture

## Overview

This document outlines the architecture of the agent runner system.

## Components

### Supervisor
Starts/stops the agent runtimes and manages the communication with the containerized agents.

- Uses Docker to run runtimes in isolated containers
- Monitors network, CPU, RAM, tokens and disk usage for each runtime
- Publish metrics for logging, monitoring and alerts
- For later versions: 
    - ability to publish ports for human interaction with the agent
    - Proxy for the agent to access the internet (with restrictions)
- Supervisor <-> Web Interface communication is done via a WSS connection, using the schemas defined in [webCommunicationSchemas.md](webCommunicationSchemas.md)
- For later versions: Manage state backups and run logs to reconstruct containers after crashes or reboots
- sets up and mounts the /workspace, pi logs and general logs
- /workspace is a git workspace but the .git is excluded from the mount



### Runtime (in container)

#### Container
- Minimal Filesystem
- only /workspace, /tmp, log dirs and the pi code/agent runtime directories are writable
- no git access or repo, all managed by the Supervisor
- can't access the host filesystem or network
- can access the internet (host machine public range is blocked to prevent access to the host machine)
- has it's own loopback network interface
- RAM, CPU and disk usage is limited by the supervisor
- Connections to the supervisor:
    - interacting with the agent
    - Agent's Git MCP
    - Agent's log stream

#### Agent
- Runs Pi or OMP as the agent runtimes (to be extended)
- Can be configured with specific environment variables and startup parameters
- Plugins can be configured
- Models can be configured

#### Border
- The border is a component that runs in the container and acts as a bridge between the agent and the supervisor
- handles communication between the two, including the log stream, interactive sessions, and the agent's Git MCP
- sets up the agent's environment
- Uses [Agent Client Protocol](https://agentclientprotocol.com/protocol/v1/overview/) to manage and interact with all the agent runtimes like Pi and OMP using the [Typescript library](https://agentclientprotocol.github.io/typescript-sdk/)
- runs a "fake" git MCP so the agent's only options are read only or a commit in it's own branch