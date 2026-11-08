'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export type TriggeredBy = 'user' | 'automation' | 'githubAction' | 'githubCommand';
export type TaskStatus = 'scheduled' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'paused';
export type StatusDetail = 'question' | 'stuck' | 'helpRequested' | 'failed' | 'runnerError' | 'webError';

export interface AgentTaskAttributes {
    id: number;
    issueId: number;
    runnerId?: string | null;
    triggeredBy: TriggeredBy;
    status: TaskStatus;
    statusDetail?: StatusDetail | null;
    statusMessage?: string | null;
    data?: any;
}

export interface AgentTaskCreationAttributes
    extends Omit<AgentTaskAttributes, 'id'> { }

const agentTaskFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class AgentTask
        extends Model<AgentTaskAttributes, AgentTaskCreationAttributes>
        implements AgentTaskAttributes {
        public id!: number;
        public issueId!: number;
        public runnerId!: string | null;
        public triggeredBy!: TriggeredBy;
        public status!: TaskStatus;
        public statusDetail!: StatusDetail | null;
        public statusMessage!: string | null;
        public data!: any;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            AgentTask.belongsTo(models.Issue, { as: 'issue', foreignKey: 'issueId' });
        }
    }

    AgentTask.init(
        {
            id: {
                type: DT.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            issueId: {
                type: DT.INTEGER,
                allowNull: false,
            },
            runnerId: {
                type: DT.STRING(255),
                allowNull: true,
            },
            triggeredBy: {
                type: DT.ENUM('user', 'automation', 'githubAction', 'githubCommand'),
                allowNull: false,
            },
            status: {
                type: DT.ENUM('scheduled', 'running', 'waiting', 'completed', 'cancelled', 'paused'),
                allowNull: false,
            },
            statusDetail: {
                type: DT.ENUM('question', 'stuck', 'helpRequested', 'failed', 'runnerError', 'webError'),
                allowNull: true,
            },
            statusMessage: {
                type: DT.STRING(1000),
                allowNull: true,
            },
            data: {
                type: DT.JSON,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: 'AgentTask',
            tableName: 'AgentTasks',
            validate: {
                runnerRequiredWhenRunning() {
                    const t = this as unknown as AgentTask;
                    if (t.status === 'running' && !t.runnerId) {
                        throw new Error('runnerId must be set when status is running.');
                    }
                },
                statusDetailOnlyForCertainStates() {
                    const t = this as unknown as AgentTask;
                    if (t.statusDetail && !['waiting', 'paused', 'completed', 'cancelled'].includes(t.status)) {
                        throw new Error('statusDetail is only allowed for waiting, paused, completed, or cancelled statuses.');
                    }
                },
                noDetailWhenCompleted() {
                    const t = this as unknown as AgentTask;
                    if (t.status === 'completed' && t.statusDetail) {
                        throw new Error('Completed tasks cannot have a statusDetail.');
                    }
                },
                noDetailWhenRunning() {
                    const t = this as unknown as AgentTask;
                    if (t.status === 'running' && t.statusDetail) {
                        throw new Error('Running tasks cannot have a statusDetail.');
                    }
                },
                dataSize() {
                    const t = this as unknown as AgentTask;
                    if (t.data && JSON.stringify(t.data).length > 100000) {
                        throw new Error('Agent task data JSON must be at most 100000 characters.');
                    }
                },
            },
        }
    );

    return AgentTask;
};

export default agentTaskFactory;
