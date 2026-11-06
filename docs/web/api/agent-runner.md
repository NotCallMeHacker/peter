# General
We will have a few different types of messages SocketIO messages:

## Message
One way message, no response expected
```json
{
  "type": "message",
  "path": "path.to.method",
  "data": {
    ... // everything else
  }
}
```

## Request
every request expects a response or an error/timeout
will use the following body:
```json
{
  "type": "request",
  "id": 32Bit request ID, // may be sequential or random
  "path": "path.to.method",
  "data": {
    ... // everything else
  }
}
```

## Response
response to a Request message, default timeout: 3s
```json
{
  "type": "response",
  "id": 32Bit request ID, // has to be the same as the request
  "data": {
    ... // response data
  }
}
```

## Sub
Subscribes to a specific event
```json
{
  "type": "sub",
  "path": "eventPath"
}
```

## Unsub
Unsubscribes from a specific event
```json
{
  "type": "unsub",
  "path": "eventPath"
}
```

## Pub
Publishes a specific event
```json
{
  "type": "pub",
  "path": "eventPath",
  ...
}
```

# API Endpoints

## WS /api/agent-runner/socket
This endpoint is used for real-time communication between the agent runner and the web application using Socket.IO. It allows the agent runner to send and receive messages, subscribe to events, and publish events.

# Methods
r - short for agent runner
w - short for web
Format: "METHOD w/r -> w/r path.to.event"

## REQUEST r->w general.supported-versions
Request:
Requests the list of supported versions for the agent runner.
```json
data: {}
```

Response:
Returns a list of supported versions for the agent runner.
```json
data: {
  "supportedVersions": ["1.0", "1.1", "2.0"]
}
```

## REQUEST r->w general.config
Request:
Requests the current configuration of the agent runner.
```json
data: {}
```

Response:
Returns the current configuration of the agent runner.
```json
data: {
  "config": {
    "setting1": "value1",
    "setting2": "value2"
  }
}
```

## MESSAGE w->r task.start
Request:
Sends a message to the agent runner to start a new task.
```json
data: {
  "taskId": "string",
  "isRepo": boolean,
  "repoUrl": "string", // default: /api/agent-runner/repo/${repoId} or github link
  "branch": "string", // default: ${taskName}
  "commit": "string", // optional, default: latest commit on branch
  "issueId": "string", // optional, default: null
}
```






# POST /api/agent-runner/run-logs
Sends the logs of a specific agent run to the server.

Request Body:
```json
{
  "runId": "string",
  "logs": "JSON"
}
```

# /api/agent-runner/socket
## SocketIO Runner -> Web
### Event: `runner:ready`
Indicates that the runner is ready to receive commands.

### Event: `server:`