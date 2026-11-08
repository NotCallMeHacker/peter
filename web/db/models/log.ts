'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export type LogAction =
    | 'projectCreated'
    | 'projectRenamed'
    | 'projectDescriptionChanged'
    | 'projectArchived'
    | 'projectUnarchived'
    | 'projectDeleted'
    | 'columnCreated'
    | 'columnRenamed'
    | 'columnMoved'
    | 'columnDeleted'
    | 'columnColorChanged'
    | 'columnSpecialTypeChanged'
    | 'labelCreated'
    | 'labelRenamed'
    | 'labelDeleted'
    | 'labelColorChanged'
    | 'labelIconChanged'
    | 'issueCreated'
    | 'issueMoved'
    | 'issueRenamed'
    | 'issueDescriptionChanged'
    | 'issueLocked'
    | 'issueUnlocked'
    | 'issueDeleted'
    | 'commentCreated'
    | 'commentEdited'
    | 'commentDeleted'
    | 'issueLabelAdded'
    | 'issueLabelRemoved'
    | 'agentTaskDelegated'
    | 'agentTaskStatusChanged'
    | 'agentTaskCompleted';

export interface LogAttributes {
    id: number;
    projectId: number;
    actorId?: number | null;
    action: LogAction;
    field?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    columnId?: number | null;
    labelId?: number | null;
    issueId?: number | null;
    commentId?: number | null;
    agentTaskId?: number | null;
}

export interface LogCreationAttributes
    extends Omit<LogAttributes, 'id'> { }

const logFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Log
        extends Model<LogAttributes, LogCreationAttributes>
        implements LogAttributes {
        public id!: number;
        public projectId!: number;
        public actorId!: number | null;
        public action!: LogAction;
        public field!: string | null;
        public oldValue!: string | null;
        public newValue!: string | null;
        public columnId!: number | null;
        public labelId!: number | null;
        public issueId!: number | null;
        public commentId!: number | null;
        public agentTaskId!: number | null;

        public readonly createdAt!: Date;

        static associate(models: Record<string, any>) {
            Log.belongsTo(models.Project, { as: 'project', foreignKey: 'projectId' });
            Log.belongsTo(models.Column, { as: 'column', foreignKey: 'columnId' });
            Log.belongsTo(models.Label, { as: 'label', foreignKey: 'labelId' });
            Log.belongsTo(models.Issue, { as: 'issue', foreignKey: 'issueId' });
            Log.belongsTo(models.Comment, { as: 'comment', foreignKey: 'commentId' });
            Log.belongsTo(models.AgentTask, { as: 'agentTask', foreignKey: 'agentTaskId' });
        }
    }

    Log.init(
        {
            id: {
                type: DT.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            projectId: {
                type: DT.INTEGER,
                allowNull: false,
            },
            actorId: {
                type: DT.INTEGER,
                allowNull: true,
            },
            action: {
                type: DT.ENUM(
                    'projectCreated',
                    'projectRenamed',
                    'projectDescriptionChanged',
                    'projectArchived',
                    'projectUnarchived',
                    'projectDeleted',
                    'columnCreated',
                    'columnRenamed',
                    'columnMoved',
                    'columnDeleted',
                    'columnColorChanged',
                    'columnSpecialTypeChanged',
                    'labelCreated',
                    'labelRenamed',
                    'labelDeleted',
                    'labelColorChanged',
                    'labelIconChanged',
                    'issueCreated',
                    'issueMoved',
                    'issueRenamed',
                    'issueDescriptionChanged',
                    'issueLocked',
                    'issueUnlocked',
                    'issueDeleted',
                    'commentCreated',
                    'commentEdited',
                    'commentDeleted',
                    'issueLabelAdded',
                    'issueLabelRemoved',
                    'agentTaskDelegated',
                    'agentTaskStatusChanged',
                    'agentTaskCompleted'
                ),
                allowNull: false,
            },
            field: {
                type: DT.STRING(255),
                allowNull: true,
            },
            oldValue: {
                type: DT.TEXT,
                allowNull: true,
            },
            newValue: {
                type: DT.TEXT,
                allowNull: true,
            },
            columnId: {
                type: DT.INTEGER,
                allowNull: true,
            },
            labelId: {
                type: DT.INTEGER,
                allowNull: true,
            },
            issueId: {
                type: DT.INTEGER,
                allowNull: true,
            },
            commentId: {
                type: DT.INTEGER,
                allowNull: true,
            },
            agentTaskId: {
                type: DT.INTEGER,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: 'Log',
            tableName: 'Logs',
            timestamps: true,
            updatedAt: false,
            validate: {
                atLeastOneValue() {
                    const l = this as unknown as Log;
                    if (l.oldValue === null && l.newValue === null) {
                        throw new Error('At least one of oldValue or newValue must be recorded.');
                    }
                },
                oldValueLength() {
                    const l = this as unknown as Log;
                    if (l.oldValue && l.oldValue.length > 10000) {
                        throw new Error('oldValue must be at most 10000 characters.');
                    }
                },
                newValueLength() {
                    const l = this as unknown as Log;
                    if (l.newValue && l.newValue.length > 10000) {
                        throw new Error('newValue must be at most 10000 characters.');
                    }
                },
            },
        }
    );

    return Log;
};

export default logFactory;
