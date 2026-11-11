'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Let the Supabase REST API read the app schema.
 *
 * The web app queries Projects/Columns/Issues/... through supabase-js, i.e.
 * PostgREST, which connects as `authenticator` and switches to the `anon`,
 * `authenticated` or `service_role` role from the request JWT. Those roles
 * need schema usage and SELECT on the tables — without them every board query
 * fails with "RBAC: access denied".
 *
 * `app` must also be listed in PGRST_DB_SCHEMAS (supabase/.env); that is a
 * PostgREST config value, so it cannot live in a migration.
 *
 * Default privileges keep the grant alive for tables later migrations create.
 */

const grantSql = `
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA app TO %I', role_name);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA app TO %I', role_name);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA app GRANT SELECT ON TABLES TO %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
`;

const revokeSql = `
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA app REVOKE SELECT ON TABLES FROM %I',
        role_name
      );
      EXECUTE format('REVOKE SELECT ON ALL TABLES IN SCHEMA app FROM %I', role_name);
      EXECUTE format('REVOKE USAGE ON SCHEMA app FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
`;

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.sequelize.query(grantSql);
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.sequelize.query(revokeSql);
  },
};
