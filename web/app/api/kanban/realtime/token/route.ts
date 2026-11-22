import { NextRequest, NextResponse } from "next/server";
import { jwtExpiry } from "@/app/_lib/auth";
import { getSupabasePublicConfig } from "@/app/_lib/db";
import { resolveProjectOwned } from "@/app/_lib/kanbanRepo";
import { getAccessToken, getSession } from "@/app/_lib/session";

/**
 * GET /api/kanban/realtime/token?project=<publicId> — the ONLY place the
 * browser learns the Supabase anon key and its own access token, so the
 * access-token cookie can stay httpOnly. The token is the user's GoTrue
 * access token (realtime's RLS resolves the caller from it), `expiresAt` its
 * `exp` claim in seconds (unverified read — same as proxy.ts; RLS still
 * verifies the signature), and `topic` the private channel for this board.
 *
 * Errors: 401 no session or no access token, 400 missing `project`, 404
 * unknown or foreign project (so the topic cannot be probed).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    const { user } = await getSession();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const token = await getAccessToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const publicId = request.nextUrl.searchParams.get("project");
    if (!publicId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    try {
        const projectId = await resolveProjectOwned(user.sub, publicId);
        if (projectId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const expiresAt = jwtExpiry(token);
        if (expiresAt === null) {
            throw new Error("access token has no readable exp claim");
        }

        // Throws when SUPABASE_URL / SUPABASE_ANON_KEY are unset, which
        // becomes a 500 instead of a half-configured client.
        const { url, anonKey } = getSupabasePublicConfig();
        return NextResponse.json({
            url,
            anonKey,
            token,
            expiresAt,
            topic: `board:${projectId}`,
        });
    } catch (error) {
        console.error("[kanban/realtime/token]", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
