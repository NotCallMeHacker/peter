/**
 * Supabase Auth (GoTrue) — server-side client.
 *
 * Supabase Auth is the only identity provider: the browser never talks to
 * Supabase directly. Auth API routes call GoTrue here, and the resulting
 * session lives in two httpOnly cookies that server components forward to
 * PostgREST (see `session.ts` / `db.ts`). No signing secret lives in this app:
 * GoTrue issues and validates its own tokens, so there is nothing here to
 * forge a token with.
 *
 * This module is pure (no `next/headers`) so `proxy.ts` can import it.
 */

/** Session cookies — httpOnly, so they are invisible to page JavaScript. */
export const ACCESS_COOKIE = "sb-access-token";
export const REFRESH_COOKIE = "sb-refresh-token";

/** How long a refresh token stays valid (GoTrue's own refresh token reuse window). */
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

/** GoTrue's user object; `sub` mirrors the JWT claim RLS resolves the caller from. */
export type GoTrueUser = {
    id: string;
    aud?: string;
    role?: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
    created_at?: string;
};

/** What pages get from `RequireSession` — `sub` matches the RLS policies. */
export type SessionUser = GoTrueUser & { sub: string };

/** Token payload returned by GoTrue's grant endpoints. */
export type AuthSession = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: GoTrueUser;
};

/** GoTrue answered but refused the request (bad password, taken email, …). */
export class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

type Config = { url: string; anonKey: string };

let config: Config | undefined;

function getConfig(): Config {
    if (config) return config;
    // .trim(): hand-edited env files may carry a trailing \r (CRLF), which
    // silently breaks the apikey the gateway compares.
    const url = process.env.SUPABASE_URL?.replace(/\s+$/, "");
    const anonKey = process.env.SUPABASE_ANON_KEY?.replace(/\s+$/, "");
    if (!url || !anonKey) {
        throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set — see web/.env.example");
    }
    config = { url, anonKey };
    return config;
}

async function gotrue(path: string, init: RequestInit & { bearer?: string } = {}): Promise<Response> {
    const { url, anonKey } = getConfig();
    const { bearer, ...rest } = init;
    return fetch(`${url}/auth/v1${path}`, {
        ...rest,
        headers: {
            apikey: anonKey,
            // GoTrue accepts the anon key as bearer for grants/signup; user
            // endpoints get the user's own token instead.
            Authorization: `Bearer ${bearer ?? anonKey}`,
            "Content-Type": "application/json",
            ...rest.headers,
        },
    });
}

async function readError(res: Response): Promise<AuthError> {
    let message = res.statusText || "Authentication failed";
    try {
        const body = (await res.json()) as { msg?: string; error_description?: string; message?: string };
        message = body.msg ?? body.error_description ?? body.message ?? message;
    } catch {
        /* non-JSON error body — keep the status text */
    }
    return new AuthError(message, res.status);
}

/** POST /token?grant_type=password — email + password sign-in. */
export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
    const res = await gotrue("/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await readError(res);
    return (await res.json()) as AuthSession;
}

/**
 * POST /signup. Returns the session when the account is usable right away
 * (autoconfirm), otherwise `session: null` — the user must click the
 * confirmation email first.
 */
export async function signUp(email: string, password: string): Promise<AuthSession | null> {
    const res = await gotrue("/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await readError(res);
    const body = (await res.json()) as Partial<AuthSession> & { session?: AuthSession | null };
    const session = body.access_token ? (body as AuthSession) : (body.session ?? null);
    return session;
}

/** POST /token?grant_type=refresh_token — rotate a refresh token. */
export async function refreshSession(refreshToken: string): Promise<AuthSession> {
    const res = await gotrue("/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) throw await readError(res);
    return (await res.json()) as AuthSession;
}

/** GET /user — validates a token *with GoTrue itself*; no local secret needed. */
export async function getUser(accessToken: string): Promise<GoTrueUser> {
    const res = await gotrue("/user", { bearer: accessToken });
    if (!res.ok) throw await readError(res);
    return (await res.json()) as GoTrueUser;
}

/** POST /logout — revokes this session's refresh token server-side. */
export async function signOut(accessToken: string): Promise<void> {
    try {
        await gotrue("/logout", { method: "POST", bearer: accessToken });
    } catch {
        /* best effort — the cookies get cleared regardless */
    }
}

/** POST /token?grant_type=pkce — exchange the OAuth callback code for a session. */
export async function exchangeCodeForSession(code: string, codeVerifier: string): Promise<AuthSession> {
    const res = await gotrue("/token?grant_type=pkce", {
        method: "POST",
        body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
    });
    if (!res.ok) throw await readError(res);
    return (await res.json()) as AuthSession;
}

/**
 * Browser redirect target for an OAuth provider, PKCE-style: the verifier
 * stays in an httpOnly cookie here, GoTrue only ever sees the challenge.
 */
export function buildAuthorizeUrl(provider: string, redirectTo: string, codeChallenge: string): string {
    const { url } = getConfig();
    const params = new URLSearchParams({
        provider,
        redirect_to: redirectTo,
        code_challenge: codeChallenge,
        code_challenge_method: "s256",
    });
    return `${url}/auth/v1/authorize?${params}`;
}

/** Cookie attributes shared by both session cookies. */
export function cookieBase(): Record<string, unknown> {
    return {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        // Local stack is plain http; mark Secure only when Supabase itself is https.
        secure: getConfig().url.startsWith("https://"),
    };
}

/**
 * Read `exp` from a JWT **without verifying it** — only ever used to decide
 * "should proxy.ts refresh this cookie soon?"; trust decisions happen when
 * GoTrue validates the token via `getUser`.
 */
export function jwtExpiry(token: string): number | null {
    const payload = token.split(".")[1];
    if (!payload) return null;
    try {
        const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
        return typeof json.exp === "number" ? json.exp : null;
    } catch {
        return null;
    }
}

/** `sub` from an unverified token — RLS still verifies the signature itself. */
export function jwtSub(token: string): string | null {
    const payload = token.split(".")[1];
    if (!payload) return null;
    try {
        const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
        return typeof json.sub === "string" ? json.sub : null;
    } catch {
        return null;
    }
}