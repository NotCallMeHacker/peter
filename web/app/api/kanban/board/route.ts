import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { parsePublicId } from "@/app/_lib/idConversion";
import { loadBoard } from "@/app/_lib/kanbanRepo";

/**
 * GET /api/kanban/board?project=<publicId> — the full board as JSON (`Board`),
 * the same shape the server component renders. The client refetches this
 * after a realtime event instead of reloading the page.
 *
 * Errors: 401 no session, 400 missing `project`, 404 unknown or foreign
 * project (never reveals existence).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    const { user } = await getSession();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const publicId = request.nextUrl.searchParams.get("project");
    if (!publicId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const internalId = parsePublicId(publicId);
    if (internalId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        // loadBoard applies the ownership check itself and answers null for
        // unknown and foreign projects alike.
        const board = await loadBoard(user.sub, internalId);
        if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(board);
    } catch (error) {
        console.error("[kanban/board]", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
