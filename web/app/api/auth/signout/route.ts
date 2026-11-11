import { NextResponse } from "next/server";
import { signOut } from "@/app/_lib/auth";
import { clearSessionCookies, getAccessToken } from "@/app/_lib/session";
// Cookie clearing requires a route handler context.

// Cookies can only be cleared in route handlers — hence this endpoint.

/** POST → revokes the refresh token at GoTrue and drops both cookies. */
export async function POST(): Promise<NextResponse> {
    const token = await getAccessToken();
    if (token) await signOut(token);
    await clearSessionCookies();
    return NextResponse.json({ ok: true });
}