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
import { project, columns, chat, type Column, type Issue } from "./data";
import { useStartOnFirstColumn } from "./railStart";

const columnLabelKey = {
    backlog: "columns.backlog",
    ready: "columns.ready",
    progress: "columns.progress",
    review: "columns.review",
} as const;

function IssueCard({ issue }: { issue: Issue }) {
    const t = useTranslations("kanban");
    const typeName = t(`type.${issue.type}`);

    return (
        <article className={"card" + (issue.flagged ? " card--flagged" : "")}>
            <div className="card-id">{issue.id}</div>
            <h3 className="card-title">{issue.title}</h3>
            <div className="card-meta">
                <span className={"tag tag--" + issue.type}>{typeName}</span>
                {issue.run && (
                    <span className={"tag tag--run tag--run-" + issue.run.state}>{issue.run.label}</span>
                )}
                <span className="card-date">{issue.date}</span>
                <span className={"avatar avatar--" + issue.avatarTone} aria-hidden="true">
                    {issue.avatar}
                </span>
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

function BoardColumn({ column, label }: { column: Column; label: string }) {
    const t = useTranslations("kanban");

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

function HeroPanel() {
    const t = useTranslations("kanban");

    return (
        <aside className="hero" aria-label={t("needsYou")}>
            <p className="hero-cap">{t("needsYou")}</p>
            <p className="hero-n">{project.failedRuns}</p>
            <p className="hero-lbl">{t("failedRuns", { count: project.needYou })}</p>
            <div className="hero-wt">
                <p className="hero-wthead">{t("worktrees")}</p>
                {project.worktrees.map((wt) => (
                    <p key={wt.name}>
                        <b>{wt.name}</b> · {wt.branch}
                    </p>
                ))}
            </div>
            <div className="hero-plot" aria-label={t("activity")}>
                {project.activity.map((bar, i) => (
                    <i key={i} className={bar.failed ? "state-failed" : undefined} style={{ height: `${bar.h}%` }} />
                ))}
            </div>
        </aside>
    );
}

function AgentChat() {
    const t = useTranslations("kanban");

    return (
        <aside className="chat" aria-label={t("agentChat")}>
            <h2 className="chat-head">{t("agentChat")}</h2>
            <div className="chat-msgs">
                {chat.map((msg, i) => (
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

export default function KanbanPage() {
    const t = useTranslations("kanban");
    const tCommon = useTranslations("common");

    // opening / refreshing the mobile rail starts on the first kanban column
    const railRef = useRef<HTMLDivElement>(null);
    useStartOnFirstColumn(railRef);

    const groups: SidebarGroup[] = [
        {
            section: t("nav.overview"),
            items: [
                { icon: LayoutDashboard, label: t("nav.dashboard"), href: "/kanban" },
                { icon: FolderKanban, label: t("nav.projects"), href: "/kanban" },
                { icon: Users, label: t("nav.team"), href: "/kanban" },
            ],
        },
        {
            section: t("nav.work"),
            items: [
                { icon: FolderKanban, label: t("nav.board"), href: "/kanban", active: true },
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
                        <p className="kb-title-sub">{t("subtitle")}</p>
                    </div>
                </div>

                <div className="kb-board" ref={railRef}>
                    <div className="kb-stack">
                        <HeroPanel />
                        <AgentChat />
                    </div>

                    <div className="kb-cols">
                        {columns.map((column) => (
                            <BoardColumn key={column.key} column={column} label={t(columnLabelKey[column.key])} />
                        ))}
                    </div>
                </div>

                <p className="kb-note">{t("syntheticNote")}</p>
            </div>
        </div>
    );
}