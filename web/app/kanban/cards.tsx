"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "./data";
import { issueKey } from "./dndLogic";

/**
 * The issue card and its sortable wrapper. A locked issue (`issue.locked`)
 * gets no drag listeners and its `useSortable` is disabled — same rule the
 * `app.move_issue` SQL enforces.
 */

type IssueCardProps = {
    issue: Issue;
    dragging?: boolean;
    style?: CSSProperties;
    setNodeRef?: (node: HTMLElement | null) => void;
    listeners?: ReturnType<typeof useSortable>["listeners"];
    attributes?: ReturnType<typeof useSortable>["attributes"];
    dragLabel?: string;
};

export function IssueCard({ issue, dragging, style, setNodeRef, listeners, attributes, dragLabel }: IssueCardProps) {
    const t = useTranslations("kanban");
    const typeName = issue.type ? t(`type.${issue.type}`) : null;
    const locked = issue.locked === true;

    return (
        <article
            ref={setNodeRef}
            style={style}
            {...(locked ? { "aria-disabled": true, title: t("dnd.locked") } : { ...listeners, ...attributes })}
            className={
                "card" +
                (issue.flagged ? " card--flagged" : "") +
                (locked ? " card--locked" : "") +
                (dragging ? " card--dragging" : "")
            }
            aria-label={locked ? undefined : dragLabel}
        >
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

/**
 * One sortable card inside a column's `SortableContext`.
 *
 * Two subtleties:
 * - A locked issue is draggable-disabled but stays DROPPABLE — it is a
 *   position anchor; removing it from the candidates would shift every
 *   computed insertion index by one.
 * - `animateLayoutChanges: () => false` + `noShiftStrategy` in the parent:
 *   the controlled preview owns placement through DOM order, so dnd-kit's
 *   transforms must never fight it.
 */
export function SortableIssue({ issue }: { issue: Issue }) {
    const t = useTranslations("kanban");
    const locked = issue.locked === true;
    const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
        id: issueKey(issue.uid),
        disabled: { draggable: locked, droppable: false },
        animateLayoutChanges: () => false,
    });

    return (
        <IssueCard
            issue={issue}
            dragging={isDragging}
            setNodeRef={setNodeRef}
            listeners={locked ? undefined : listeners}
            attributes={locked ? undefined : attributes}
            dragLabel={t("dnd.moveIssue")}
            style={{ transform: CSS.Translate.toString(transform), transition }}
        />
    );
}
