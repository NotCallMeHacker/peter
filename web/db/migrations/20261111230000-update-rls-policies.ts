'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Write policies: the board may reorder issues and columns.
 *
 * The first RLS pass (`20261108000002-row-level-security`) was read-only on
 * purpose. Drag-and-drop needs exactly one kind of write: moving an issue
 * between columns / within a column, and reordering the columns themselves —
 * i.e. UPDATE of `position` (and `columnId`) on `app."Issues"` and
 * `app."Columns"`. So this adds an `update_own_rows` UPDATE policy on just
 * those two tables, owner-scoped like the read policy it sits next to:
 *
 *   Columns  app.owns_project("projectId")
 *   Issues   its column's project is owned (correlated EXISTS)
 *
 * `USING` and `WITH CHECK` are the same expression: the caller may only touch
 * rows they own, and only produce rows they own — so an issue cannot be moved
 * into a column of somebody else's project (the target column is checked
 * through the post-update `columnId`).
 *
 * INSERT and DELETE stay denied: anon/authenticated hold no such grants and
 * no such policies, so creating or hard-deleting rows is impossible through
 * PostgREST. The ordering helpers (`*-reorder-functions`) run SECURITY
 * INVOKER, so these policies apply to them too.
 *
 * Idempotent: DROP POLICY IF EXISTS + CREATE POLICY, safe to re-run.
 */

const COLUMNS_USING = 'app.owns_project("projectId")';

const ISSUES_USING =
  'EXISTS (SELECT 1 FROM app."Columns" c WHERE c.id = "Issues"."columnId" AND app.owns_project(c."projectId"))';

const upStatements: string[] = [
  'DROP POLICY IF EXISTS "update_own_rows" ON app."Columns"',
  'CREATE POLICY "update_own_rows" ON app."Columns" FOR UPDATE USING ('
    + COLUMNS_USING
    + ') WITH CHECK ('
    + COLUMNS_USING
    + ')',
  'DROP POLICY IF EXISTS "update_own_rows" ON app."Issues"',
  'CREATE POLICY "update_own_rows" ON app."Issues" FOR UPDATE USING ('
    + ISSUES_USING
    + ') WITH CHECK ('
    + ISSUES_USING
    + ')',
];

const downStatements: string[] = [
  'DROP POLICY IF EXISTS "update_own_rows" ON app."Columns"',
  'DROP POLICY IF EXISTS "update_own_rows" ON app."Issues"',
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
