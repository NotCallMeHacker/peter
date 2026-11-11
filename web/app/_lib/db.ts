import JsonWebToken from "jsonwebtoken";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase (PostgREST) access for the app.
 *
 * The kanban tables live in the `app` schema (see `web/db`, `DB_SCHEMA=app`).
 * PostgREST only serves schemas listed in `PGRST_DB_SCHEMAS`, so `app` has to
 * be in there (supabase/.env) and the schema must be granted to the API roles:
 *
 *     GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;
 *     GRANT SELECT ON ALL TABLES IN SCHEMA app TO anon, authenticated, service_role;
 *
 * PostgREST picks the schema per request through `Accept-Profile`, which
 * supabase-js sets when the client is scoped with `.schema(APP_SCHEMA)`.
 *
 * **Identity travels in the token, not in the SQL.** Row Level Security on the
 * `app` tables resolves the caller from `request.jwt.claims ->> 'sub'` (see the
 * `20261108000002-row-level-security` migration), so every request carries a
 * short-lived HS256 token minted here for the signed-in user, signed with the
 * same `JWT_SECRET` PostgREST validates against. The static anon key stays the
 * `apikey` the gateway expects; it carries no `sub`, which is exactly why a
 * bare call to the API now returns zero rows.
 *
 * Server-only: the secret never reaches the browser, so this module must not be
 * imported from a `"use client"` file.
 */

/** Schema that holds Projects, Columns, Issues, Labels, Logs, … */
export const APP_SCHEMA = "app";

/** Lifetime of a minted request token — long enough for one page's queries. */
const TOKEN_TTL_SECONDS = 300;

type Config = { url: string; anonKey: string; jwtSecret: string };

let config: Config | undefined;

function getConfig(): Config {
    if (config) return config;

    // .trim(): env files are hand-edited (supabase/.env is CRLF), and a
    // trailing \r in the secret silently produces a signature PostgREST rejects.
    const url = process.env.SUPABASE_URL?.trim();
    // The key is only the `apikey` the API gateway checks; row visibility comes
    // from the per-request token below. service_role bypasses RLS entirely, so
    // it must never be the key that decides what a request may see.
    const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
    const jwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();

    if (!url || !anonKey || !jwtSecret) {
        throw new Error(
            "SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_JWT_SECRET must be set — " +
                "see web/.env.example (the JWT secret is JWT_SECRET from supabase/.env)"
        );
    }

    config = { url, anonKey, jwtSecret };
    return config;
}

/**
 * One client per (user, token bucket). Headers are fixed when the client is
 * built, so a token that is about to expire gets a fresh client rather than a
 * refreshed header; the bucket key rotates before the token does.
 */
const clients = new Map<string, SupabaseClient>();

/** Short-lived token carrying the caller's id as the `sub` claim. */
function requestToken(ownerId: string): string {
    const { jwtSecret } = getConfig();
    return JsonWebToken.sign(
        // `role` is what PostgREST switches to; anon is subject to RLS, which
        // is the point — service_role would sail straight past it.
        { role: "anon", iss: "supabase", sub: ownerId },
        jwtSecret,
        { algorithm: "HS256", expiresIn: TOKEN_TTL_SECONDS }
    );
}

function clientFor(ownerId: string): SupabaseClient {
    const { url, anonKey } = getConfig();
    const bucket = Math.floor(Date.now() / 1000 / TOKEN_TTL_SECONDS);
    const key = `${ownerId}:${bucket}`;

    const cached = clients.get(key);
    if (cached) return cached;
    if (clients.size > 32) clients.clear();

    const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${requestToken(ownerId)}` } },
    });
    clients.set(key, client);
    return client;
}

/**
 * Query builder scoped to the `app` schema for one user, so
 * `from("Projects")` resolves to `app."Projects"` (table names match the
 * Sequelize models in `web/db/models`) and every row the policies allow.
 *
 * `ownerId` is the session user (`sub`); an empty id mints a token without a
 * `sub`, which RLS reads as "nobody" — the queries then simply match nothing.
 */
export function appSchema(ownerId: string) {
    return clientFor(ownerId).schema(APP_SCHEMA);
}
