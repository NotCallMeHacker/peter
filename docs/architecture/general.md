# General Architecture

The architecture of this project is designed to be somewhat modular, with the agent runner and the showcase being separate components that communicate with the central web application. The web application serves as the main interface for users, while the agent runner handles the actual execution.

## Main Machine
### Web Application
- Central hub
- communicates to all other services
- may be bottleneck later
### Supertokens
- provides authentication and authorization for Web
### Supabase
- provides database for Web
- provides database for Supertokens
- provides storage for Web
- provides storage for Agent Runner

## Agent Runner
- can run on a separate machine and scale independently
- communicates with Web via API and SocketIO
- authenticates with Web via Supertokens
- can be configured via Web
- gives the agents an environment to run in
- each agent run should be isolated from other runs
- each agent run should have access to:
    - Read-only to the git tree
    - Write access for the branch that the agent is working on
    - 

## Showcase
- can start and show each PR/Commit in a test environment
- can run on a separate machine and scale independently
- communicates with Web via API and SocketIO
- authenticates with Web via Supertokens
- can be configured via Web