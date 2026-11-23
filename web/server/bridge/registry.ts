/**
 * Runner-instance registry: where B learns which supervisors are legitimate.
 *
 * Canonical source is the Supabase table `app."RunnerInstances"` (one row per
 * instance, written only by the `runner-keys` edge function, which only the
 * Supabase dashboard can invoke). The web app reads it the same way it reads
 * the kanban board — through PostgREST with the anon key and a SELECT-only
 * grant. Public keys are not secrets, so RLS is open for reads; anon cannot
 * INSERT/UPDATE/DELETE (no grants, no policies), and the web container still
 * holds no service-role key and no DB credentials.
 *
 * Revocation is the source of truth for "not legitimate": a row with
 * `revokedAt` set is refused even if its public key is still on file, so
 * deleting a row is never the only way to cut an instance off.
 *
 * Server-only: imported by the bridge hub and the status route.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Schema that holds the runner registry (same `app` schema as the board). */
const APP_SCHEMA = process.env.DB_SCHEMA?.trim() || "app";

/** What the bridge needs to verify one instance. */
export interface RunnerInstance {
    id: string;
    /** Raw Ed25519 public key, base64url (32 bytes). */
    publicKey: string;
    revokedAt: string | null;
    createdAt: string;
}

interface RunnerRow {
    id: string;
    publicKey: string;
    revokedAt: string | null;
    createdAt: string;
}

/** PostgREST connection shared with the rest of the app (anon key). */
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
    if (client) return client;
    const url = process.env.SUPABASE_URL?.trim();
    const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
    if (!url || !anonKey) {
        throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set — see web/.env.example");
    }
    client = createClient(url, anonKey, {
        auth: { persistSession: false },
    });
    return client;
}

/**
 * Look up one instance by id. Resolves to the row, or null when unknown or
 * revoked — callers treat both the same ("not a legitimate instance") but log
 * them differently.
 */
export async function getRunnerInstance(id: string): Promise<RunnerInstance | null> {
    const db = getClient();
    const { data, error } = await db
        .schema(APP_SCHEMA)
        .from("RunnerInstances")
        .select("id,publicKey,revokedAt,createdAt")
        .eq("id", id)
        .limit(1);
    if (error) throw new Error(`registry lookup failed: ${error.message}`);
    const row = (data as RunnerRow[] | null)?.[0];
    if (!row) return null;
    return {
        id: row.id,
        publicKey: row.publicKey,
        revokedAt: row.revokedAt ?? null,
        createdAt: row.createdAt,
    };
}

/**
 * All non-revoked instances — what the status route shows. Revoked rows are
 * kept out of it entirely (they are dead identities, not members).
 */
export async function listRunnerInstances(): Promise<RunnerInstance[]> {
    const db = getClient();
    const { data, error } = await db
        .schema(APP_SCHEMA)
        .from("RunnerInstances")
        .select("id,publicKey,revokedAt,createdAt")
        .order("createdAt", { ascending: true });
    if (error) throw new Error(`registry listing failed: ${error.message}`);
    return ((data as RunnerRow[] | null) ?? [])
        .filter((row) => !row.revokedAt)
        .map((row) => ({ id: row.id, publicKey: row.publicKey, revokedAt: null, createdAt: row.createdAt }));
}