'use strict';

import { QueryInterface, DataTypes } from 'sequelize';

/**
 * Adds 'inReview' to app."enum_AgentTasks_statusDetail".
 *
 * inReview marks a finished round that is waiting for a human to review the
 * agent's changes; it is always paired with status 'waiting' (see
 * web/db/models/models.md). The existing CHECK constraints already allow a
 * statusDetail under 'waiting', so only the enum type gains a value.
 *
 * Postgres-only: SQLite stores Sequelize ENUM columns as TEXT, so there is
 * nothing to alter there.
 *
 * Idempotent: ADD VALUE IF NOT EXISTS. Reversible: Postgres has no
 * ALTER TYPE ... DROP VALUE, so down() is a documented no-op — removing the
 * value would mean recreating the type and rewriting the column, which is
 * not worth it for a value that simply becomes unused.
 *
 * Note: ALTER TYPE ... ADD VALUE cannot be used with the new value inside the
 * same transaction; this migration only adds the value and never inserts rows.
 */

module.exports = {
  async up(queryInterface: QueryInterface, _SequelizeDT: typeof DataTypes) {
    const sequelize = queryInterface.sequelize;

    if (sequelize.getDialect() !== 'postgres') return;

    await sequelize.query(
      `ALTER TYPE app."enum_AgentTasks_statusDetail" ADD VALUE IF NOT EXISTS 'inReview'`
    );
  },

  async down(_queryInterface: QueryInterface, _SequelizeDT: typeof DataTypes) {
    // No-op: Postgres cannot drop a single enum value.
  },
};