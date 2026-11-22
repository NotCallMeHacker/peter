"use client";

import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { matchesEcho, type EchoExpectation, type RealtimeRowEvent } from "./echo";

/**
 * Live board sync over Supabase Realtime — WebSocket transport, private
 * `board:<project>` channel.
 *
 * The browser learns the anon key and its access token only from
 * `/api/kanban/realtime/token` (the access-token cookie stays httpOnly); the
 * token authorizes the channel join — realtime's RLS resolves the caller from
 * it. The transport is pinned to the global `WebSocket` explicitly — never
 * EventSource/SSE.
 *
 * On every `postgres_changes` event for `app."Issues"` / `app."Columns"` the
 * board refetches (`onRemoteChange`, debounced), so a change made in another
 * session shows up without a reload. Refetches only happen while the document
 * is visible; becoming visible again triggers one sync pass.
 *
 * Access tokens expire: `accessToken()` re-reads the token endpoint whenever
 * the client needs auth, `realtime.setAuth` runs explicitly before the first
 * subscribe (the callback alone can race the join → CHANNEL_ERROR), and a
 * slow interval re-auths the open channel across token rotation.
 */

type TokenResponse = {
    url: string;
    anonKey: string;
    token: string;
    expiresAt: number;
    topic: string;
};

const DEBOUNCE_MS = 300;
const REAUTH_INTERVAL_MS = 60_000;

async function fetchToken(publicId: string): Promise<TokenResponse> {
    const res = await fetch(`/api/kanban/realtime/token?project=${encodeURIComponent(publicId)}`, {
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`realtime token: HTTP ${res.status}`);
    return (await res.json()) as TokenResponse;
}

export function useBoardRealtime(
    publicId: string,
    onRemoteChange: () => void,
    expectationRef?: { current: EchoExpectation | null }
): void {
    const onChangeRef = useRef(onRemoteChange);
    onChangeRef.current = onRemoteChange;

    useEffect(() => {
        let cancelled = false;
        let debounce: ReturnType<typeof setTimeout> | undefined;
        let authInterval: ReturnType<typeof setInterval> | undefined;
        let supabase: SupabaseClient | null = null;

        // Our own write's echo matches the predicted row state — drop it
        // (the optimistic board already shows it). Anything unexpected
        // schedules the usual refetch.
        const onRow = (event: RealtimeRowEvent) => {
            const expectation = expectationRef?.current;
            if (expectation && Date.now() >= expectation.until) {
                expectationRef.current = null; // window over — attribute nothing further
            }
            const pending = expectationRef?.current;
            if (!pending) {
                scheduleRefresh();
                return;
            }
            if (matchesEcho(pending, event)) return; // our echo — board already shows it

            // Inside our write's window but not its predicted rows: refresh,
            // deferred past the window so the refetch reads past any
            // mid-rewrite park state.
            const delay = Math.max(DEBOUNCE_MS, pending.until - Date.now());
            if (cancelled || debounce !== undefined) clearTimeout(debounce);
            debounce = setTimeout(() => {
                if (cancelled || document.visibilityState !== "visible") return;
                onChangeRef.current();
            }, delay);
        };

        const scheduleRefresh = () => {
            if (cancelled) return;
            if (debounce !== undefined) clearTimeout(debounce);
            debounce = setTimeout(() => {
                if (cancelled || document.visibilityState !== "visible") return;
                onChangeRef.current();
            }, DEBOUNCE_MS);
        };

        const onVisibility = () => {
            if (document.visibilityState === "visible") onChangeRef.current();
        };

        void (async () => {
            let first: TokenResponse;
            try {
                first = await fetchToken(publicId);
            } catch {
                return; // no session / offline — the board just stays static
            }
            if (cancelled) return;

            // Re-read the token on every auth need; the endpoint refreshes it.
            const accessToken = async () => (await fetchToken(publicId)).token;

            supabase = createClient(first.url, first.anonKey, {
                auth: { persistSession: false, autoRefreshToken: false },
                accessToken,
                realtime: { transport: WebSocket },
            });

            // Explicitly auth the realtime socket before joining — the
            // accessToken callback alone can race the first join.
            try {
                await supabase.realtime.setAuth(first.token);
            } catch {
                /* reconnects re-auth through accessToken() */
            }
            if (cancelled) return;

            supabase
                .channel(first.topic, { config: { private: true } })
                .on("postgres_changes", { event: "*", schema: "app", table: "Issues" }, onRow)
                .on("postgres_changes", { event: "*", schema: "app", table: "Columns" }, onRow)
                .subscribe();

            authInterval = setInterval(() => {
                void accessToken()
                    .then((token) => supabase?.realtime.setAuth(token))
                    .catch(() => undefined);
            }, REAUTH_INTERVAL_MS);
        })();

        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            cancelled = true;
            if (debounce !== undefined) clearTimeout(debounce);
            if (authInterval !== undefined) clearInterval(authInterval);
            document.removeEventListener("visibilitychange", onVisibility);
            if (supabase) void supabase.removeAllChannels();
        };
    }, [publicId, expectationRef]);
}
