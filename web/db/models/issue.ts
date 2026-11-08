'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export interface IssueAttributes {
    id: number;
    columnId: number;
    name: string;
    description?: string | null;
    position: number;
    locked: boolean;
    deleted: boolean;
}

export interface IssueCreationAttributes
    extends Omit<IssueAttributes, 'id'> { }

const issueFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Issue
        extends Model<IssueAttributes, IssueCreationAttributes>
        implements IssueAttributes {
        public id!: number;
        public columnId!: number;
        public name!: string;
        public description!: string | null;
        public position!: number;
        public locked!: boolean;
        public deleted!: boolean;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            Issue.belongsTo(models.Column, { as: 'column', foreignKey: 'columnId' });
            Issue.belongsToMany(models.Label, {
                as: 'labels',
                through: 'IssueLabels',
                foreignKey: 'issueId',
                otherKey: 'labelId',
            });
            Issue.hasMany(models.Comment, { as: 'comments', foreignKey: 'issueId' });
            Issue.hasMany(models.AgentTask, { as: 'agentTasks', foreignKey: 'issueId' });
            Issue.hasMany(models.Log, { as: 'logs', foreignKey: 'issueId' });
        }
    }

    Issue.init(
        {
            id: {
                type: DT.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            columnId: {
                type: DT.INTEGER,
                allowNull: false,
            },
            name: {
                type: DT.STRING(255),
                allowNull: false,
            },
            description: {
                type: DT.TEXT,
                allowNull: true,
            },
            position: {
                type: DT.INTEGER,
                allowNull: false,
            },
            locked: {
                type: DT.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            deleted: {
                type: DT.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
        },
        {
            sequelize,
            modelName: 'Issue',
            tableName: 'Issues',
            indexes: [
                { unique: true, fields: ['columnId', 'position', 'deleted'], name: 'issues_columnId_position_deleted_unique' },
            ],
            validate: {
                positionBounds() {
                    const i = this as unknown as Issue;
                    if (i.position < 0 || i.position >= 1000000) {
                        throw new Error('Issue position must be between 0 and 999999.');
                    }
                },
                descriptionLength() {
                    const i = this as unknown as Issue;
                    if (i.description && i.description.length > 10000) {
                        throw new Error('Issue description must be at most 10000 characters.');
                    }
                },
            },
        }
    );

    return Issue;
};

export default issueFactory;
