'use strict';
import { Model, DataTypes, Sequelize } from 'sequelize';

export interface CommentAttributes {
    id: number;
    issueId: number;
    userId: number;
    content: string;
    deleted: boolean;
}

export interface CommentCreationAttributes
    extends Omit<CommentAttributes, 'id'> { }

const commentFactory = (sequelize: Sequelize, DT: typeof DataTypes) => {
    class Comment
        extends Model<CommentAttributes, CommentCreationAttributes>
        implements CommentAttributes {
        public id!: number;
        public issueId!: number;
        public userId!: number;
        public content!: string;
        public deleted!: boolean;

        public readonly createdAt!: Date;
        public readonly updatedAt!: Date;

        static associate(models: Record<string, any>) {
            Comment.belongsTo(models.Issue, { as: 'issue', foreignKey: 'issueId' });
        }
    }

    Comment.init(
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
            userId: {
                type: DT.INTEGER,
                allowNull: false,
            },
            content: {
                type: DT.TEXT,
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
            modelName: 'Comment',
            tableName: 'Comments',
            validate: {
                contentLength() {
                    const c = this as unknown as Comment;
                    if (c.content && c.content.length > 10000) {
                        throw new Error('Comment content must be at most 10000 characters.');
                    }
                },
            },
        }
    );

    return Comment;
};

export default commentFactory;
