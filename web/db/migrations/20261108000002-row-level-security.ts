'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Row Level Security on every table of the app schema.
 *
 * The web app talks to these tables through PostgREST with one shared key, so
 * without RLS the only thing keeping one account out of another's projects is
 * the filter in app/_lib/kanbanRepo.ts. This makes the database enforce it:
 * every read goes through a policy that resolves the caller from the JWT
 * claims PostgREST puts in `request.jwt.claims` — the `sub` the web app mints
 * into a per-request token (app/_lib/db.ts).
 *
 * Shape of the rules (dependency order, no cycles — a policy never reads the
 * table it guards, so Postgres cannot recurse):
 *
 *   Groups      ownerId = caller
 *   Projects    its group is owned by the caller
 *   Columns     its project is owned by the caller   (app.owns_project)
 *   Labels/Logs same
 *   Issues      its column's project is owned        (correlated EXISTS)
 *   Comments/AgentTasks/IssueLabels  its issue is owned (app.owns_issue)
 *   SequelizeMeta  RLS on, no policy → nobody but the owner reads it
 *
 * Everything is `FOR SELECT` only: anon/authenticated hold SELECT grants and
 * no write policies exist, so writes are denied twice over. Postgres never
 * applies RLS to the table owner (`postgres`, which runs migrations and
 * seeds) or to roles with BYPASSRLS (supabase `service_role`, `supabase_admin`)
 * — so `db:migrate`, .agents/dbq.sh and the sample seed are unaffected. `FORCE`
 * is deliberately off for the same reason.
 *
 * Sequelize has no RLS API, so it does what it can — enumerate the tables
 * through the query interface — and the DDL itself is plain SQL. New tables in
 * this schema need the same treatment: enable RLS and add a policy here (the
 * statements are idempotent, so the migration can simply be re-run).
 */

type TableRef = string | { tableName?: string; table?: string; table_name?: string };

/** `showAllTables` answers with strings or row objects, depending on dialect. */
function tableNameOf(table: TableRef): string {
    if (typeof table === 'string') return table;
    return table.tableName ?? table.table ?? table.table_name ?? '';
}

/** Quote an identifier the way Postgres wants it. */
function ident(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/** Helper functions the policies call. Both are STABLE and SECURITY INVOKER. */
const helpersSql = `
-- The caller, as PostgREST saw it in the request JWT. '' or no sub → NULL,
-- which fails every comparison below: no identity, no rows.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $fn$
    SELECT nullif(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
        ''
    )
$fn$;

CREATE OR REPLACE FUNCTION app.owns_project(project_id integer) RETURNS boolean
LANGUAGE sql STABLE
AS $fn$
    SELECT EXISTS (
        SELECT 1
        FROM app."Projects" p
        JOIN app."Groups" g ON g.id = p."groupId"
        WHERE p.id = project_id
          AND g."ownerId" = app.current_user_id()
    )
$fn$;

CREATE OR REPLACE FUNCTION app.owns_issue(issue_id integer) RETURNS boolean
LANGUAGE sql STABLE
AS $fn$
    SELECT EXISTS (
        SELECT 1
        FROM app."Issues" i
        JOIN app."Columns" c ON c.id = i."columnId"
        WHERE i.id = issue_id
          AND app.owns_project(c."projectId")
    )
$fn$;
`;

/** `USING` expression of the SELECT policy for each table that has one. */
const readPolicies: { table: string; using: string }[] = [
    { table: 'Groups', using: '"ownerId" = app.current_user_id()' },
    {
        table: 'Projects',
        using:
            'EXISTS (SELECT 1 FROM app."Groups" g WHERE g.id = "groupId" AND g."ownerId" = app.current_user_id())',
    },
    { table: 'Columns', using: 'app.owns_project("projectId")' },
    { table: 'Labels', using: 'app.owns_project("projectId")' },
    { table: 'Logs', using: 'app.owns_project("projectId")' },
    {
        table: 'Issues',
        using:
            'EXISTS (SELECT 1 FROM app."Columns" c WHERE c.id = "columnId" AND app.owns_project(c."projectId"))',
    },
    { table: 'Comments', using: 'app.owns_issue("issueId")' },
    { table: 'AgentTasks', using: 'app.owns_issue("issueId")' },
    { table: 'IssueLabels', using: 'app.owns_issue("issueId")' },
];

const POLICY = 'read_own_rows';

module.exports = {
  async up(queryInterface: QueryInterface) {
    const sequelize = queryInterface.sequelize;
    const tables = (await queryInterface.showAllTables())
      .map(tableNameOf)
      .filter(Boolean);

    await sequelize.query(helpersSql);

    for (const table of tables) {
      await sequelize.query(`ALTER TABLE app.${ident(table)} ENABLE ROW LEVEL SECURITY`);
    }

    for (const policy of readPolicies) {
      if (!tables.includes(policy.table)) continue; // table not in this schema
      await sequelize.query(`DROP POLICY IF EXISTS ${ident(POLICY)} ON app.${ident(policy.table)}`);
      await sequelize.query(
        `CREATE POLICY ${ident(POLICY)} ON app.${ident(policy.table)} FOR SELECT ` +
          `USING (${policy.using})`
      );
    }
  },

  async down(queryInterface: QueryInterface) {
    const sequelize = queryInterface.sequelize;
    const tables = (await queryInterface.showAllTables())
      .map(tableNameOf)
      .filter(Boolean);

    for (const table of tables) {
      await sequelize.query(`DROP POLICY IF EXISTS ${ident(POLICY)} ON app.${ident(table)}`);
      await sequelize.query(`ALTER TABLE app.${ident(table)} DISABLE ROW LEVEL SECURITY`);
    }
    await sequelize.query('DROP FUNCTION IF EXISTS app.owns_issue(integer)');
    await sequelize.query('DROP FUNCTION IF EXISTS app.owns_project(integer)');
    await sequelize.query('DROP FUNCTION IF EXISTS app.current_user_id()');
  },
};
