/**
 * Synthetic board data for the kanban visual pass.
 * Authored at full fidelity as demonstration content — every issue, run,
 * worktree and chat line below is invented for the PoC and must be replaced
 * by real data when the agent/worktree backend lands. No claims are made here.
 */

export type IssueType = "bug" | "improvement" | "chore" | "docs";

export type RunState = "none" | "queued" | "running" | "failed" | "done";

export type Issue = {
    id: string;
    title: string;
    type: IssueType;
    date: string;
    avatar: string;
    avatarTone: "blue" | "green" | "coral";
    run?: { label: string; state: RunState; progress?: number };
    worktree?: string;
    flagged?: boolean;
};

export type Column = {
    key: "backlog" | "ready" | "progress" | "review";
    count: number;
    running: number;
    delegated?: number;
    issues: Issue[];
};

export const project = {
    name: "peter / core",
    worktrees: [
        { name: "wt/agent-1", branch: "feat/session-auth" },
        { name: "wt/agent-2", branch: "fix/pooler" },
        { name: "wt/main", branch: "clean" },
    ],
    failedRuns: 3,
    needYou: 2,
    /** 24h run activity, one bar per 3h bucket; `failed` buckets read coral. */
    activity: [
        { h: 40, failed: false },
        { h: 65, failed: false },
        { h: 90, failed: true },
        { h: 35, failed: false },
        { h: 70, failed: false },
        { h: 55, failed: true },
        { h: 48, failed: false },
        { h: 75, failed: false },
    ],
};

export const columns: Column[] = [
    {
        key: "backlog",
        count: 12,
        running: 0,
        issues: [
            {
                id: "FAC 142",
                title: "Sync issues to GitHub Projects (optional)",
                type: "improvement",
                date: "Jul 25",
                avatar: "A2",
                avatarTone: "blue",
            },
            {
                id: "FAC 138",
                title: "Worktree cleanup after merged runs",
                type: "chore",
                date: "Jul 26",
                avatar: "A1",
                avatarTone: "green",
            },
            {
                id: "FAC 131",
                title: "Docs: outline → markdown export",
                type: "docs",
                date: "Jul 28",
                avatar: "P",
                avatarTone: "blue",
            },
            {
                id: "FAC 129",
                title: "Storage stub: multipart uploads",
                type: "improvement",
                date: "Aug 02",
                avatar: "A2",
                avatarTone: "blue",
            },
            {
                id: "FAC 127",
                title: "Vector logs retention policy",
                type: "chore",
                date: "Aug 03",
                avatar: "A1",
                avatarTone: "green",
            },
            {
                id: "FAC 125",
                title: "Envoy CDS hot-reload watch",
                type: "improvement",
                date: "Aug 04",
                avatar: "A2",
                avatarTone: "blue",
            },
            {
                id: "FAC 123",
                title: "Realtime presence for agent status",
                type: "improvement",
                date: "Aug 05",
                avatar: "A1",
                avatarTone: "blue",
            },
            {
                id: "FAC 121",
                title: "Worktree prune on merge",
                type: "chore",
                date: "Aug 06",
                avatar: "P",
                avatarTone: "green",
            },
            {
                id: "FAC 119",
                title: "Docs: agent runbook in outline",
                type: "docs",
                date: "Aug 07",
                avatar: "P",
                avatarTone: "blue",
            },
            {
                id: "FAC 117",
                title: "Rate-limit the GitHub sync webhook",
                type: "bug",
                date: "Aug 08",
                avatar: "A2",
                avatarTone: "blue",
            },
            {
                id: "FAC 115",
                title: "Board keyboard navigation",
                type: "improvement",
                date: "Aug 09",
                avatar: "A1",
                avatarTone: "green",
            },
            {
                id: "FAC 113",
                title: "Export board to markdown",
                type: "docs",
                date: "Aug 10",
                avatar: "P",
                avatarTone: "blue",
            },
        ],
    },
    {
        key: "ready",
        count: 5,
        running: 0,
        delegated: 2,
        issues: [
            {
                id: "FAC 151",
                title: "Pooler drops connections under load",
                type: "bug",
                date: "Jul 30",
                avatar: "A2",
                avatarTone: "blue",
                run: { label: "delegated · wt/agent-2", state: "queued" },
                worktree: "wt/agent-2",
            },
            {
                id: "FAC 147",
                title: "Rotate JWT keys without downtime",
                type: "bug",
                date: "Aug 01",
                avatar: "P",
                avatarTone: "blue",
            },
            {
                id: "FAC 145",
                title: "Session refresh race under load",
                type: "bug",
                date: "Aug 02",
                avatar: "A1",
                avatarTone: "blue",
            },
            {
                id: "FAC 143",
                title: "Delegated run: outline sync",
                type: "improvement",
                date: "Aug 03",
                avatar: "A2",
                avatarTone: "green",
                run: { label: "delegated · wt/agent-1", state: "queued" },
                worktree: "wt/agent-1",
            },
            {
                id: "FAC 141",
                title: "pgbouncer pool_size tuning",
                type: "chore",
                date: "Aug 04",
                avatar: "P",
                avatarTone: "blue",
            },
        ],
    },
    {
        key: "progress",
        count: 4,
        running: 2,
        issues: [
            {
                id: "FAC 155",
                title: "Kanban: drag between columns",
                type: "improvement",
                date: "14:15",
                avatar: "A1",
                avatarTone: "blue",
                run: { label: "run #48 · 6m", state: "running", progress: 64 },
                worktree: "wt/agent-1",
            },
            {
                id: "FAC 154",
                title: "Agent run failed: pgbouncer timeout",
                type: "bug",
                date: "14:09",
                avatar: "A2",
                avatarTone: "coral",
                run: { label: "failed · assist?", state: "failed" },
                worktree: "wt/agent-2",
                flagged: true,
            },
            {
                id: "FAC 149",
                title: "i18n: add French locale",
                type: "improvement",
                date: "13:52",
                avatar: "A1",
                avatarTone: "green",
                run: { label: "run #47 · done", state: "done", progress: 100 },
                worktree: "wt/agent-1",
            },
            {
                id: "FAC 146",
                title: "Agent log streaming over SSE",
                type: "improvement",
                date: "13:44",
                avatar: "A2",
                avatarTone: "blue",
                run: { label: "run #46 · 12m", state: "running", progress: 38 },
                worktree: "wt/agent-2",
            },
        ],
    },
    {
        key: "review",
        count: 2,
        running: 0,
        issues: [
            {
                id: "FAC 140",
                title: "RequireSession refactor",
                type: "chore",
                date: "Jul 31",
                avatar: "A1",
                avatarTone: "blue",
                run: { label: "checks ✓", state: "done" },
                worktree: "wt/agent-1",
            },
            {
                id: "FAC 136",
                title: "Theme toggle: persist choice",
                type: "improvement",
                date: "13:41",
                avatar: "P",
                avatarTone: "green",
                run: { label: "merged", state: "done" },
            },
        ],
    },
];

export const chat = [
    {
        from: "agent-2",
        meta: "AGENT-2 · FAC 151 · 4M",
        text: "Should the pooler fix target pg15 or pg17 first?",
        mine: false,
    },
    {
        from: "you",
        meta: "YOU",
        text: "pg17 — we're upgrading this week anyway.",
        mine: true,
    },
    {
        from: "agent-1",
        meta: "AGENT-1 · FAC 155 · 11M",
        text: "Restart run #48 or review its diff first?",
        mine: false,
    },
];
