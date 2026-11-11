/**
 * Session cookies on the server: read the GoTrue session from the request,
 * write it back after sign-in/refresh.
 *
 * The one constraint that shapes this file: Next only lets us *set* cookies
 * inside route handlers or server actions (never mid-render of a server
 * component). That is why refresh lives in `proxy.ts` and the auth API routes,
 * while `getSession` here is read-only.
 */

import { cookies } from "next/headers";
import {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    REFRESH_MAX_AGE,
    cookieBase,
    getUser,
    type AuthSession,
    type SessionUser,
} from "./auth";

/** Verification results are memoized per token — one page render ≠ one GoTrue call per query. */
const verified = new Map<string, { user: SessionUser; at: number }>();
const VERIFY_TTL_MS = 30_000;

export type Session =
    | { user: SessionUser; expired: false }
    | { user: null; expired: boolean };

/**
 * The signed-in user for this request, verified with GoTrue (`GET /user`).
 * `expired: true` means a token exists but is no longer accepted — the
 * caller should refresh (proxy) or bounce to /auth.
 */
export async function getSession(): Promise<Session> {
    const store = await cookies();
    const token = store.get(ACCESS_COOKIE)?.value;
    if (!token) return { user: null, expired: false };

    const hit = verified.get(token);
    if (hit && Date.now() - hit.at < VERIFY_TTL_MS) return { user: hit.user, expired: false };

    try {
        const user = await getUser(token);
        const sessionUser: SessionUser = { ...user, sub: user.id };
        verified.set(token, { user: sessionUser, at: Date.now() });
        if (verified.size > 64) verified.clear();
        return { user: sessionUser, expired: false };
    } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 400 || status === 401 || status === 403) {
            return { user: null, expired: true };
        }
        throw error; // GoTrue unreachable — surface it, do not silently log the user out
    }
}

/** The raw access token — forwarded to PostgREST, which validates it itself. */
export async function getAccessToken(): Promise<string | null> {
    const store = await cookies();
    return store.get(ACCESS_COOKIE)?.value ?? null;
}

/** Persist a GoTrue session as the two httpOnly cookies (route handler only). */
export async function setSessionCookies(session: AuthSession): Promise<void> {
    const store = await cookies();
    const base = cookieBase();
    store.set(ACCESS_COOKIE, session.access_token, { ...base, maxAge: session.expires_in });
    store.set(REFRESH_COOKIE, session.refresh_token, { ...base, maxAge: REFRESH_MAX_AGE });
}

/** Drop both cookies (sign-out, failed refresh — route handler or proxy only). */
export async function clearSessionCookies(): Promise<void> {
    const store = await cookies();
    store.delete(ACCESS_COOKIE);
    store.delete(REFRESH_COOKIE);
}