import { NextRequest, NextResponse } from "next/server";
import { AuthError, signInWithPassword, type AuthSession } from "@/app/_lib/auth";
import { setSessionCookies } from "@/app/_lib/session";
// Note: cookies may only be set in route handlers/server actions.
// Note: routes under app/api/auth/*/ are the only place Next permits Set-Cookie.

/**
 * POST { email, password } → 200 once GoTrue issued a session; the two
 * httpOnly cookies are set here (the only place Next allows Set-Cookie).
 * GoTrue's own error message is passed through — it already translates
 * "invalid credentials" vs "confirm your email" correctly.
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

    try {
        const session: AuthSession = await signInWithPassword(email, password);
        await setSessionCookies(session);
        return NextResponse.json({ userId: session.user.id });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[auth/signin]", error);
        return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
    }
}