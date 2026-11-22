import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { moveIssue, reorderColumns, resolveProjectOwned } from "@/app/_lib/kanbanRepo";
import type { ReorderBody } from "@/app/kanban/data";

/**
 * POST /api/kanban/reorder — persist a drag & drop result. Body shapes in
 * `ReorderBody` (data.ts): `issue` moves one issue to 0-based `index` in the
 * target column's list; `columns` is the FULL new column order (a
 * permutation of the project's live column uids). Ids are ciphered uids.
 *
 * Errors: 400 bad body / bad permutation, 401 no session, 404 unknown or
 * foreign project/issue/column (never reveals existence), 409 locked issue.
 */

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

/** Defensive parse — anything that is not exactly one of the two shapes is `null`. */
function parseReorderBody(value: unknown): ReorderBody | null {
    if (typeof value !== "object" || value === null) return null;
    const body = value as Record<string, unknown>;
    if (!isNonEmptyString(body.project)) return null;

    if (body.kind === "issue") {
        const { issue, toColumn, index } = body;
        if (!isNonEmptyString(issue) || !isNonEmptyString(toColumn)) return null;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
        return { kind: "issue", project: body.project, issue, toColumn, index };
    }

    if (body.kind === "column") {
        if (!isStringArray(body.columns)) return null;
        return { kind: "column", project: body.project, columns: body.columns };
    }

    return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const { user } = await getSession();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const body = parseReorderBody(raw);
    if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    try {
        // Unknown and foreign projects both answer as 404.
        const projectId = await resolveProjectOwned(user.sub, body.project);
        if (projectId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (body.kind === "issue") {
            const result = await moveIssue(body.issue, body.toColumn, body.index);
            if (result === "locked") {
                return NextResponse.json({ error: "issue is locked" }, { status: 409 });
            }
            if (result === "not_found") {
                return NextResponse.json({ error: "Not found" }, { status: 404 });
            }
            return NextResponse.json({ ok: true });
        }

        const result = await reorderColumns(projectId, body.columns);
        if (result === "bad_order") {
            return NextResponse.json({ error: "bad order" }, { status: 400 });
        }
        if (result === "not_found") {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[kanban/reorder]", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
