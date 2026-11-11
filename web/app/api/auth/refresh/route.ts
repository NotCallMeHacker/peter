import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { REFRESH_COOKIE, REFRESH_MAX_AGE, refreshSession } from "@/app/_lib/auth";
import { clearSessionCookies, setSessionCookies } from "@/app/_lib/session";
// Out-of-band refresh; proxy.ts handles the common in-flight case.


/**
 * POST → rotate the session out-of-band. Used by the client when a
 * fetch returns 401 (proxy.ts handles the common in-flight case already).
 */
export async function POST(): Promise<NextResponse> {
    const store = await cookies();
    const refreshToken = store.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) {
        await clearSessionCookies();
        return NextResponse.json({ error: "No session" }, { status: 401 });
    }

    try {
        const session = await refreshSession(refreshToken);
        await setSessionCookies(session);
        return NextResponse.json({ ok: true, expiresIn: session.expires_in, maxAge: REFRESH_MAX_AGE });
    } catch {
        await clearSessionCookies();
        return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
}