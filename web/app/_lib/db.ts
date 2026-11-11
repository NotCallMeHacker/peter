import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "./session";

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
 * `20261108000002-row-level-security` migration). Since Supabase Auth (GoTrue)
 * issues the session, this module simply forwards that session's access token
 * — signed by GoTrue, validated by PostgREST against the shared secret in
 * `supabase/.env`. The browser never receives it: only server components call
 * PostgREST, so there is nothing here to forge a token with (no JWT secret in
 * the web environment at all). The static anon key stays the `apikey` the
 * gateway expects; it carries no `sub`, which is exactly why a bare call to
 * the API returns zero rows.
 *
 * Server-only: must not be imported from a `"use client"` file.
 */

/** Schema that holds Projects, Columns, Issues, Labels, Logs, … */
export const APP_SCHEMA = "app";

type Config = { url: string; anonKey: string };

let config: Config | undefined;

function getConfig(): Config {
    if (config) return config;

    // .trim(): env files are hand-edited (supabase/.env is CRLF), and a
    // trailing \r in the secret silently produces a signature PostgREST rejects.
    const url = process.env.SUPABASE_URL?.trim();
    const anonKey = process.env.SUPABASE_ANON_KEY?.trim();

    if (!url || !anonKey) {
        throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set — see web/.env.example");
    }

    config = { url, anonKey };
    return config;
}

/**
 * Cached clients keyed by the access token (tokens rotate on refresh, so the
 * key rotates with them and no stale Authorization header can survive).
 */
const clients = new Map<string, SupabaseClient>();

async function clientFor(): Promise<SupabaseClient> {
    const { url, anonKey } = getConfig();
    const token = (await getAccessToken()) ?? "";
    if (!token) {
        // No session: anonymous reads match nothing under RLS — fail closed
        // instead of querying with a token that has no `sub`.
        throw new Error("No session: PostgREST reads require a signed-in user");
    }

    const cached = clients.get(token);
    if (cached) return cached;
    if (clients.size > 32) clients.clear();

    const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    clients.set(token, client);
    return client;
}

/**
 * Query builder scoped to the `app` schema for the signed-in user, so
 * `from("Projects")` resolves to `app."Projects"` (table names match the
 * Sequelize models in `web/db/models`) and returns every row the policies
 * allow for this session's `sub`.
 */
export async function appSchema() {
    return (await clientFor()).schema(APP_SCHEMA);
}