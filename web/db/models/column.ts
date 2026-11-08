'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export type SpecialType = 'inProgress' | 'inReview' | 'done' | 'backlog';

export interface ColumnAttributes {
    id: number;
    projectId: number;
    name: string;
    color?: string | null;
    position: number;
    specialType?: SpecialType | null;
    deleted: boolean;
}

export interface ColumnCreationAttributes
    extends Omit<ColumnAttributes, 'id'> { }

const columnFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Column
        extends Model<ColumnAttributes, ColumnCreationAttributes>
        implements ColumnAttributes {
        public id!: number;
        public projectId!: number;
        public name!: string;
        public color!: string | null;
        public position!: number;
        public specialType!: SpecialType | null;
        public deleted!: boolean;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            Column.belongsTo(models.Project, { as: 'project', foreignKey: 'projectId' });
            Column.hasMany(models.Issue, { as: 'issues', foreignKey: 'columnId' });
        }
    }

    Column.init(
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
            color: {
                type: DT.STRING(9),
                allowNull: true,
            },
            position: {
                type: DT.INTEGER,
                allowNull: false,
            },
            specialType: {
                type: DataTypes.ENUM('inProgress', 'inReview', 'done', 'backlog'),
                allowNull: true,
            },
            deleted: {
                type: DT.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
        },
        {
            sequelize,
            modelName: 'Column',
            tableName: 'Columns',
            indexes: [
                { unique: true, fields: ['projectId', 'name', 'deleted'], name: 'columns_projectId_name_deleted_unique' },
                { unique: true, fields: ['projectId', 'position', 'deleted'], name: 'columns_projectId_position_deleted_unique' },
            ],
            validate: {
                colorFormat() {
                    const c = this as unknown as Column;
                    if (c.color && !/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(c.color)) {
                        throw new Error('Column color must be a valid hex color (e.g. #RRGGBB or #AARRGGBB).');
                    }
                },
                positionBounds() {
                    const c = this as unknown as Column;
                    if (c.position < 0 || c.position >= 1000000) {
                        throw new Error('Column position must be between 0 and 999999.');
                    }
                },
            },
        }
    );

    return Column;
};

export default columnFactory;
