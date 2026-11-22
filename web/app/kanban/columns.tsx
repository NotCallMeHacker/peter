"use client";

import { useTranslations } from "next-intl";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EmptyState } from "../_components/card";
import { columnLabelKey, type Column } from "./data";
import { columnKey, issueKey, noShiftStrategy, zoneKey } from "./dndLogic";
import { SortableIssue } from "./cards";

/**
 * One kanban column. The pill is the column's drag handle; the card list is
 * the droppable zone `zone:<uid>`, so even an empty column accepts issue
 * drops. The issue SortableContext gets `id={zoneKey(uid)}` (cards decode
 * their column from `data.sortable.containerId`) and `noShiftStrategy` —
 * placement preview is owned by board state. The pill wears the column's own
 * stored colour so a reorder never repaints it.
 */
export function BoardColumn({ column, dropTarget }: { column: Column; dropTarget: boolean }) {
    const t = useTranslations("kanban");
    const label = column.label || t(columnLabelKey[column.key]);

    const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } =
        useSortable({ id: columnKey(column.uid) });
    const { setNodeRef: setZoneRef } = useDroppable({
        id: zoneKey(column.uid),
        data: { type: "zone", uid: column.uid },
    });

    return (
        <section
            className={"kb-col" + (dropTarget ? " kb-col--drop-target" : "")}
            aria-label={label}
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
        >
            <div
                className={"pill pill--" + column.key + " pill--handle"}
                ref={setActivatorNodeRef}
                {...listeners}
                {...attributes}
                aria-label={t("dnd.moveColumn")}
                style={column.color ? { backgroundColor: column.color } : undefined}
            >
                <span>
                    {label} <span className="pill-sep">·</span> {column.count}
                </span>
                <span className="pill-dot" aria-hidden="true" />
            </div>
            <div className="kb-col-cards" ref={setZoneRef}>
                <SortableContext
                    id={zoneKey(column.uid)}
                    items={column.issues.map((issue) => issueKey(issue.uid))}
                    strategy={noShiftStrategy}
                >
                    {column.issues.map((issue) => (
                        <SortableIssue key={issue.uid} issue={issue} />
                    ))}
                </SortableContext>
                {column.issues.length === 0 && dropTarget && (
                    <div className="card--placeholder" aria-hidden="true" />
                )}
                {column.issues.length === 0 && !dropTarget && <EmptyState>{t("columns.empty")}</EmptyState>}
            </div>
        </section>
    );
}
