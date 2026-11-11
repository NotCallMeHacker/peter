import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
// GoTrue validates the token itself — no local JWT secret involved.

// GoTrue validates the cookie token itself — no local JWT secret involved.

/** GET → the signed-in user as the app sees it; 401 when there is none. */
export async function GET(): Promise<NextResponse> {
    const { user } = await getSession();
    if (!user) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({
        userId: user.sub,
        email: user.email ?? null,
    });
}