'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Runner-instance registry for the agent-runner bridge (M2M auth).
 *
 * One row per supervisor instance. `publicKey` is the raw Ed25519 public key
 * (base64url, 32 bytes) that B verifies challenge signatures against; the
 * private key never leaves the supervisor. Rows are written ONLY by the
 * `runner-keys` Supabase edge function, which is gated to the Supabase
 * dashboard (service-role bearer) — hence the deliberate asymmetry in grants:
 *
 *   SELECT  → anon, authenticated, service_role  (the web bridge reads the
 *             registry through PostgREST with the anon key; public keys are
 *             not secrets, so reads are open)
 *   write   → service_role only                  (anon/authenticated hold no
 *             INSERT/UPDATE/DELETE grants and no write policies, so nothing
 *             reachable from the browser or the web app can mint or mutate a
 *             trusted identity)
 *
 * Revocation is soft: `revokedAt` set = dead identity. The bridge refuses a
 * revoked id at handshake even though the public key is still on file, and
 * deleting a row is never the only way to cut an instance off.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS, safe to re-run.
 */

const upStatements: string[] = [
  `CREATE TABLE IF NOT EXISTS app."RunnerInstances" (
     id text PRIMARY KEY,
     "publicKey" text NOT NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "revokedAt" timestamptz NULL
   )`,
  `COMMENT ON TABLE app."RunnerInstances" IS 'Agent-runner supervisors allowed to connect over the WSS bridge; written only by the dashboard-gated runner-keys edge function'`,
  `GRANT SELECT ON app."RunnerInstances" TO anon, authenticated, service_role`,
  `GRANT INSERT, UPDATE, DELETE ON app."RunnerInstances" TO service_role`,
  `ALTER TABLE app."RunnerInstances" ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "runner_instances_read_all" ON app."RunnerInstances"`,
  `CREATE POLICY "runner_instances_read_all" ON app."RunnerInstances" FOR SELECT TO anon, authenticated, service_role USING (true)`,
  `DROP POLICY IF EXISTS "runner_instances_service_write" ON app."RunnerInstances"`,
  `CREATE POLICY "runner_instances_service_write" ON app."RunnerInstances" FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  `NOTIFY pgrst, 'reload schema'`,
];

const downStatements: string[] = [
  `DROP TABLE IF EXISTS app."RunnerInstances"`,
  `NOTIFY pgrst, 'reload schema'`,
];

module.exports = {
  async up(queryInterface: QueryInterface) {
    const sequelize = queryInterface.sequelize;

    for (const statement of upStatements) {
      await sequelize.query(statement);
    }
  },

  async down(queryInterface: QueryInterface) {
    const sequelize = queryInterface.sequelize;

    for (const statement of downStatements) {
      await sequelize.query(statement);
    }
  },
};