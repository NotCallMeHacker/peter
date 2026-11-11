import { NextRequest, NextResponse } from "next/server";
import {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    REFRESH_MAX_AGE,
    cookieBase,
    jwtExpiry,
    refreshSession,
} from "@/app/_lib/auth";

/**
 * Next 16's proxy (formerly middleware) — the only place outside route
 * handlers where cookies can be written, which makes it the right home for
 * session refresh: a server component cannot Set-Cookie once rendering has
 * started.
 *
 * Responsibilities:
 *  1. Rotate the GoTrue session when the access token is within a minute of
 *     expiring (at most one refresh per token, never on the hot path).
 *  2. Bounce signed-out visitors off the gated surfaces (/kanban, /dashboard)
 *     to /auth — everything else (home, /auth itself) stays public.
 *
 * Trust note: `exp` is read from the unverified JWT only to schedule a
 * refresh; whether a token is *actually* good is decided by GoTrue in
 * `getSession` (and by PostgREST for every data read).
 */

/** Prefixes that require a session; everything else is public. */
const GATED = ["/kanban", "/dashboard"];

/** Refresh while the access token has less than this left (seconds). */
const REFRESH_MARGIN_SECONDS = 60;

function isGated(pathname: string): boolean {
    return GATED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirect(request: NextRequest): NextResponse {
    const { pathname, search } = request.nextUrl;
    const params = new URLSearchParams();
    if (pathname !== "/") params.set("next", pathname + search);
    return NextResponse.redirect(new URL(`/auth${params.size ? `?${params}` : ""}`, request.url));
}

/**
 * Forward with the request path tagged on — the root layout reads it to decide
 * which chrome the route carries (the sign-in card renders without the
 * sidebar). Cookies still cannot be set from a server component, so the
 * proxy stays the one place that both refreshes and forwards.
 */
function pass(request: NextRequest): NextResponse {
    const response = NextResponse.next();
    response.headers.set("x-pathname", request.nextUrl.pathname);
    return response;
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
    let access = request.cookies.get(ACCESS_COOKIE)?.value;
    const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

    // No session at all: public pages pass (tagged, so the root layout can
    // shape its chrome), gated ones go to /auth.
    if (!access) {
        if (!isGated(request.nextUrl.pathname)) return pass(request);
        return redirect(request);
    }

    // Near expiry: rotate now, so server components can trust the cookie for
    // the whole render (they cannot set cookies themselves mid-render).
    const exp = jwtExpiry(access);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (exp !== null && exp - REFRESH_MARGIN_SECONDS < nowSeconds && refresh) {
        try {
            const session = await refreshSession(refresh);
            access = session.access_token;
            const response = pass(request);
            const base = cookieBase();
            response.cookies.set(ACCESS_COOKIE, session.access_token, { ...base, maxAge: session.expires_in });
            response.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...base, maxAge: REFRESH_MAX_AGE });
            return response;
        } catch {
            // Refresh rejected (revoked/reused token) — end the session.
            const response = redirect(request);
            response.cookies.delete(ACCESS_COOKIE);
            response.cookies.delete(REFRESH_COOKIE);
            return response;
        }
    }

    if (exp !== null && exp <= nowSeconds) {
        // Expired and no usable refresh token.
        const response = redirect(request);
        response.cookies.delete(ACCESS_COOKIE);
        response.cookies.delete(REFRESH_COOKIE);
        return response;
    }

    return pass(request);
}

export const config = {
    // Everything except build assets and files — auth and data routes must run.
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)"],
};