import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { buildAuthorizeUrl, cookieBase } from "@/app/_lib/auth";

/**
 * GET ?provider=github → 302 to GoTrue's /authorize with a PKCE challenge.
 * The verifier rides in an httpOnly cookie to the callback route; GoTrue only
 * ever sees the challenge, so nothing here needs a signing secret.
 */
const PROVIDERS = new Set(["github", "google"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
    const provider = request.nextUrl.searchParams.get("provider") ?? "";
    const next = request.nextUrl.searchParams.get("next") || "/kanban";

    if (!PROVIDERS.has(provider)) {
        return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    // A small verifier fits in a cookie; S256 proves possession of it.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const { origin } = request.nextUrl;
    const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(next)}&provider=${provider}`;
    const authorizeUrl = buildAuthorizeUrl(provider, redirectTo, challenge);

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set("sb-pkce", verifier, { ...cookieBase(), maxAge: 600 });
    response.cookies.set("sb-oauth-next", next, { ...cookieBase(), maxAge: 600 });
    return response;
}