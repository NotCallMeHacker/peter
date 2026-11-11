import { NextRequest, NextResponse } from "next/server";
import { AuthError, signUp } from "@/app/_lib/auth";
import { setSessionCookies } from "@/app/_lib/session";

/**
 * POST { email, password } → 200.
 * - Auto-confirmed accounts come back with a session → cookies are set.
 * - Otherwise `requiresConfirmation` tells the UI to check the inbox
 *   (local stack has no mail container, so enable autoconfirm in
 *   supabase/.env for development).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
    let body: { email?: string; password?: string };
    try {
        body = (await request.json()) as typeof body;
    } catch {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const email = body.email?.trim();
    const password = body.password ?? "";
    if (!email || !password) {
        return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    try {
        const session = await signUp(email, password);
        if (session) {
            await setSessionCookies(session);
            return NextResponse.json({ userId: session.user.id });
        }
        return NextResponse.json({ requiresConfirmation: true });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[auth/signup]", error);
        return NextResponse.json({ error: "Signup failed" }, { status: 500 });
    }
}