'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export interface LabelAttributes {
    id: number;
    projectId: number;
    name: string;
    unicodeIcon?: string | null;
    iconUrl?: string | null;
    color: string;
    position: number;
    deleted: boolean;
}

export interface LabelCreationAttributes
    extends Omit<LabelAttributes, 'id'> { }

const labelFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Label
        extends Model<LabelAttributes, LabelCreationAttributes>
        implements LabelAttributes {
        public id!: number;
        public projectId!: number;
        public name!: string;
        public unicodeIcon!: string | null;
        public iconUrl!: string | null;
        public color!: string;
        public position!: number;
        public deleted!: boolean;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            Label.belongsTo(models.Project, { as: 'project', foreignKey: 'projectId' });
            Label.belongsToMany(models.Issue, {
                as: 'issues',
                through: 'IssueLabels',
                foreignKey: 'labelId',
                otherKey: 'issueId',
            });
        }
    }

    Label.init(
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
            name: {
                type: DT.STRING(255),
                allowNull: false,
            },
            unicodeIcon: {
                type: DT.STRING(16),
                allowNull: true,
            },
            iconUrl: {
                type: DT.STRING(2048),
                allowNull: true,
            },
            color: {
                type: DT.STRING(9),
                allowNull: false,
            },
            position: {
                type: DT.INTEGER,
                allowNull: false,
            },
            deleted: {
                type: DT.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
        },
        {
            sequelize,
            modelName: 'Label',
            tableName: 'Labels',
            indexes: [
                { unique: true, fields: ['projectId', 'name', 'deleted'], name: 'labels_projectId_name_deleted_unique' },
                { unique: true, fields: ['projectId', 'position', 'deleted'], name: 'labels_projectId_position_deleted_unique' },
            ],
            validate: {
                iconExclusive() {
                    const l = this as unknown as Label;
                    const hasUnicode = l.unicodeIcon !== null && l.unicodeIcon !== undefined;
                    const hasUrl = l.iconUrl !== null && l.iconUrl !== undefined;
                    if (hasUnicode && hasUrl) {
                        throw new Error('Label must have only one of unicodeIcon or iconUrl.');
                    }
                },
                colorFormat() {
                    const l = this as unknown as Label;
                    if (l.color && !/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(l.color)) {
                        throw new Error('Label color must be a valid hex color (e.g. #RRGGBB or #AARRGGBB).');
                    }
                },
                positionBounds() {
                    const l = this as unknown as Label;
                    if (l.position < 0 || l.position >= 1000000) {
                        throw new Error('Label position must be between 0 and 999999.');
                    }
                },
            },
        }
    );

    return Label;
};

export default labelFactory;
