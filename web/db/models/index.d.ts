import { Sequelize } from 'sequelize';
import { Group, GroupAttributes, GroupCreationAttributes } from './group';
import { Project, ProjectAttributes, ProjectCreationAttributes } from './project';
import { Label, LabelAttributes, LabelCreationAttributes } from './label';
import { Column, ColumnAttributes, ColumnCreationAttributes } from './column';
import { Issue, IssueAttributes, IssueCreationAttributes } from './issue';
import { Comment, CommentAttributes, CommentCreationAttributes } from './comment';
import { AgentTask, AgentTaskAttributes, AgentTaskCreationAttributes } from './agentTask';
import { Log, LogAttributes, LogCreationAttributes } from './log';

export interface Database {
    Group: typeof Group;
    Project: typeof Project;
    Label: typeof Label;
    Column: typeof Column;
    Issue: typeof Issue;
    Comment: typeof Comment;
    AgentTask: typeof AgentTask;
    Log: typeof Log;
    sequelize: Sequelize;
    Sequelize: typeof Sequelize;
}

export type {
    GroupAttributes,
    GroupCreationAttributes,
    ProjectAttributes,
    ProjectCreationAttributes,
    LabelAttributes,
    LabelCreationAttributes,
    ColumnAttributes,
    ColumnCreationAttributes,
    IssueAttributes,
    IssueCreationAttributes,
    CommentAttributes,
    CommentCreationAttributes,
    AgentTaskAttributes,
    AgentTaskCreationAttributes,
    LogAttributes,
    LogCreationAttributes,
};

export {
    Group,
    Project,
    Label,
    Column,
    Issue,
    Comment,
    AgentTask,
    Log,
};

export { Group as GroupModel };
export { Project as ProjectModel };
export { Label as LabelModel };
export { Column as ColumnModel };
export { Issue as IssueModel };
export { Comment as CommentModel };
export { AgentTask as AgentTaskModel };
export { Log as LogModel };

declare const db: Database;
export default db;
