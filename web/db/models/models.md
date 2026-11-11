# Models

## user
represents a user of the application
table: supertokens.all_auth_recipe_users  
Managed by SuperTokens; no local fields.
- id: `user_id` varchar(36) (uuid) — this is the value every local user reference stores (`group.ownerId`, `comment.userId`). It has no local table, so those references are logical: no physical FK can point at the SuperTokens primary key (app_id, tenant_id, user_id).

## group
represents a group of users (placeholder for future use; currently maps 1:1 to a user)
- id: PK, integer NOT NULL
- ownerId: varchar(36) NOT NULL // owner's user id (user.id above); Unique (1..1)
- name: varchar(255) NOT NULL
- deleted: boolean NOT NULL default false // if true the group is deleted and cannot be accessed
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - UNIQUE(ownerId, deleted) // prevents duplicate active groups per user; allows re-creation after soft-delete

## project
represents a project with a kanban board
- id: PK, integer NOT NULL
- groupId: FK → group.id, integer NOT NULL ON DELETE RESTRICT
- name: varchar(255) NOT NULL
- description: text, nullable // markdown-supported project description
- unicodeIcon: varchar(16), nullable // a single unicode character that represents an icon
- iconUrl: varchar(2048), nullable // url to an image icon; mutually exclusive with unicodeIcon
- gitUrl: varchar(2048), nullable // the url to the git repo
- isGitHubRepo: boolean NOT NULL default false // if true we will directly sync to the github repo and use the github api to get the kanban state (requires the bot to be added to the repo, will be checked on creation)
- gitHubProjectUrl: varchar(2048), nullable // the url to the github project page of the repo
- gitHubBoardId: varchar(255), nullable // the id of the github project board (e.g. "PR_kwDOA1r7sM4x0y3R")
- defaultBranch: varchar(255), nullable // the default branch of the git repo (e.g. "main" or "master")
- archived: boolean NOT NULL default false // if true the project is archived and cannot be edited or have new issues created
- deleted: boolean NOT NULL default false // if true the project is deleted and cannot be edited or viewed (will be permanently deleted after a certain period of time)
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - UNIQUE(groupId, name, deleted) // unique active project names per group
    - CHECK (iconUrl IS NULL OR unicodeIcon IS NULL) // mutually exclusive icons
    - CHECK (archived IS false OR deleted IS false) // archived projects cannot be deleted until unarchived
    - CHECK (isGitHubRepo IS false OR gitHubProjectUrl IS NOT NULL) // GitHub projects must have a project URL
    - CHECK (gitUrl IS NOT NULL OR isGitHubRepo IS false) // GitHub projects must have a git URL
    - CHECK (description IS NULL OR LENGTH(description) <= 10000) // sensible max length for project descriptions

## label
represents a label that can be applied to an issue
- id: PK, integer NOT NULL
- projectId: FK → project.id, integer NOT NULL ON DELETE CASCADE
- name: varchar(255) NOT NULL
- unicodeIcon: varchar(16), nullable // a single unicode character that represents an icon
- iconUrl: varchar(2048), nullable // a url to an image that represents an icon (cant be used if unicodeIcon is set)
- color: varchar(9) NOT NULL // hex color (e.g. #RRGGBB or #AARRGGBB)
- position: integer NOT NULL // the position of the label in the list of labels (0 is the first label), Unique per project
- deleted: boolean NOT NULL default false // if true the label is deleted and cannot be applied to issues
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - UNIQUE(projectId, name, deleted) // unique active label names per project
    - UNIQUE(projectId, position, deleted) // unique active positions per project
    - CHECK (iconUrl IS NULL OR unicodeIcon IS NULL) // mutually exclusive icons
    - CHECK (color ~ '^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$') // valid hex color
    - CHECK (position >= 0 AND position < 10000) // position must be non-negative and within sensible bounds

## column
represents a column in a project's kanban board
- id: PK, integer NOT NULL
- projectId: FK → project.id, integer NOT NULL ON DELETE CASCADE
- name: varchar(255) NOT NULL
- color: varchar(9), nullable // hex color of the column; null means no color
- position: integer NOT NULL // the position of the column in the kanban board (0 is the leftmost column); Unique per project
- specialType: Enum | null: // unique per project; enforced by the DB; null means no special type
    - "inProgress" // the column is for issues that are currently being worked on (only one column per project can have this special type)
    - "inReview"   // the column is for issues that are currently being reviewed (only one column per project can have this special type)
    - "done"       // the column is for issues that are done (only one column per project can have this special type)
    - "backlog"    // the column is for issues that are put back in the pool (only one column per project can have this special type)
- deleted: boolean NOT NULL default false // if true the column is deleted and cannot be used for new issues
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - UNIQUE(projectId, name, deleted) // unique active column names per project
    - UNIQUE(projectId, position, deleted) // unique active positions per project
    - UNIQUE(projectId, specialType) WHERE specialType IS NOT NULL AND deleted = false // partial unique index; only one active special column per project
    - CHECK (color IS NULL OR color ~ '^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$') // valid hex color
    - CHECK (position >= 0 AND position < 10000) // position must be non-negative and within sensible bounds

## issue
represents an issue in a project's kanban board
- id: PK, integer NOT NULL
- columnId: FK → column.id, integer NOT NULL ON DELETE RESTRICT
- name: varchar(255) NOT NULL
- description: text, nullable // markdown-supported issue description
- position: integer NOT NULL // the position of the issue in the column (0 is the topmost issue); Unique per column; TODO: fractional/lexicographic ordering
- locked: boolean NOT NULL default false // if true the issue cannot be moved, edited, delegated. Must be unlocked first before any of those actions can be performed; enforced by the DB
- deleted: boolean NOT NULL default false // if true the issue is deleted and cannot be viewed or edited
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - UNIQUE(columnId, position, deleted) // unique active positions per column
    - CHECK (position >= 0 AND position < 10000) // position must be non-negative and within sensible bounds
    - CHECK (description IS NULL OR LENGTH(description) <= 10000) // sensible max length for issue descriptions

## issueLabels
Join table automatically managed by Sequelize (`belongsToMany`).  
Composite PK on `(issueId, labelId)`.
- issueId: FK → issue.id, integer NOT NULL ON DELETE CASCADE
- labelId: FK → label.id, integer NOT NULL ON DELETE CASCADE
- Constraints:
    - UNIQUE(issueId, labelId) // prevent duplicate label assignments

## log
represents a project-wide audit log entry covering project, column, label, issue, comment and agent-task events
- id: PK, integer NOT NULL
- projectId: FK → project.id, integer NOT NULL ON DELETE CASCADE
- actorId: FK → user.id, nullable ON DELETE SET NULL
- action: Enum NOT NULL:
    - "projectCreated"
    - "projectRenamed"
    - "projectDescriptionChanged"
    - "projectArchived"
    - "projectUnarchived"
    - "projectDeleted"
    - "columnCreated"
    - "columnRenamed"
    - "columnMoved"
    - "columnDeleted"
    - "columnColorChanged"
    - "columnSpecialTypeChanged"
    - "labelCreated"
    - "labelRenamed"
    - "labelDeleted"
    - "labelColorChanged"
    - "labelIconChanged"
    - "issueCreated"
    - "issueMoved"
    - "issueRenamed"
    - "issueDescriptionChanged"
    - "issueLocked"
    - "issueUnlocked"
    - "issueDeleted"
    - "commentCreated"
    - "commentEdited"
    - "commentDeleted"
    - "issueLabelAdded"
    - "issueLabelRemoved"
    - "agentTaskDelegated"
    - "agentTaskStatusChanged"
    - "agentTaskCompleted"
- field: varchar(255), nullable // the attribute that changed, e.g. "name", "columnId", "description", "content", "status", "position"
- oldValue: text, nullable // previous value; truncated to 10 000 chars if exceeded
- newValue: text, nullable // new value; truncated to 10 000 chars if exceeded
- columnId: FK → column.id, nullable ON DELETE SET NULL
- labelId: FK → label.id, nullable ON DELETE SET NULL
- issueId: FK → issue.id, nullable ON DELETE SET NULL
- commentId: FK → comment.id, nullable ON DELETE SET NULL
- agentTaskId: FK → agentTask.id, nullable ON DELETE SET NULL
- createdAt: datetime NOT NULL
- Constraints:
    - CHECK (oldValue IS NOT NULL OR newValue IS NOT NULL) // at least one of before/after must be recorded
    - CHECK (oldValue IS NULL OR LENGTH(oldValue) <= 10000)
    - CHECK (newValue IS NULL OR LENGTH(newValue) <= 10000)

## comment
represents a comment made on an issue
- id: PK, integer NOT NULL
- issueId: FK → issue.id, integer NOT NULL ON DELETE CASCADE
- userId: varchar(36) NOT NULL // commenting user's id (user.id above); treated as ON DELETE RESTRICT — a comment outlives its author only if the id is kept
- content: text NOT NULL // markdown-supported comment content
- deleted: boolean NOT NULL default false // if true the comment is deleted and its content should not be displayed
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - CHECK (LENGTH(content) <= 10000) // sensible max length for comments

## agentTask
represents a task that was delegated to an agent
- id: PK, integer NOT NULL
- issueId: FK → issue.id, integer NOT NULL ON DELETE CASCADE
- runnerId: varchar(255), nullable // the id of the agent runner; null while status is "scheduled"
- triggeredBy: Enum NOT NULL:
    - "user" // the task was triggered by a user action (e.g. the user clicking a button to delegate an event)
    - "automation" // the task was triggered by an automation (e.g. a scheduled task, a webhook, etc.)
    - "githubAction" // the task was triggered by a GitHub Action (e.g. a workflow run, a pull request, etc.)
    - "githubCommand" // the task was triggered by a GitHub comment /run-agent command (needs to be implemented in the future, needs authentication and authorization checks)
- status: Enum NOT NULL:
    - "scheduled" // the task is scheduled for a runner
    - "running" // the task is currently running on a runner
    - "waiting" // the task is waiting (e.g. after a question has been answered)
    - "completed" // the task has been completed by the runner
    - "cancelled" // the task has been cancelled
    - "paused" // the task has been paused (e.g. waiting for a human to answer a question, or waiting for a human to resume the task, waiting for a human to fix an error, waiting for a human to unpause the task, etc.)
- statusDetail: Enum | null: // reason / sub-state for blocked or terminal error conditions
    - "question" // the task is waiting for a question to be answered by the user
    - "stuck" // the agent is marked as stuck by a decision model; it hasn't made progress and is not expected to complete in its current state
    - "helpRequested" // Human help has been requested by the agent or the decision model; the task is waiting for a human to intervene
    - "failed" // the task has failed, as the agent couldn't complete it
    - "runnerError" // the task has errored while running on the runner (e.g. Sandbox error, agent harness error, timed out, etc.)
    - "webError" // the task has errored on the web server side (assignment failed, etc.)
- statusMessage: varchar(1000), nullable // a message for further details about the status
- data: json, nullable // full run logs, including input, output, and any other relevant data; can be large, but should be limited to a reasonable size (e.g. 10MB)
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- Constraints:
    - CHECK (runnerId IS NOT NULL OR status <> 'running') // runnerId must be set when running
    - CHECK (statusDetail IS NULL OR status IN ('waiting', 'paused', 'completed', 'cancelled')) // statusDetail only for terminal or blocked states
    - CHECK (status <> 'completed' OR statusDetail IS NULL) // completed tasks have no error details
    - CHECK (status <> 'running' OR statusDetail IS NULL) // running tasks have no statusDetail
    - CHECK (data IS NULL OR LENGTH(data::text) <= 10000000) // sensible max JSON blob size

# Associations

user 1..1 group
group 1..* project
project 1..* label
project 1..* column
column 1..* issue
label *. issueLabels .* issue (Sequelize belongsToMany join table)
project 1..* log
issue 0..* log
column 0..* log
issue 1..* comment
comment n..1 user
log n..1 actor (nullable)
log n..1 column (nullable)
log n..1 label (nullable)
log n..1 issue (nullable)
log n..1 comment (nullable)
log n..1 agentTask (nullable)
issue 1..* agentTask

All IDs except issue IDs will be cyphered for external/public use. Internally they should all be sequential integers. Public IDs will be generated using a cypher function that takes the internal ID and returns a cyphered ID. If the internal ID is smaller than 10,000, it is 0-padded to 5 digits **before** cyphering. This is done in the application layer, not the database layer.

Datetime is managed/enforced by sequelize and the database. All datetime fields are stored in UTC and should be treated as UTC in the application layer. The application layer should convert to local timezones for display purposes.
# Row Level Security

Every table in `app` runs with RLS **on** (migration `20261108000002-row-level-security`, applied with `npm run db:migrate`). The web app reads through PostgREST as the `anon` role and mints a short-lived token per request whose `sub` is the session user, so the policies resolve the caller with `app.current_user_id()` (`request.jwt.claims ->> 'sub'`):

| table | a row is visible when |
| --- | --- |
| `Groups` | `ownerId` is the caller |
| `Projects` | its group belongs to the caller |
| `Columns`, `Labels`, `Logs` | its project belongs to the caller (`app.owns_project`) |
| `Issues` | its column's project belongs to the caller |
| `Comments`, `AgentTasks`, `IssueLabels` | its issue is visible (`app.owns_issue`) |
| `SequelizeMeta` | never — RLS on, no policy |

- Policies are `FOR SELECT` only, and `anon`/`authenticated` hold `SELECT` grants and nothing else, so the API roles cannot write at all.
- `FORCE ROW LEVEL SECURITY` is deliberately off: the table owner (`postgres` — used by `db:migrate`, `.agents/dbq.sh` and the sample seed) and BYPASSRLS roles (`service_role`, `supabase_admin`) keep working unchanged. Never read user data with `service_role`: it bypasses every policy.
- No `sub` in the token means no rows — a bare call to the API with the static anon key returns nothing, by design.
- **Adding a table to `app`?** Enable RLS and add its policy in the same migration (the statements are idempotent, so re-running `20261108000002` also fixes a table that was created without them). An enabled table with no policy is readable by nobody but the owner.
- The app-layer filter in `app/_lib/kanbanRepo.ts` stays: it is what turns a foreign project into a 404 instead of an empty board. RLS is the backstop for queries that forget it.
