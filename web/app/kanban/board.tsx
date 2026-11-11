"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { EmptyState } from "../_components/card";
import { PageHeader } from "../_components/pageHeader";
import {
    columnLabelKey,
    type Board,
    type ChatMessage,
    type Column,
    type HeroProject,
    type Issue,
} from "./data";
import { useStartOnFirstColumn } from "./railStart";

function IssueCard({ issue }: { issue: Issue }) {
    const t = useTranslations("kanban");
    const typeName = issue.type ? t(`type.${issue.type}`) : null;

    return (
        <article className={"card" + (issue.flagged ? " card--flagged" : "")}>
            <div className="card-id">{issue.id}</div>
            <h3 className="card-title">{issue.title}</h3>
            <div className="card-meta">
                {typeName && <span className={"tag tag--" + issue.type}>{typeName}</span>}
                {issue.run && (
                    <span className={"tag tag--run tag--run-" + issue.run.state}>{issue.run.label}</span>
                )}
                <span className="card-date">{issue.date}</span>
                {issue.avatar && (
                    <span className={"avatar avatar--" + issue.avatarTone} aria-hidden="true">
                        {issue.avatar}
                    </span>
                )}
            </div>
            {issue.run?.progress !== undefined && (
                <div
                    className="bar"
                    role="progressbar"
                    aria-valuenow={issue.run.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <i
                        className={"bar-fill bar-fill--" + issue.run.state}
                        style={{ width: `${issue.run.progress}%` }}
                    />
                </div>
            )}
        </article>
    );
}

function BoardColumn({ column }: { column: Column }) {
    const t = useTranslations("kanban");
    const label = column.label || t(columnLabelKey[column.key]);

    return (
        <section className="kb-col" aria-label={label}>
            <div className={"pill pill--" + column.key}>
                <span>
                    {label} <span className="pill-sep">·</span> {column.count}
                </span>
                <span className="pill-dot" aria-hidden="true" />
            </div>
            <div className="kb-col-cards">
                {column.issues.length === 0 && <EmptyState>{t("columns.empty")}</EmptyState>}
                {column.issues.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} />
                ))}
            </div>
        </section>
    );
}

function HeroPanel({ project }: { project: HeroProject }) {
    const t = useTranslations("kanban");

    return (
        <aside className="hero" aria-label={t("needsYou")}>
            <p className="hero-cap">{t("needsYou")}</p>
            <p className="hero-n">{project.failedRuns}</p>
            <p className="hero-lbl">{t("failedRuns", { count: project.needYou })}</p>
            {project.worktrees.length > 0 && (
                <div className="hero-wt">
                    <p className="hero-wthead">{t("worktrees")}</p>
                    {project.worktrees.map((wt) => (
                        <p key={wt.name}>
                            <b>{wt.name}</b> · {wt.branch}
                        </p>
                    ))}
                </div>
            )}
            <div className="hero-plot" aria-label={t("activity")}>
                {project.activity.map((bar, i) => (
                    <i key={i} className={bar.failed ? "is-failed" : undefined} style={{ height: `${bar.h}%` }} />
                ))}
            </div>
        </aside>
    );
}

function AgentChat({ messages }: { messages: ChatMessage[] }) {
    const t = useTranslations("kanban");

    return (
        <aside className="chat" aria-label={t("agentChat")}>
            <h2 className="chat-head">{t("agentChat")}</h2>
            <div className="chat-msgs">
                {messages.length === 0 && <EmptyState>{t("chatEmpty")}</EmptyState>}
                {messages.map((msg, i) => (
                    <div key={i} className={"msg" + (msg.mine ? " msg--me" : "")}>
                        <span className="msg-who">{msg.meta}</span>
                        <p>{msg.text}</p>
                    </div>
                ))}
            </div>
            <div className="chat-input">
                <span>{t("messagePlaceholder")}</span>
                <Send size={15} />
            </div>
        </aside>
    );
}

export default function KanbanPage({ board }: { board: Board }) {
    const t = useTranslations("kanban");
    const { project } = board;
    // route card note: the project name with its live worktrees — the path
    // rides on its own line directly under the title (PageHeader below)
    const subline = [project.name, ...project.worktrees.map((wt) => wt.name)].join(" · ");

    // opening / refreshing the mobile rail starts on the first kanban column
    const railRef = useRef<HTMLDivElement>(null);
    useStartOnFirstColumn(railRef);

    // The sidebar is the shell's single rail (app/_components/shellSidebar) —
    // one instance per page, one set of animations everywhere.

    return (
        <div className="kb">
            <div className="kb-main">
                <PageHeader title={t("title")} path={`/kanban/${board.publicId}`} note={subline} />

                <div className="kb-board" ref={railRef}>
                    <div className="kb-stack">
                        <HeroPanel project={project} />
                        <AgentChat messages={board.chat} />
                    </div>

                    <div className="kb-cols">
                        {board.columns.map((column) => (
                            <BoardColumn key={column.key + column.label} column={column} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
