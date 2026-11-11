'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Local user references store the SuperTokens user id, not an integer.
 *
 * `supertokens.all_auth_recipe_users.user_id` is a uuid (varchar(36)), so
 * `Groups.ownerId` and `Comments.userId` — the two columns that name a user —
 * have to hold the same shape. The init migration created them as integers
 * (models.md said "FK → user.id" before the user table was inspected); this
 * widens them in place, so both fresh and already-migrated databases converge.
 *
 * No physical FK is added: the SuperTokens primary key is the composite
 * (app_id, tenant_id, user_id), which a single-column FK cannot reference.
 *
 * Both statements are guarded, so re-running the migration is a no-op.
 */

const toUuidSql = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'Groups'
      AND column_name = 'ownerId' AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE app."Groups"
      ALTER COLUMN "ownerId" TYPE varchar(36) USING "ownerId"::varchar(36);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'Comments'
      AND column_name = 'userId' AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE app."Comments"
      ALTER COLUMN "userId" TYPE varchar(36) USING "userId"::varchar(36);
  END IF;
END $$;
`;

// Reverting throws while uuid values are present — they do not fit an integer
// column. Clear them first (e.g. by re-running the sample-data seed, which
// deletes the rows it owns) if a rollback is ever needed.
const backToIntegerSql = `
UPDATE app."Groups"  SET "ownerId" = '0' WHERE "ownerId" !~ '^[0-9]+$';
UPDATE app."Comments" SET "userId" = '0' WHERE "userId" !~ '^[0-9]+$';
ALTER TABLE app."Groups"   ALTER COLUMN "ownerId" TYPE integer USING "ownerId"::integer;
ALTER TABLE app."Comments" ALTER COLUMN "userId"  TYPE integer USING "userId"::integer;
`;

module.exports = {
  async up(queryInterface: QueryInterface) {
    await queryInterface.sequelize.query(toUuidSql);
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.sequelize.query(backToIntegerSql);
  },
};
