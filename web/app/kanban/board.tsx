"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import {
    LayoutDashboard,
    Users,
    FolderKanban,
    Bot,
    FileText,
    GitBranch,
    HelpCircle,
    Settings,
    Search,
    Bell,
    Send,
} from "lucide-react";
import { Sidebar, type SidebarGroup } from "../_components/sidebar";
import { LogoutButton } from "./logoutButton";
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
                {column.issues.length === 0 && <p className="kb-col-empty">{t("columns.empty")}</p>}
                {column.issues.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} />
                ))}
            </div>
        </section>
    );
}

function TopBar({ searchLabel, notificationsLabel }: { searchLabel: string; notificationsLabel: string }) {
    return (
        <header className="kb-top">
            <button className="kb-search" type="button" aria-label={searchLabel}>
                <Search size={16} />
            </button>
            <button className="kb-bell" type="button" aria-label={notificationsLabel}>
                <Bell size={17} />
                <span className="kb-bell-dot" aria-hidden="true" />
            </button>
            <span className="avatar avatar--blue avatar--me" aria-hidden="true">
                P
            </span>
        </header>
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
                {messages.length === 0 && <p className="kb-col-empty">{t("chatEmpty")}</p>}
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
    const tCommon = useTranslations("common");

    const { project } = board;
    // title subline: project name followed by its live worktrees, as designed
    const subline = [project.name, ...project.worktrees.map((wt) => wt.name)].join(" · ");

    // opening / refreshing the mobile rail starts on the first kanban column
    const railRef = useRef<HTMLDivElement>(null);
    useStartOnFirstColumn(railRef);

    const groups: SidebarGroup[] = [
        {
            section: t("nav.overview"),
            items: [
                { icon: LayoutDashboard, label: t("nav.dashboard"), href: "/dashboard" },
                { icon: FolderKanban, label: t("nav.projects"), href: "/kanban" },
                { icon: Users, label: t("nav.team"), href: "/kanban" },
            ],
        },
        {
            section: t("nav.work"),
            items: [
                { icon: FolderKanban, label: t("nav.board"), href: `/kanban/${board.publicId}`, active: true },
                { icon: Bot, label: t("nav.agents"), href: "/kanban", badge: project.needYou },
                { icon: FileText, label: t("nav.docs"), href: "/kanban" },
                { icon: GitBranch, label: t("nav.git"), href: "/kanban" },
            ],
        },
        {
            section: t("nav.account"),
            items: [
                { icon: HelpCircle, label: t("nav.help"), href: "/kanban" },
                { icon: Settings, label: t("nav.settings"), href: "/kanban" },
            ],
        },
    ];

    return (
        <div className="kb">
            <Sidebar
                brand={{ title: "peter", subtitle: t("brandSub") }}
                groups={groups}
                foot={<LogoutButton label={tCommon("logout")} />}
                menuLabel={tCommon("openMenu")}
                closeLabel={tCommon("closeMenu")}
            />

            <div className="kb-main">
                <TopBar searchLabel={t("search")} notificationsLabel={t("notifications")} />

                <div className="kb-title">
                    <div>
                        <h1>{t("title")}</h1>
                        <p className="kb-title-sub">{subline}</p>
                    </div>
                </div>

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
