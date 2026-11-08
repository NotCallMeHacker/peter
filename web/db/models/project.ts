'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export interface ProjectAttributes {
    id: number;
    groupId: number;
    name: string;
    description?: string | null;
    unicodeIcon?: string | null;
    iconUrl?: string | null;
    gitUrl?: string | null;
    isGitHubRepo: boolean;
    gitHubProjectUrl?: string | null;
    gitHubBoardId?: string | null;
    defaultBranch?: string | null;
    archived: boolean;
    deleted: boolean;
}

export interface ProjectCreationAttributes
    extends Omit<ProjectAttributes, 'id'> { }

const projectFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Project
        extends Model<ProjectAttributes, ProjectCreationAttributes>
        implements ProjectAttributes {
        public id!: number;
        public groupId!: number;
        public name!: string;
        public description!: string | null;
        public unicodeIcon!: string | null;
        public iconUrl!: string | null;
        public gitUrl!: string | null;
        public isGitHubRepo!: boolean;
        public gitHubProjectUrl!: string | null;
        public gitHubBoardId!: string | null;
        public defaultBranch!: string | null;
        public archived!: boolean;
        public deleted!: boolean;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            Project.belongsTo(models.Group, { as: 'group', foreignKey: 'groupId' });
            Project.hasMany(models.Label, { as: 'labels', foreignKey: 'projectId' });
            Project.hasMany(models.Column, { as: 'columns', foreignKey: 'projectId' });
            Project.hasMany(models.Log, { as: 'logs', foreignKey: 'projectId' });
        }
    }

    Project.init(
        {
            id: {
                type: DT.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            groupId: {
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
            unicodeIcon: {
                type: DT.STRING(16),
                allowNull: true,
            },
            iconUrl: {
                type: DT.STRING(2048),
                allowNull: true,
            },
            gitUrl: {
                type: DT.STRING(2048),
                allowNull: true,
            },
            isGitHubRepo: {
                type: DT.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            gitHubProjectUrl: {
                type: DT.STRING(2048),
                allowNull: true,
            },
            gitHubBoardId: {
                type: DT.STRING(255),
                allowNull: true,
            },
            defaultBranch: {
                type: DT.STRING(255),
                allowNull: true,
            },
            archived: {
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
            modelName: 'Project',
            tableName: 'Projects',
            indexes: [
                { unique: true, fields: ['groupId', 'name', 'deleted'], name: 'projects_groupId_name_deleted_unique' },
            ],
            validate: {
                iconExclusive() {
                    const p = this as unknown as Project;
                    const hasUnicode = p.unicodeIcon !== null && p.unicodeIcon !== undefined;
                    const hasUrl = p.iconUrl !== null && p.iconUrl !== undefined;
                    if (hasUnicode && hasUrl) {
                        throw new Error('Project must have only one of unicodeIcon or iconUrl.');
                    }
                },
                archivedNotDeleted() {
                    const p = this as unknown as Project;
                    if (p.archived && p.deleted) {
                        throw new Error('Archived projects cannot be deleted until unarchived.');
                    }
                },
                githubRequiresUrl() {
                    const p = this as unknown as Project;
                    if (p.isGitHubRepo && !p.gitHubProjectUrl) {
                        throw new Error('GitHub projects must have a project URL.');
                    }
                },
                githubRequiresGitUrl() {
                    const p = this as unknown as Project;
                    if (p.isGitHubRepo && !p.gitUrl) {
                        throw new Error('GitHub projects must have a git URL.');
                    }
                },
                descriptionLength() {
                    const p = this as unknown as Project;
                    if (p.description && p.description.length > 10000) {
                        throw new Error('Project description must be at most 10000 characters.');
                    }
                },
            },
        }
    );

    return Project;
};

export default projectFactory;
