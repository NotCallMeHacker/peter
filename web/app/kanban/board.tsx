"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragMoveEvent,
    type DragStartEvent,
} from "@dnd-kit/core";
import {
    horizontalListSortingStrategy,
    SortableContext,
    sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Send } from "lucide-react";
import { EmptyState } from "../_components/card";
import { PageHeader } from "../_components/pageHeader";
import { columnLabelKey, type Board, type ChatMessage, type Column, type HeroProject, type Issue } from "./data";
import {
    COLUMN_PREFIX,
    columnKey,
    decodeOverKey,
    findColumn,
    ISSUE_PREFIX,
    issueTargetFromCollisions,
    kanbanCollisionDetection,
    planColumnMove,
    planIssueDrop,
    postReorder,
    type ReorderBody,
} from "./dndLogic";
import { buildEchoExpectation, ECHO_TTL_MS, type EchoExpectation } from "./echo";
import { IssueCard } from "./cards";
import { BoardColumn } from "./columns";
import { useStartOnFirstColumn } from "./railStart";
import { useBoardRealtime } from "./useBoardRealtime";

/**
 * One project's board: optimistic drag-and-drop (dnd-kit) + live sync over
 * Supabase Realtime WebSocket. Drag preview mutates local state; the drop
 * plans a POST to /api/kanban/reorder and reverts to the pre-drag snapshot
 * when the server refuses (see dndLogic.ts for the planning rules).
 */
export default function KanbanPage({ board: serverBoard }: { board: Board }) {
    const t = useTranslations("kanban");
    const [board, setBoard] = useState<Board>(serverBoard);
    const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
    const [activeColumn, setActiveColumn] = useState<Column | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [overlayWidth, setOverlayWidth] = useState<number>();
    const [error, setError] = useState(false);

    const boardRef = useRef(board);
    const snapshotRef = useRef<Board | null>(null);
    const draggingRef = useRef(false);
    const pendingRef = useRef(0);
    // Last resolved drop target ("columnUid:index") — the preview only
    // re-renders when it actually changes, so pixel-wise dragMove events
    // don't churn the whole board tree.
    const lastTargetRef = useRef("");
    // A realtime sync that arrived while a drag/in-flight write owned the
    // screen; retried the moment the move settles so remote changes are
    // never silently skipped.
    const resyncRef = useRef(false);
    // Predicted echo of the write in flight — the realtime hook drops events
    // that match it instead of refetching (see echo.ts).
    const echoRef = useRef<EchoExpectation | null>(null);
    const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        boardRef.current = board;
    }, [board]);

    // Adopt newer server props (refresh/navigation) unless a drag or an
    // in-flight write owns the screen — never clobber a preview mid-move.
    useEffect(() => {
        if (draggingRef.current || pendingRef.current > 0) return;
        setBoard(serverBoard);
    }, [serverBoard]);

    const { project } = board;
    // route card note: the project name with its live worktrees — the path
    // rides on its own line directly under the title (PageHeader below)
    const subline = [project.name, ...project.worktrees.map((wt) => wt.name)].join(" · ");

    // opening / refreshing the mobile rail starts on the first kanban column
    const railRef = useRef<HTMLDivElement>(null);
    useStartOnFirstColumn(railRef);

    /* ---- live sync: realtime event → debounced refetch (in the hook) ---- */

    const refresh = useCallback(async () => {
        const current = boardRef.current;
        if (draggingRef.current || pendingRef.current > 0) {
            resyncRef.current = true;
            return;
        }
        try {
            const res = await fetch(`/api/kanban/board?project=${encodeURIComponent(current.publicId)}`, {
                cache: "no-store",
            });
            if (!res.ok) return;
            const next = (await res.json()) as Board;
            if (draggingRef.current || pendingRef.current > 0) {
                resyncRef.current = true;
                return;
            }
            setBoard(next);
        } catch {
            /* transient — the next event retries */
        }
    }, []);

    /** Retry one sync that was skipped mid-move. */
    const drainResync = useCallback(() => {
        if (resyncRef.current) {
            resyncRef.current = false;
            void refresh();
        }
    }, [refresh]);

    useBoardRealtime(board.publicId, refresh, echoRef);

    /* ---- optimistic writes: apply on drop, revert on failure ---- */

    const showError = useCallback(() => {
        setError(true);
        if (errorTimer.current !== undefined) clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => setError(false), 8000);
    }, []);

    const persist = useCallback(
        (body: ReorderBody, snapshot: Board, next: Board) => {
            pendingRef.current += 1;
            // Predict our write's echo before it ships: the hook drops rows
            // matching `next` (already on screen) and refetches anything
            // else. Set before the POST so an echo racing the response is
            // still attributed.
            echoRef.current = buildEchoExpectation(body, snapshot, next, Date.now() + ECHO_TTL_MS);
            void postReorder(body).then((ok) => {
                pendingRef.current -= 1;
                if (!ok) {
                    echoRef.current = null; // rejected — swallow nothing
                    setBoard(snapshot); // revert to the pre-drop snapshot
                    showError();
                }
                // No confirm fetch: matched echoes are ours (state already
                // matches), unexpected events refetch on their own. Only
                // pick up a sync that was skipped while the write was in
                // flight.
                drainResync();
            });
        },
        [drainResync, showError]
    );

    /* ---- sensors & collisions ---- */

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    /* ---- drag handlers ---- */

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const key = String(event.active.id);
        draggingRef.current = true;
        snapshotRef.current = boardRef.current; // cancel / failed-write revert
        lastTargetRef.current = "";
        // The overlay must render at the source handle's exact width: the
        // lifted pill fills its column (a fixed/fit-content width would shrink
        // the header), and the lifted card matches its grid cell. The activator
        // target IS the drag handle — climb to it and measure it. (Active has no
        // node ref; its rect only covers the card body.)
        const activatorTarget = event.activatorEvent.target;
        const handle =
            activatorTarget instanceof Element ? activatorTarget.closest(".pill, .card") : null;
        const width = handle
            ? handle.getBoundingClientRect().width
            : event.active.rect.current.initial?.width;
        if (typeof width === "number") setOverlayWidth(width);
        if (key.startsWith(ISSUE_PREFIX)) {
            const uid = key.slice(ISSUE_PREFIX.length);
            const issue = boardRef.current.columns.flatMap((column) => column.issues).find((item) => item.uid === uid);
            setActiveIssue(issue ?? null);
        } else if (key.startsWith(COLUMN_PREFIX)) {
            const uid = key.slice(COLUMN_PREFIX.length);
            setActiveColumn(findColumn(boardRef.current, uid) ?? null);
        }
    }, []);

    // Live preview: on every dragMove the SAME resolver used for the drop
    // re-places the issue (`plan.next`), so what the pointer shows is exactly
    // what a drop here would POST. This is `onDragMove`, not `onDragOver`:
    // onDragOver only fires when `over.id` changes, and the zone-pinned
    // collisions keep over.id constant within a column. Column drags preview
    // through the sortable displacement instead.
    const handleDragMove = useCallback((event: DragMoveEvent) => {
        const activeKey = String(event.active.id);
        if (!activeKey.startsWith(ISSUE_PREFIX)) return;
        const issueUid = activeKey.slice(ISSUE_PREFIX.length);

        const target = issueTargetFromCollisions(event.collisions);
        const signature = target ? `${target.columnUid}:${target.index}` : "";
        if (signature === lastTargetRef.current) return; // same slot — no render
        lastTargetRef.current = signature;

        setDropTarget(target ? target.columnUid : null);
        const preDrag = snapshotRef.current ?? boardRef.current;
        setBoard((prev) => {
            if (!target) return preDrag; // pointer outside the board — undo preview
            const plan = planIssueDrop(prev, preDrag, issueUid, target);
            return plan.kind === "issue" ? plan.next : preDrag;
        });
    }, []);

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const activeKey = String(event.active.id);
            draggingRef.current = false;
            lastTargetRef.current = "";
            setActiveIssue(null);
            setActiveColumn(null);
            setDropTarget(null);
            setOverlayWidth(undefined);

            const snapshot = snapshotRef.current ?? boardRef.current;
            snapshotRef.current = null;

            /* column reorder → full order POST */
            if (activeKey.startsWith(COLUMN_PREFIX)) {
                const activeUid = activeKey.slice(COLUMN_PREFIX.length);
                const over = event.over ? decodeOverKey(String(event.over.id)) : null;
                const plan =
                    over && over.type === "column"
                        ? planColumnMove(boardRef.current, activeUid, over.uid)
                        : ({ kind: "none" } as const);
                if (plan.kind !== "column") {
                    setBoard(snapshot); // dropped outside / no-op — undo preview
                    drainResync();
                    return;
                }
                setBoard(plan.next);
                persist(plan.body, snapshot, plan.next);
                return;
            }

            /* issue move → single (issue, column, index) POST */
            if (!activeKey.startsWith(ISSUE_PREFIX)) return;
            const issueUid = activeKey.slice(ISSUE_PREFIX.length);
            // Same resolver as the preview: the drop plan IS what was shown.
            const target = issueTargetFromCollisions(event.collisions);
            const plan = target
                ? planIssueDrop(boardRef.current, snapshot, issueUid, target)
                : ({ kind: "none" } as const);
            if (plan.kind !== "issue") {
                setBoard(snapshot); // no-op / dropped outside — undo preview
                drainResync();
                return;
            }
            setBoard(plan.next);
            persist(plan.body, snapshot, plan.next);
        },
        [drainResync, persist]
    );

    const handleDragCancel = useCallback(() => {
        draggingRef.current = false;
        lastTargetRef.current = "";
        setActiveIssue(null);
        setActiveColumn(null);
        setDropTarget(null);
        setOverlayWidth(undefined);
        const snapshot = snapshotRef.current;
        snapshotRef.current = null;
        if (snapshot) setBoard(snapshot);
        drainResync();
    }, [drainResync]);

    return (
        <div className="kb">
            <div className="kb-main">
                <PageHeader title={t("title")} path={`/kanban/${board.publicId}`} note={subline} />

                {error && (
                    <p className="notice" role="alert">
                        {t("dnd.moveFailed")}
                    </p>
                )}

                <div className="kb-board" ref={railRef}>
                    <div className="kb-stack">
                        <HeroPanel project={project} />
                        <AgentChat messages={board.chat} />
                    </div>

                    <DndContext
                        id="kanban-board"
                        sensors={sensors}
                        collisionDetection={kanbanCollisionDetection}
                        onDragStart={handleDragStart}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        onDragCancel={handleDragCancel}
                    >
                        <div className="kb-cols">
                            <SortableContext
                                items={board.columns.map((column) => columnKey(column.uid))}
                                strategy={horizontalListSortingStrategy}
                            >
                                {board.columns.map((column) => (
                                    <BoardColumn
                                        key={column.uid}
                                        column={column}
                                        dropTarget={dropTarget === column.uid}
                                    />
                                ))}
                            </SortableContext>
                        </div>

                        <DragOverlay dropAnimation={null}>
                            {activeIssue && (
                                <div className="kb-overlay" style={{ width: overlayWidth }}>
                                    <IssueCard issue={activeIssue} />
                                </div>
                            )}
                            {activeColumn && (
                                <div className="kb-overlay" style={{ width: overlayWidth }}>
                                    <div
                                        className={"pill pill--" + activeColumn.key}
                                        style={
                                            activeColumn.color
                                                ? { backgroundColor: activeColumn.color }
                                                : undefined
                                        }
                                    >
                                        <span>
                                            {activeColumn.label || t(columnLabelKey[activeColumn.key])}{" "}
                                            <span className="pill-sep">·</span> {activeColumn.issues.length}
                                        </span>
                                        <span className="pill-dot" aria-hidden="true" />
                                    </div>
                                </div>
                            )}
                        </DragOverlay>
                    </DndContext>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Side panels (hero + chat) — board-independent, no drag state        */
/* ------------------------------------------------------------------ */

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