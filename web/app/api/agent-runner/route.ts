import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { getHub, readStatusSnapshot, type RunnerStatusEntry } from "@/server/bridge/hub";

/**
 * GET /api/agent-runner — the bridge's authenticated status view.
 *
 * The WebSocket upgrade on this same path is intercepted in
 * `instrumentation.ts` before Next sees it; plain HTTP GET lands here. Session
 * gate like every other API route (GoTrue-verified cookie), because the
 * runner list is operational data about the deployment.
 *
 * The bridge hub lives in the process that owns the WebSocket; when this
 * handler runs elsewhere (or the hub is empty) the mirrored status snapshot
 * fills in — same shape either way.
 */
export async function GET(): Promise<NextResponse> {
    const { user } = await getSession();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const live = getHub().describe();
    const runners: RunnerStatusEntry[] = live.runners.length > 0 ? live.runners : (readStatusSnapshot()?.runners ?? []);
    return NextResponse.json({ updatedAt: live.updatedAt, runners });
}