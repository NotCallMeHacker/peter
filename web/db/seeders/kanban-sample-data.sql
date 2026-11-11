-- Sample projects for the kanban board.
--
-- Run once through the repo's DB helper (it execs into the Postgres container):
--
--     bash .agents/dbq.sh "$(cat web/db/seeders/kanban-sample-data.sql)"
--
-- Every statement is sent in one implicit transaction, so the seed is atomic
-- and re-runnable: a previous run's rows for these three projects are deleted
-- first, then rebuilt from scratch. Groups are upserted on (ownerId, deleted),
-- the constraint models.md defines.
--
-- Ownership: every project joins its group through `Projects.groupId`, and the
-- group names its owner in `Groups.ownerId` — the account id from `auth.users`,
-- verbatim (uuid, varchar(36)). The board renders a comment as "YOU" when its
-- `Comments.userId` equals the group's ownerId, so the seed writes the same id
-- into both columns. Nothing else may see those projects: the app scopes every
-- query to the session user (app/_lib/kanbanRepo.ts).
--
-- Two accounts, one group each (models.md maps a group 1:1 to a user):
--   main     — 42f27c43-… — owns peter / core and peter / infra
--   teammate — f1e4435e-… — owns peter / docs
-- Change an id, a group name or which project goes where below; the project
-- list is the only place that decides who owns what.

-- Accounts the seeded groups and comments belong to:
-- auth.users.id (Supabase Auth / GoTrue)
CREATE TEMP TABLE seed_owner (role text, user_id varchar(36), group_name text) ON COMMIT DROP;
INSERT INTO seed_owner (role, user_id, group_name) VALUES
    ('main',     '42f27c43-dc9b-413b-b58a-3a4e4248f754', 'Peter'),
    ('teammate', 'a7537779-bbd4-4c9d-98a4-c53304d74887', 'Docs');

-- ── 1. clear a previous run (children first; the rest cascades) ──────────────
DELETE FROM app."Issues"
WHERE "columnId" IN (
    SELECT c.id
    FROM app."Columns" c
    JOIN app."Projects" p ON p.id = c."projectId"
    WHERE p.name IN ('peter / core', 'peter / docs', 'peter / infra')
);

DELETE FROM app."Projects"
WHERE name IN ('peter / core', 'peter / docs', 'peter / infra');

-- Earlier seeds owned groups through an integer placeholder; drop leftovers
-- once their projects are gone — only the groups named below may survive.
DELETE FROM app."Groups" g
WHERE g."ownerId" NOT IN (SELECT user_id FROM seed_owner)
  AND NOT EXISTS (SELECT 1 FROM app."Projects" p WHERE p."groupId" = g.id);

-- ── 2. one group per owner (unique (ownerId, deleted)) ───────────────────────
INSERT INTO app."Groups" ("ownerId", name, "deleted", "createdAt", "updatedAt")
SELECT user_id, group_name, false, now(), now() FROM seed_owner
ON CONFLICT ("ownerId", "deleted") DO UPDATE SET name = EXCLUDED.name;

-- ── 3. projects ──────────────────────────────────────────────────────────────
INSERT INTO app."Projects"
    ("groupId", name, description, "unicodeIcon", "gitUrl", "isGitHubRepo",
     "defaultBranch", archived, deleted, "createdAt", "updatedAt")
SELECT g.id, v.name, v.description, v.icon, v.giturl, false, 'main', v.archived,
       false, now(), now()
FROM app."Groups" g
JOIN (VALUES
    ('peter / core',
     'The peter app: board, agents and the self-hosted stack.',
     '🐾', 'https://github.com/peter-dev/peter.git', false, 'main'),
    ('peter / docs',
     'Product docs, runbooks and the agent handbook.',
     '📘', 'https://github.com/peter-dev/docs.git', true, 'teammate'),
    ('peter / infra',
     'Compose stack, Postgres backups and the runner fleet.',
     '🛠', 'https://github.com/peter-dev/infra.git', false, 'main')
) AS v(name, description, icon, giturl, archived, owner)
    ON TRUE
JOIN seed_owner o ON o.role = v.owner AND o.user_id = g."ownerId"
WHERE NOT g."deleted";

-- ── 4. four columns per board, ordered like the designed pills ───────────────
INSERT INTO app."Columns"
    ("projectId", name, color, position, "specialType", "deleted", "createdAt", "updatedAt")
SELECT p.id, v.name, v.color, v.position,
       v.special::app."enum_Columns_specialType", false, now(), now()
FROM app."Projects" p
JOIN (VALUES
    ('Backlog',     '#9491DD', 0, 'backlog'),
    ('Ready',       '#3FC6BF', 1, NULL),
    ('In progress', '#4C90F3', 2, 'inProgress'),
    ('Review',      '#53C88E', 3, 'inReview')
) AS v(name, color, position, special)
    ON TRUE
WHERE p.name IN ('peter / core', 'peter / docs', 'peter / infra')
  AND NOT p."deleted";

-- ── 5. type labels; an issue's type is the label it carries ──────────────────
INSERT INTO app."Labels"
    ("projectId", name, "unicodeIcon", color, position, deleted, "createdAt", "updatedAt")
SELECT p.id, v.name, NULL, v.color, v.position, false, now(), now()
FROM app."Projects" p
JOIN (VALUES
    ('bug',        '#B3452A', 0),
    ('improvement','#3D5FD6', 1),
    ('chore',      '#5A648F', 2),
    ('docs',       '#17724E', 3)
) AS v(name, color, position)
    ON TRUE
WHERE p.name IN ('peter / core', 'peter / docs', 'peter / infra')
  AND NOT p."deleted";

-- ── 6. issues ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE seed_issue (
    project  text,
    col      text,
    position int,
    type     text,
    name     text,
    description text
) ON COMMIT DROP;

INSERT INTO seed_issue (project, col, position, type, name, description) VALUES
-- peter / core · Backlog
('peter / core', 'Backlog', 0, 'improvement', 'Sync issues to GitHub Projects (optional)', 'Two-way sync with a GitHub project board, opt-in per project.'),
('peter / core', 'Backlog', 1, 'chore', 'Worktree cleanup after merged runs', 'Prune worktrees once a run is merged and its branch is gone.'),
('peter / core', 'Backlog', 2, 'docs', 'Docs: outline → markdown export', 'Export an outline document to a markdown file in the repo.'),
('peter / core', 'Backlog', 3, 'improvement', 'Storage stub: multipart uploads', 'Wire multipart uploads through the storage service.'),
('peter / core', 'Backlog', 4, 'chore', 'Vector logs retention policy', 'Decide how long run logs stay before they are rolled up.'),
('peter / core', 'Backlog', 5, 'improvement', 'Envoy CDS hot-reload watch', 'Reload the gateway config without dropping connections.'),
('peter / core', 'Backlog', 6, 'improvement', 'Realtime presence for agent status', 'Show which agents are alive without polling the API.'),
('peter / core', 'Backlog', 7, 'chore', 'Worktree prune on merge', 'Merge should return the worktree to the pool.'),
('peter / core', 'Backlog', 8, 'docs', 'Docs: agent runbook in outline', 'Document how a run starts, fails and is retried.'),
('peter / core', 'Backlog', 9, 'bug', 'Rate-limit the GitHub sync webhook', 'The sync webhook answers anonymous bursts today.'),
('peter / core', 'Backlog', 10, 'improvement', 'Board keyboard navigation', 'Move between columns and cards without a pointer.'),
('peter / core', 'Backlog', 11, 'docs', 'Export board to markdown', 'Snapshot a board as a checklist in the repo.'),
-- peter / core · Ready
('peter / core', 'Ready', 0, 'bug', 'Pooler drops connections under load', 'Supavisor closes pooled connections when CI floods the database.'),
('peter / core', 'Ready', 1, 'bug', 'Rotate JWT keys without downtime', 'Key rotation currently invalidates every live session.'),
('peter / core', 'Ready', 2, 'bug', 'Session refresh race under load', 'Two refresh calls race and the second one signs the user out.'),
('peter / core', 'Ready', 3, 'improvement', 'Delegated run: outline sync', 'An agent run should keep the outline in step with the repo.'),
('peter / core', 'Ready', 4, 'chore', 'pgbouncer pool_size tuning', 'Pool size is the default while the stack runs 20 runners.'),
-- peter / core · In progress
('peter / core', 'In progress', 0, 'improvement', 'Kanban: read the board from Supabase', 'Serve columns, issues and runs from the database instead of fixture data.'),
('peter / core', 'In progress', 1, 'bug', 'Agent run failed: pgbouncer timeout', 'A run dies when the pooler times out mid-query.'),
('peter / core', 'In progress', 2, 'improvement', 'i18n: add French locale', 'Add fr to the next-intl message files and the language switcher.'),
('peter / core', 'In progress', 3, 'improvement', 'Agent log streaming over SSE', 'Stream run output while the run is still going.'),
-- peter / core · Review
('peter / core', 'Review', 0, 'chore', 'RequireSession refactor', 'The gate component carries two jobs; split them.'),
('peter / core', 'Review', 1, 'improvement', 'Theme toggle: persist choice', 'The chosen theme is lost between visits.'),
-- peter / docs
('peter / docs', 'Backlog', 0, 'docs', 'Runbook: rotating Supabase API keys', 'What to run, in which order, and what breaks first.'),
('peter / docs', 'Backlog', 1, 'docs', 'Docs: worktree conventions', 'Naming, lifetime and cleanup rules for agent worktrees.'),
('peter / docs', 'Backlog', 2, 'docs', 'Handbook: delegating to agents', 'When to delegate, what to expect back, when to take over.'),
('peter / docs', 'Ready', 0, 'docs', 'Outline: v0.2 scope', 'What the next release of the docs covers.'),
('peter / docs', 'In progress', 0, 'docs', 'Guide: self-hosting the stack', 'Bring the compose stack up from a clean machine.'),
('peter / docs', 'Review', 0, 'docs', 'Changelog for the Supabase wiring', 'Record the move of the board onto live data.'),
-- peter / infra (Review stays empty on purpose: the empty-column state)
('peter / infra', 'Backlog', 0, 'chore', 'Nightly Postgres backup schedule', 'Backups stop at the volume level today.'),
('peter / infra', 'Backlog', 1, 'chore', 'MinIO for Supabase storage', 'Object storage needs a self-hosted backend.'),
('peter / infra', 'Backlog', 2, 'chore', 'Rotate the JWT secret on a schedule', 'The stack has one long-lived secret.'),
('peter / infra', 'Backlog', 3, 'chore', 'Pin the Postgres major version', 'Upgrades should be a decision, not a side effect.'),
('peter / infra', 'Ready', 0, 'chore', 'pgbouncer pool sizing for CI', 'CI jobs starve the app of connections.'),
('peter / infra', 'Ready', 1, 'improvement', 'Healthchecks for the api-gw', 'The gateway reports healthy while routing is down.'),
('peter / infra', 'In progress', 0, 'improvement', 'Supabase: expose the app schema over REST', 'PostgREST must serve app.* so the board can read it.');

-- Issues are created oldest-first (Backlog → Review, then by position), so the
-- ids climb the way a real board would and the dates below agree with them:
-- backlog cards are days old (they render as dates), work in progress is from
-- today (it renders as a time).
INSERT INTO app."Issues"
    ("columnId", name, description, position, locked, deleted, "createdAt", "updatedAt")
SELECT c.id, s.name, s.description, s.position, false, false,
       now() - (s.age_days * interval '1 day'),
       now() - (s.age_days * interval '1 day')
FROM (
    SELECT se.*,
           CASE se.col WHEN 'Backlog'      THEN 4 + se.position * 0.7
                       WHEN 'Ready'        THEN 1 + se.position * 0.5
                       WHEN 'In progress'  THEN se.position * 0.2
                       ELSE                    se.position * 0.1 END AS age_days,
           CASE se.col WHEN 'Backlog' THEN 0 WHEN 'Ready' THEN 1
                       WHEN 'In progress' THEN 2 ELSE 3 END AS col_rank
    FROM seed_issue se
) s
JOIN app."Projects" p ON p.name = s.project AND NOT p."deleted"
JOIN app."Columns" c ON c."projectId" = p.id AND c.name = s.col
ORDER BY p.name, s.col_rank, s.position;

-- ── 7. attach each issue's type label ────────────────────────────────────────
INSERT INTO app."IssueLabels" ("issueId", "labelId")
SELECT i.id, l.id
FROM seed_issue s
JOIN app."Projects" p ON p.name = s.project AND NOT p."deleted"
JOIN app."Columns" c ON c."projectId" = p.id AND c.name = s.col
JOIN app."Issues" i ON i."columnId" = c.id AND i.name = s.name
JOIN app."Labels" l ON l."projectId" = p.id AND l.name = s.type;

-- ── 8. agent runs: failures drive the hero count, questions drive the badge ──
INSERT INTO app."AgentTasks"
    ("issueId", "runnerId", "triggeredBy", status, "statusDetail", "statusMessage",
     data, "createdAt", "updatedAt")
SELECT i.id, v.runner,
       v.triggered::app."enum_AgentTasks_triggeredBy",
       v.state::app."enum_AgentTasks_status",
       v.detail::app."enum_AgentTasks_statusDetail",
       v.message,
       v.data::json,
       now() - (v.age * interval '1 minute'),
       now() - (v.age * interval '1 minute')
FROM (VALUES
    ('peter / core', 'In progress', 'Kanban: read the board from Supabase',
     'agent-1', 'user', 'running', NULL, NULL,
     '{"progress":64,"branch":"feat/kanban-supabase"}', 180),
    ('peter / core', 'In progress', 'Agent log streaming over SSE',
     'agent-2', 'user', 'running', NULL, NULL,
     '{"progress":38,"branch":"feat/sse-logs"}', 45),
    ('peter / core', 'In progress', 'Agent run failed: pgbouncer timeout',
     'agent-2', 'user', 'paused', 'runnerError',
     'The pooler refused the connection after 30s — retry on pg15?',
     '{"branch":"fix/pooler"}', 11),
    ('peter / core', 'Ready', 'Session refresh race under load',
     'agent-1', 'user', 'waiting', 'question',
     'Should the refresh race be fixed in the web layer or in SuperTokens?',
     '{"branch":"fix/session-refresh"}', 40),
    ('peter / core', 'Ready', 'Delegated run: outline sync',
     'agent-2', 'user', 'scheduled', NULL, NULL,
     '{"branch":"feat/outline-sync"}', 95),
    ('peter / core', 'Backlog', 'Rate-limit the GitHub sync webhook',
     'agent-1', 'user', 'paused', 'failed',
     'Rate limiting needs a store decision — Redis or in-memory?',
     '{"branch":"fix/webhook-ratelimit"}', 300),
    ('peter / core', 'Backlog', 'Realtime presence for agent status',
     'agent-2', 'user', 'paused', 'helpRequested',
     'Presence needs a schema decision before I can continue.',
     '{"branch":"feat/presence"}', 90),
    ('peter / core', 'Backlog', 'Worktree prune on merge',
     'agent-1', 'user', 'completed', NULL, NULL,
     '{"branch":"chore/worktree-prune"}', 600),
    ('peter / core', 'Backlog', 'Envoy CDS hot-reload watch',
     'agent-1', 'automation', 'paused', 'webError',
     'The web layer dropped the run before it started.',
     '{"branch":"feat/envoy-cds"}', 1500),
    ('peter / infra', 'In progress', 'Supabase: expose the app schema over REST',
     'agent-3', 'user', 'running', NULL,
     'Grants are applied — the board reads app.* over PostgREST now.',
     '{"progress":80,"branch":"feat/app-schema-rest"}', 20),
    ('peter / infra', 'Ready', 'pgbouncer pool sizing for CI',
     'agent-3', 'user', 'completed', NULL, NULL,
     '{"branch":"chore/pool-sizing"}', 720)
) AS v(project, col, issue, runner, triggered, state, detail, message, data, age)
JOIN app."Projects" p ON p.name = v.project AND NOT p."deleted"
JOIN app."Columns" c ON c."projectId" = p.id AND c.name = v.col
JOIN app."Issues" i ON i."columnId" = c.id AND i.name = v.issue;

-- ── 9. comments (userId = the group owner = the "YOU" line in the chat) ─────
INSERT INTO app."Comments"
    ("issueId", "userId", content, deleted, "createdAt", "updatedAt")
SELECT i.id, (SELECT user_id FROM seed_owner WHERE role = 'main'), v.content, false,
       now() - (v.age * interval '1 minute'),
       now() - (v.age * interval '1 minute')
FROM (VALUES
    ('peter / core', 'Ready', 'Pooler drops connections under load',
     'pg17 — we''re upgrading this week anyway.', 6),
    ('peter / core', 'Ready', 'Session refresh race under load',
     'Fix it in the web layer first; the SuperTokens upgrade lands next week.', 25)
) AS v(project, col, issue, content, age)
JOIN app."Projects" p ON p.name = v.project AND NOT p."deleted"
JOIN app."Columns" c ON c."projectId" = p.id AND c.name = v.col
JOIN app."Issues" i ON i."columnId" = c.id AND i.name = v.issue;

-- ── 10. 24h of run activity: eight 3h buckets, two of them failures ──────────
INSERT INTO app."Logs"
    ("projectId", "actorId", action, field, "oldValue", "newValue", "createdAt")
SELECT p.id,
       NULL,
       CASE WHEN b.failed AND g.n = b.cnt
            THEN 'agentTaskStatusChanged'::app."enum_Logs_action"
            ELSE 'issueMoved'::app."enum_Logs_action" END,
       CASE WHEN b.failed AND g.n = b.cnt THEN 'statusDetail' ELSE 'position' END,
       CASE WHEN b.failed AND g.n = b.cnt THEN NULL ELSE '0' END,
       CASE WHEN b.failed AND g.n = b.cnt THEN 'runnerError' ELSE '1' END,
       now() - ((24 - (b.bucket * 3 + 2)) * interval '1 hour')
             - (g.n * interval '7 minutes')
FROM app."Projects" p
JOIN (VALUES
    (0, 3, false), (1, 4, false), (2, 6, true),  (3, 2, false),
    (4, 5, false), (5, 4, true),  (6, 3, false), (7, 5, false)
) AS b(bucket, cnt, failed)
    ON TRUE
CROSS JOIN LATERAL generate_series(1, b.cnt) AS g(n)
WHERE p.name IN ('peter / core', 'peter / docs', 'peter / infra')
  AND NOT p."deleted";
