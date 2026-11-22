'use strict';

import { QueryInterface } from 'sequelize';

/**
 * Ordering write path for drag-and-drop: `app.move_issue` and
 * `app.reorder_columns`.
 *
 * Drag-and-drop is a pure ordering change, so it is an UPDATE-only write
 * (matches the `update_own_rows` policies added in `*-update-rls-policies`).
 * The unique indexes `issues_columnId_position_deleted_unique`
 * (`columnId, position, deleted`) and `columns_projectId_position_deleted_unique`
 * make naive in-place updates collide with themselves, so both functions use
 * the same three-step trick:
 *
 *   1. park   — shift every affected row out of the way (`position + 500000`)
 *   2. assign — write the final `0..n-1` order
 *   3.       — the parked rows are exactly the assigned rows, nothing leaks
 *
 * Positions are always rewritten as dense `0..n-1`, so a parked row can never
 * exceed `999999` (the `*_position_bounds` checks) as long as every writer
 * goes through these functions.
 *
 * Both functions are `SECURITY INVOKER`: RLS (`update_own_rows`) applies on
 * top of the explicit ownership check, so a foreign project id cannot be
 * reordered even if the caller guesses ids. All statements are fully
 * schema-qualified because PostgREST calls with `search_path` unset.
 *
 * Errors raised (matched by name in `app/_lib/kanbanRepo.ts`):
 *   'not found'    — unknown/foreign project, issue or column
 *   'issue is locked' — the issue has `locked = true`
 *   'bad order'    — `p_column_ids` is not a permutation of the project's
 *                    live columns
 *
 * Idempotent: `CREATE OR REPLACE`. Reversible: `down()` drops both.
 */

const upStatements: string[] = [
  `CREATE OR REPLACE FUNCTION app.move_issue(p_issue_id integer, p_to_column_id integer, p_index integer)
   RETURNS void
   LANGUAGE plpgsql
   SECURITY INVOKER
   SET search_path = ''
   AS $fn$
   DECLARE
     v_issue_row    app."Issues"%ROWTYPE;
     v_project_id   integer;
     v_target_ids   integer[];
     v_source_ids   integer[];
     v_index        integer;
     v_i            integer;
   BEGIN
     SELECT * INTO v_issue_row
       FROM app."Issues"
      WHERE id = p_issue_id AND deleted = false;

     IF NOT FOUND THEN
       RAISE EXCEPTION 'not found';
     END IF;

     IF v_issue_row.locked THEN
       RAISE EXCEPTION 'issue is locked';
     END IF;

     SELECT c."projectId" INTO v_project_id
       FROM app."Columns" c
      WHERE c.id = v_issue_row."columnId" AND c.deleted = false;

     IF v_project_id IS NULL OR NOT app.owns_project(v_project_id) THEN
       RAISE EXCEPTION 'not found';
     END IF;

     IF NOT EXISTS (
       SELECT 1 FROM app."Columns" c
        WHERE c.id = p_to_column_id AND c."projectId" = v_project_id AND c.deleted = false
     ) THEN
       RAISE EXCEPTION 'not found';
     END IF;

     -- Final order of the target column: current rows minus the moved issue,
     -- with the moved issue spliced in at the clamped index.
     SELECT array_agg(id ORDER BY position, id) INTO v_target_ids
       FROM app."Issues"
      WHERE "columnId" = p_to_column_id AND deleted = false AND id <> p_issue_id;

     v_target_ids := COALESCE(v_target_ids, ARRAY[]::integer[]);
     v_index := GREATEST(0, LEAST(COALESCE(p_index, 0), COALESCE(array_length(v_target_ids, 1), 0)));

     v_target_ids := (v_target_ids)[1:v_index] || ARRAY[p_issue_id] || (v_target_ids)[v_index + 1:COALESCE(array_length(v_target_ids, 1), 0)];

     -- Final order of the source column (only when the issue moves across).
     IF v_issue_row."columnId" <> p_to_column_id THEN
       SELECT array_agg(id ORDER BY position, id) INTO v_source_ids
         FROM app."Issues"
        WHERE "columnId" = v_issue_row."columnId" AND deleted = false AND id <> p_issue_id;
       v_source_ids := COALESCE(v_source_ids, ARRAY[]::integer[]);
     ELSE
       v_source_ids := NULL;
     END IF;

     -- 1. park: move every affected row out of the 0..n-1 range first, so the
     --    unique (columnId, position, deleted) index never fires mid-update.
     UPDATE app."Issues"
        SET position = position + 500000
      WHERE deleted = false
        AND "columnId" IN (p_to_column_id, v_issue_row."columnId");

     -- 2. assign: dense 0..n-1 for the target column (moved issue included).
     FOR v_i IN 1..COALESCE(array_length(v_target_ids, 1), 0) LOOP
       UPDATE app."Issues"
          SET "columnId" = p_to_column_id, position = v_i - 1
        WHERE id = v_target_ids[v_i] AND deleted = false;
     END LOOP;

     IF v_source_ids IS NOT NULL THEN
       FOR v_i IN 1..COALESCE(array_length(v_source_ids, 1), 0) LOOP
         UPDATE app."Issues"
            SET "columnId" = v_issue_row."columnId", position = v_i - 1
          WHERE id = v_source_ids[v_i] AND deleted = false;
       END LOOP;
     END IF;
   END;
   $fn$`,
  `CREATE OR REPLACE FUNCTION app.reorder_columns(p_project_id integer, p_column_ids integer[])
   RETURNS void
   LANGUAGE plpgsql
   SECURITY INVOKER
   SET search_path = ''
   AS $fn$
   DECLARE
     v_live_count integer;
     v_i          integer;
   BEGIN
     IF p_project_id IS NULL OR NOT app.owns_project(p_project_id) THEN
       RAISE EXCEPTION 'not found';
     END IF;

     SELECT count(*) INTO v_live_count
       FROM app."Columns"
      WHERE "projectId" = p_project_id AND deleted = false;

     p_column_ids := COALESCE(p_column_ids, ARRAY[]::integer[]);

     -- Permutation check: same size as the live set, no duplicates, and every
     -- entry is a live column of this project.
     IF cardinality(p_column_ids) IS DISTINCT FROM v_live_count THEN
       RAISE EXCEPTION 'bad order';
     END IF;

     IF (SELECT count(DISTINCT u) FROM unnest(p_column_ids) AS u) IS DISTINCT FROM cardinality(p_column_ids) THEN
       RAISE EXCEPTION 'bad order';
     END IF;

     IF EXISTS (
       SELECT 1 FROM unnest(p_column_ids) AS u
        WHERE NOT EXISTS (
          SELECT 1 FROM app."Columns" c
           WHERE c.id = u AND c."projectId" = p_project_id AND c.deleted = false
        )
     ) THEN
       RAISE EXCEPTION 'bad order';
     END IF;

     -- 1. park, then 2. assign the array order as dense 0..n-1.
     UPDATE app."Columns"
        SET position = position + 500000
      WHERE "projectId" = p_project_id AND deleted = false;

     FOR v_i IN 1..COALESCE(array_length(p_column_ids, 1), 0) LOOP
       UPDATE app."Columns"
          SET position = v_i - 1
        WHERE id = p_column_ids[v_i] AND "projectId" = p_project_id AND deleted = false;
     END LOOP;
   END;
   $fn$`,
  // EXECUTE is PUBLIC by default; anon/authenticated/service_role may call.
  // (No ALTER DEFAULT PRIVILEGES needed — app.* functions are created by the
  // migration role and PostgREST roles hold EXECUTE through PUBLIC.)
  'COMMENT ON FUNCTION app.move_issue(integer, integer, integer) IS $k$kanban drag-and-drop: move one issue to 0-based index in a column (SECURITY INVOKER, RLS-backed)$k$',
  'COMMENT ON FUNCTION app.reorder_columns(integer, integer[]) IS $k$kanban drag-and-drop: apply a full column order for one project (SECURITY INVOKER, RLS-backed)$k$',
  // PostgREST caches its schema; without this the fresh functions 500 with
  // "Could not find the function app.move_issue(...) in the schema cache"
  // until something else triggers a reload.
  "NOTIFY pgrst, 'reload schema'",
];

const downStatements: string[] = [
  'DROP FUNCTION IF EXISTS app.move_issue(integer, integer, integer)',
  'DROP FUNCTION IF EXISTS app.reorder_columns(integer, integer[])',
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
