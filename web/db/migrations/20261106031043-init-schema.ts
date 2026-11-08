'use strict';

import { QueryInterface, DataTypes, Sequelize } from 'sequelize';

module.exports = {
  async up(queryInterface: QueryInterface, SequelizeDT: typeof DataTypes) {
    const sequelize = queryInterface.sequelize;
    const transaction = await sequelize.transaction();

    try {
      const dialect = sequelize.getDialect();
      const isPostgres = dialect === 'postgres';

      // ── Clean up old/existing tables (idempotent) ──
      await queryInterface.dropTable('IssueLabels', { transaction, cascade: true });
      await queryInterface.dropTable('Logs', { transaction, cascade: true });
      await queryInterface.dropTable('AgentTasks', { transaction, cascade: true });
      await queryInterface.dropTable('Comments', { transaction, cascade: true });
      await queryInterface.dropTable('IssueLabels', { transaction, cascade: true });
      await queryInterface.dropTable('Issues', { transaction, cascade: true });
      await queryInterface.dropTable('Columns', { transaction, cascade: true });
      await queryInterface.dropTable('Labels', { transaction, cascade: true });
      await queryInterface.dropTable('Projects', { transaction, cascade: true });
      await queryInterface.dropTable('Groups', { transaction, cascade: true });

      // ── Groups ──
      await queryInterface.createTable('Groups', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        ownerId: { type: SequelizeDT.INTEGER, allowNull: false },
        name: { type: SequelizeDT.STRING(255), allowNull: false },
        deleted: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Groups', {
        fields: ['ownerId', 'deleted'],
        type: 'unique',
        name: 'groups_ownerId_deleted_unique',
        transaction,
      });

      // ── Projects ──
      await queryInterface.createTable('Projects', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        groupId: { type: SequelizeDT.INTEGER, allowNull: false },
        name: { type: SequelizeDT.STRING(255), allowNull: false },
        description: { type: SequelizeDT.TEXT, allowNull: true },
        unicodeIcon: { type: SequelizeDT.STRING(16), allowNull: true },
        iconUrl: { type: SequelizeDT.STRING(2048), allowNull: true },
        gitUrl: { type: SequelizeDT.STRING(2048), allowNull: true },
        isGitHubRepo: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        gitHubProjectUrl: { type: SequelizeDT.STRING(2048), allowNull: true },
        gitHubBoardId: { type: SequelizeDT.STRING(255), allowNull: true },
        defaultBranch: { type: SequelizeDT.STRING(255), allowNull: true },
        archived: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        deleted: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Projects', {
        fields: ['groupId'],
        type: 'foreign key',
        name: 'projects_groupId_fk',
        references: { table: 'Groups', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Projects', {
        fields: ['groupId', 'name', 'deleted'],
        type: 'unique',
        name: 'projects_groupId_name_deleted_unique',
        transaction,
      });

      if (isPostgres) {
        await sequelize.query(
          `ALTER TABLE "Projects" ADD CONSTRAINT "projects_icon_exclusive" CHECK ("iconUrl" IS NULL OR "unicodeIcon" IS NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Projects" ADD CONSTRAINT "projects_archived_not_deleted" CHECK ("archived" = false OR "deleted" = false)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Projects" ADD CONSTRAINT "projects_github_requires_url" CHECK ("isGitHubRepo" = false OR "gitHubProjectUrl" IS NOT NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Projects" ADD CONSTRAINT "projects_github_requires_git" CHECK ("gitUrl" IS NOT NULL OR "isGitHubRepo" = false)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Projects" ADD CONSTRAINT "projects_description_length" CHECK ("description" IS NULL OR LENGTH("description") <= 10000)`,
          { transaction }
        );
      }

      // ── Labels ──
      await queryInterface.createTable('Labels', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        projectId: { type: SequelizeDT.INTEGER, allowNull: false },
        name: { type: SequelizeDT.STRING(255), allowNull: false },
        unicodeIcon: { type: SequelizeDT.STRING(16), allowNull: true },
        iconUrl: { type: SequelizeDT.STRING(2048), allowNull: true },
        color: { type: SequelizeDT.STRING(9), allowNull: false },
        position: { type: SequelizeDT.INTEGER, allowNull: false },
        deleted: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Labels', {
        fields: ['projectId'],
        type: 'foreign key',
        name: 'labels_projectId_fk',
        references: { table: 'Projects', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Labels', {
        fields: ['projectId', 'name', 'deleted'],
        type: 'unique',
        name: 'labels_projectId_name_deleted_unique',
        transaction,
      });

      await queryInterface.addConstraint('Labels', {
        fields: ['projectId', 'position', 'deleted'],
        type: 'unique',
        name: 'labels_projectId_position_deleted_unique',
        transaction,
      });

      if (isPostgres) {
        await sequelize.query(
          `ALTER TABLE "Labels" ADD CONSTRAINT "labels_icon_exclusive" CHECK ("iconUrl" IS NULL OR "unicodeIcon" IS NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Labels" ADD CONSTRAINT "labels_color_format" CHECK ("color" ~ '^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$')`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Labels" ADD CONSTRAINT "labels_position_bounds" CHECK ("position" >= 0 AND "position" < 1000000)`,
          { transaction }
        );
      }

      // ── Columns ──
      await queryInterface.createTable('Columns', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        projectId: { type: SequelizeDT.INTEGER, allowNull: false },
        name: { type: SequelizeDT.STRING(255), allowNull: false },
        color: { type: SequelizeDT.STRING(9), allowNull: true },
        position: { type: SequelizeDT.INTEGER, allowNull: false },
        specialType: { type: SequelizeDT.ENUM('inProgress', 'inReview', 'done', 'backlog'), allowNull: true },
        deleted: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Columns', {
        fields: ['projectId'],
        type: 'foreign key',
        name: 'columns_projectId_fk',
        references: { table: 'Projects', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Columns', {
        fields: ['projectId', 'name', 'deleted'],
        type: 'unique',
        name: 'columns_projectId_name_deleted_unique',
        transaction,
      });

      await queryInterface.addConstraint('Columns', {
        fields: ['projectId', 'position', 'deleted'],
        type: 'unique',
        name: 'columns_projectId_position_deleted_unique',
        transaction,
      });

      // Partial unique index for specialType (only one active special column per project)
      if (isPostgres) {
        await sequelize.query(
          `CREATE UNIQUE INDEX "columns_projectId_specialType_partial" ON "Columns" ("projectId", "specialType") WHERE "specialType" IS NOT NULL AND "deleted" = false`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Columns" ADD CONSTRAINT "columns_color_format" CHECK ("color" IS NULL OR "color" ~ '^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$')`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Columns" ADD CONSTRAINT "columns_position_bounds" CHECK ("position" >= 0 AND "position" < 1000000)`,
          { transaction }
        );
      } else {
        // SQLite fallback: add a regular index (partial index syntax differs)
        await queryInterface.addIndex('Columns', ['projectId', 'specialType'], {
          name: 'columns_projectId_specialType_idx',
          transaction,
        });
        // SQLite supports CHECK natively
        await sequelize.query(
          `CREATE TRIGGER IF NOT EXISTS "columns_specialType_one_per_project" BEFORE INSERT ON "Columns" BEGIN SELECT CASE WHEN NEW."specialType" IS NOT NULL AND (SELECT COUNT(*) FROM "Columns" WHERE "projectId" = NEW."projectId" AND "specialType" = NEW."specialType" AND "deleted" = 0) > 0 THEN RAISE(ABORT, 'Only one active special column per project') END; END;`,
          { transaction }
        );
        await sequelize.query(
          `CREATE TRIGGER IF NOT EXISTS "columns_specialType_one_per_project_upd" BEFORE UPDATE ON "Columns" BEGIN SELECT CASE WHEN NEW."specialType" IS NOT NULL AND NEW."specialType" != OLD."specialType" AND (SELECT COUNT(*) FROM "Columns" WHERE "projectId" = NEW."projectId" AND "specialType" = NEW."specialType" AND "deleted" = 0) > 0 THEN RAISE(ABORT, 'Only one active special column per project') END; END;`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Columns" ADD CONSTRAINT "columns_color_format" CHECK ("color" IS NULL OR "color" LIKE '#______' OR "color" LIKE '#________')`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Columns" ADD CONSTRAINT "columns_position_bounds" CHECK ("position" >= 0 AND "position" < 1000000)`,
          { transaction }
        );
      }

      // ── Issues ──
      await queryInterface.createTable('Issues', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        columnId: { type: SequelizeDT.INTEGER, allowNull: false },
        name: { type: SequelizeDT.STRING(255), allowNull: false },
        description: { type: SequelizeDT.TEXT, allowNull: true },
        position: { type: SequelizeDT.INTEGER, allowNull: false },
        locked: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        deleted: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Issues', {
        fields: ['columnId'],
        type: 'foreign key',
        name: 'issues_columnId_fk',
        references: { table: 'Columns', field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Issues', {
        fields: ['columnId', 'position', 'deleted'],
        type: 'unique',
        name: 'issues_columnId_position_deleted_unique',
        transaction,
      });

      if (isPostgres) {
        await sequelize.query(
          `ALTER TABLE "Issues" ADD CONSTRAINT "issues_position_bounds" CHECK ("position" >= 0 AND "position" < 1000000)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Issues" ADD CONSTRAINT "issues_description_length" CHECK ("description" IS NULL OR LENGTH("description") <= 10000)`,
          { transaction }
        );
      } else {
        await sequelize.query(
          `ALTER TABLE "Issues" ADD CONSTRAINT "issues_position_bounds" CHECK ("position" >= 0 AND "position" < 1000000)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Issues" ADD CONSTRAINT "issues_description_length" CHECK ("description" IS NULL OR LENGTH("description") <= 10000)`,
          { transaction }
        );
      }

      // ── IssueLabels (join table) ──
      await queryInterface.createTable('IssueLabels', {
        issueId: { type: SequelizeDT.INTEGER, allowNull: false, primaryKey: true },
        labelId: { type: SequelizeDT.INTEGER, allowNull: false, primaryKey: true },
      }, { transaction });

      await queryInterface.addConstraint('IssueLabels', {
        fields: ['issueId'],
        type: 'foreign key',
        name: 'issueLabels_issueId_fk',
        references: { table: 'Issues', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('IssueLabels', {
        fields: ['labelId'],
        type: 'foreign key',
        name: 'issueLabels_labelId_fk',
        references: { table: 'Labels', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('IssueLabels', {
        fields: ['issueId', 'labelId'],
        type: 'unique',
        name: 'issueLabels_issueId_labelId_unique',
        transaction,
      });

      // ── Comments ──
      await queryInterface.createTable('Comments', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        issueId: { type: SequelizeDT.INTEGER, allowNull: false },
        userId: { type: SequelizeDT.INTEGER, allowNull: false },
        content: { type: SequelizeDT.TEXT, allowNull: false },
        deleted: { type: SequelizeDT.BOOLEAN, allowNull: false, defaultValue: false },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Comments', {
        fields: ['issueId'],
        type: 'foreign key',
        name: 'comments_issueId_fk',
        references: { table: 'Issues', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      if (isPostgres) {
        await sequelize.query(
          `ALTER TABLE "Comments" ADD CONSTRAINT "comments_content_length" CHECK (LENGTH("content") <= 10000)`,
          { transaction }
        );
      } else {
        await sequelize.query(
          `ALTER TABLE "Comments" ADD CONSTRAINT "comments_content_length" CHECK (LENGTH("content") <= 10000)`,
          { transaction }
        );
      }

      // ── AgentTasks ──
      await queryInterface.createTable('AgentTasks', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        issueId: { type: SequelizeDT.INTEGER, allowNull: false },
        runnerId: { type: SequelizeDT.STRING(255), allowNull: true },
        triggeredBy: { type: SequelizeDT.ENUM('user', 'automation', 'githubAction', 'githubCommand'), allowNull: false },
        status: { type: SequelizeDT.ENUM('scheduled', 'running', 'waiting', 'completed', 'cancelled', 'paused'), allowNull: false },
        statusDetail: { type: SequelizeDT.ENUM('question', 'stuck', 'helpRequested', 'failed', 'runnerError', 'webError'), allowNull: true },
        statusMessage: { type: SequelizeDT.STRING(1000), allowNull: true },
        data: { type: SequelizeDT.JSON, allowNull: true },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
        updatedAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('AgentTasks', {
        fields: ['issueId'],
        type: 'foreign key',
        name: 'agentTasks_issueId_fk',
        references: { table: 'Issues', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      if (isPostgres) {
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_runner_required" CHECK ("runnerId" IS NOT NULL OR "status" <> 'running')`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_statusDetail_states" CHECK ("statusDetail" IS NULL OR "status" IN ('waiting', 'paused', 'completed', 'cancelled'))`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_noDetail_completed" CHECK ("status" <> 'completed' OR "statusDetail" IS NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_noDetail_running" CHECK ("status" <> 'running' OR "statusDetail" IS NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_data_size" CHECK ("data" IS NULL OR LENGTH("data"::text) <= 100000)`,
          { transaction }
        );
      } else {
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_runner_required" CHECK ("runnerId" IS NOT NULL OR "status" <> 'running')`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_statusDetail_states" CHECK ("statusDetail" IS NULL OR "status" IN ('waiting', 'paused', 'completed', 'cancelled'))`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_noDetail_completed" CHECK ("status" <> 'completed' OR "statusDetail" IS NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "AgentTasks" ADD CONSTRAINT "agentTasks_noDetail_running" CHECK ("status" <> 'running' OR "statusDetail" IS NULL)`,
          { transaction }
        );
        // SQLite JSON size check via trigger (no LENGTH(json)::text equivalent)
        await sequelize.query(
          `CREATE TRIGGER IF NOT EXISTS "agentTasks_data_size" BEFORE INSERT ON "AgentTasks" BEGIN SELECT CASE WHEN NEW."data" IS NOT NULL AND LENGTH(CAST(NEW."data" AS TEXT)) > 100000 THEN RAISE(ABORT, 'Agent task data too large') END; END;`,
          { transaction }
        );
        await sequelize.query(
          `CREATE TRIGGER IF NOT EXISTS "agentTasks_data_size_upd" BEFORE UPDATE ON "AgentTasks" BEGIN SELECT CASE WHEN NEW."data" IS NOT NULL AND LENGTH(CAST(NEW."data" AS TEXT)) > 100000 THEN RAISE(ABORT, 'Agent task data too large') END; END;`,
          { transaction }
        );
      }

      // ── Logs ──
      await queryInterface.createTable('Logs', {
        id: { type: SequelizeDT.INTEGER, autoIncrement: true, primaryKey: true },
        projectId: { type: SequelizeDT.INTEGER, allowNull: false },
        actorId: { type: SequelizeDT.INTEGER, allowNull: true },
        action: {
          type: SequelizeDT.ENUM(
            'projectCreated', 'projectRenamed', 'projectDescriptionChanged', 'projectArchived',
            'projectUnarchived', 'projectDeleted', 'columnCreated', 'columnRenamed', 'columnMoved',
            'columnDeleted', 'columnColorChanged', 'columnSpecialTypeChanged', 'labelCreated',
            'labelRenamed', 'labelDeleted', 'labelColorChanged', 'labelIconChanged', 'issueCreated',
            'issueMoved', 'issueRenamed', 'issueDescriptionChanged', 'issueLocked', 'issueUnlocked',
            'issueDeleted', 'commentCreated', 'commentEdited', 'commentDeleted', 'issueLabelAdded',
            'issueLabelRemoved', 'agentTaskDelegated', 'agentTaskStatusChanged', 'agentTaskCompleted'
          ),
          allowNull: false,
        },
        field: { type: SequelizeDT.STRING(255), allowNull: true },
        oldValue: { type: SequelizeDT.TEXT, allowNull: true },
        newValue: { type: SequelizeDT.TEXT, allowNull: true },
        columnId: { type: SequelizeDT.INTEGER, allowNull: true },
        labelId: { type: SequelizeDT.INTEGER, allowNull: true },
        issueId: { type: SequelizeDT.INTEGER, allowNull: true },
        commentId: { type: SequelizeDT.INTEGER, allowNull: true },
        agentTaskId: { type: SequelizeDT.INTEGER, allowNull: true },
        createdAt: { type: SequelizeDT.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint('Logs', {
        fields: ['projectId'],
        type: 'foreign key',
        name: 'logs_projectId_fk',
        references: { table: 'Projects', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Logs', {
        fields: ['columnId'],
        type: 'foreign key',
        name: 'logs_columnId_fk',
        references: { table: 'Columns', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Logs', {
        fields: ['labelId'],
        type: 'foreign key',
        name: 'logs_labelId_fk',
        references: { table: 'Labels', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Logs', {
        fields: ['issueId'],
        type: 'foreign key',
        name: 'logs_issueId_fk',
        references: { table: 'Issues', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Logs', {
        fields: ['commentId'],
        type: 'foreign key',
        name: 'logs_commentId_fk',
        references: { table: 'Comments', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addConstraint('Logs', {
        fields: ['agentTaskId'],
        type: 'foreign key',
        name: 'logs_agentTaskId_fk',
        references: { table: 'AgentTasks', field: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        transaction,
      });

      await queryInterface.addIndex('Logs', ['projectId'], { transaction });
      await queryInterface.addIndex('Logs', ['issueId'], { transaction });
      await queryInterface.addIndex('Logs', ['columnId'], { transaction });
      await queryInterface.addIndex('Logs', ['labelId'], { transaction });
      await queryInterface.addIndex('Logs', ['commentId'], { transaction });
      await queryInterface.addIndex('Logs', ['agentTaskId'], { transaction });
      await queryInterface.addIndex('Logs', ['actorId'], { transaction });
      await queryInterface.addIndex('Logs', ['createdAt'], { transaction });

      if (isPostgres) {
        await sequelize.query(
          `ALTER TABLE "Logs" ADD CONSTRAINT "logs_at_least_one_value" CHECK ("oldValue" IS NOT NULL OR "newValue" IS NOT NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Logs" ADD CONSTRAINT "logs_oldValue_length" CHECK ("oldValue" IS NULL OR LENGTH("oldValue") <= 10000)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Logs" ADD CONSTRAINT "logs_newValue_length" CHECK ("newValue" IS NULL OR LENGTH("newValue") <= 10000)`,
          { transaction }
        );
      } else {
        await sequelize.query(
          `ALTER TABLE "Logs" ADD CONSTRAINT "logs_at_least_one_value" CHECK ("oldValue" IS NOT NULL OR "newValue" IS NOT NULL)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Logs" ADD CONSTRAINT "logs_oldValue_length" CHECK ("oldValue" IS NULL OR LENGTH("oldValue") <= 10000)`,
          { transaction }
        );
        await sequelize.query(
          `ALTER TABLE "Logs" ADD CONSTRAINT "logs_newValue_length" CHECK ("newValue" IS NULL OR LENGTH("newValue") <= 10000)`,
          { transaction }
        );
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface: QueryInterface, _SequelizeDT: typeof DataTypes) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable('Logs', { transaction, cascade: true });
      await queryInterface.dropTable('AgentTasks', { transaction, cascade: true });
      await queryInterface.dropTable('Comments', { transaction, cascade: true });
      await queryInterface.dropTable('IssueLabels', { transaction, cascade: true });
      await queryInterface.dropTable('Issues', { transaction, cascade: true });
      await queryInterface.dropTable('Columns', { transaction, cascade: true });
      await queryInterface.dropTable('Labels', { transaction, cascade: true });
      await queryInterface.dropTable('Projects', { transaction, cascade: true });
      await queryInterface.dropTable('Groups', { transaction, cascade: true });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
