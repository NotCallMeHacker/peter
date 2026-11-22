'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Supabase Realtime for the board: WAL publication + private channel rules.
 *
 * The board subscribes to `postgres_changes` on `app."Issues"` and
 * `app."Columns"` over a WebSocket to the realtime service. For the change
 * events to exist at all, the tables must be members of the
 * `supabase_realtime` publication — that is what the realtime service's
 * WALRUS decoder tails. This adds `Columns`, `Issues`, `Comments` and
 * `AgentTasks`.
 *
 * Channels are private (`board:<projectId>`): realtime ships an RLS-style
 * authorization path where every channel join is checked against policies on
 * `realtime.messages`. The policy below answers "may this caller see the
 * `board:<id>` stream?" the same way the app's own reads do: only when the
 * project behind the topic belongs to the caller.
 *
 * Grants on `realtime.messages`: the realtime service checks the policy as
 * the request role (here `authenticated`), so that role needs SELECT — and the
 * broadcast/presence paths of the same channel need INSERT/UPDATE. Harmless
 * without the policy (which still filters every row).
 *
 * Note: `supabase_realtime_messages_publication` (the `realtime.messages_*`
 * partitions) is owned by the realtime service — never touched here.
 *
 * Idempotent: membership checks + plain GRANTs + DROP/CREATE POLICY. A live
 * database that already applied this migration (ledger row) skips it.
 */

const membershipSql = `
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Columns', 'Issues', 'Comments', 'AgentTasks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'app' AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE app.%I', table_name);
    END IF;
  END LOOP;
END $$;
`;

const grantSql = `
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON realtime.messages TO %I', role_name);
    END IF;
  END LOOP;
END $$;
`;

const dropPolicySql = 'DROP POLICY IF EXISTS "realtime_messages_board" ON realtime.messages';

const createPolicySql = `
CREATE POLICY "realtime_messages_board" ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    topic ~~ 'board:%'
    AND extension = ANY (ARRAY['postgres_changes', 'broadcast', 'presence'])
    AND SUBSTRING(topic FROM 7) ~ '^[0-9]+$'
    AND EXISTS (
      SELECT 1
      FROM app."Projects" p
      JOIN app."Groups" g ON g.id = p."groupId"
      WHERE p.id = (SUBSTRING(messages.topic FROM 7))::integer
        AND g."ownerId" = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    )
  );
`;

const dropTableStatements: string[] = [
  'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS app."Columns"',
  'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS app."Issues"',
  'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS app."Comments"',
  'ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS app."AgentTasks"',
];

module.exports = {
  async up(queryInterface: QueryInterface) {
    const sequelize = queryInterface.sequelize;

    await sequelize.query(membershipSql);
    await sequelize.query(grantSql);
    await sequelize.query(dropPolicySql);
    await sequelize.query(createPolicySql);
  },

  async down(queryInterface: QueryInterface) {
    const sequelize = queryInterface.sequelize;

    await sequelize.query(dropPolicySql);
    for (const statement of dropTableStatements) {
      await sequelize.query(statement);
    }
  },
};
