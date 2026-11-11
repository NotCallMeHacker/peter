import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForSession } from "@/app/_lib/auth";
import { setSessionCookies } from "@/app/_lib/session";
// PKCE verifier arrives via the sb-pkce cookie set in /api/auth/oauth.

// PKCE: verifier lives in the sb-pkce cookie set by /api/auth/oauth.

/**
 * GET ?code=… — GoTrue redirects the OAuth provider's browser flow back here;
 * the PKCE verifier is in the sb-pkce cookie set by /api/auth/oauth.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    const code = request.nextUrl.searchParams.get("code");
    const verifier = request.cookies.get("sb-pkce")?.value;
    const next = request.cookies.get("sb-oauth-next")?.value ?? "/kanban";

    const failure = (message: string): NextResponse => {
        const response = NextResponse.redirect(new URL(`/auth?error=${encodeURIComponent(message)}`, request.url));
        response.cookies.delete("sb-pkce");
        response.cookies.delete("sb-oauth-next");
        return response;
    };

    if (!code || !verifier) {
        return failure("Sign-in link is missing or expired");
    }

    try {
        const session = await exchangeCodeForSession(code, verifier);
        await setSessionCookies(session);
        const response = NextResponse.redirect(new URL(next, request.url));
        response.cookies.delete("sb-pkce");
        response.cookies.delete("sb-oauth-next");
        return response;
    } catch (error) {
        console.error("[auth/callback]", error);
        return failure("Could not complete the sign-in");
    }
}