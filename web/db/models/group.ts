'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export interface GroupAttributes {
    id: number;
    /** User id from auth.users.id (uuid) — Supabase Auth (GoTrue) owns accounts. */
    ownerId: string;
    name: string;
    deleted: boolean;
}

export interface GroupCreationAttributes
    extends Omit<GroupAttributes, 'id'> { }

const groupFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Group
        extends Model<GroupAttributes, GroupCreationAttributes>
        implements GroupAttributes {
        public id!: number;
        public ownerId!: string;
        public name!: string;
        public deleted!: boolean;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            Group.hasMany(models.Project, { as: 'projects', foreignKey: 'groupId' });
        }
    }

    Group.init(
        {
            id: {
                type: DT.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            ownerId: {
                type: DT.STRING(36),
                allowNull: false,
            },
            name: {
                type: DT.STRING(255),
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
            modelName: 'Group',
            tableName: 'Groups',
            indexes: [
                { unique: true, fields: ['ownerId', 'deleted'], name: 'groups_ownerId_deleted_unique' },
            ],
        }
    );

    return Group;
};

export default groupFactory;
