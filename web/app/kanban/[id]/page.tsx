import { notFound } from "next/navigation";
import { RequireSession } from "../../_components/requireSession";
import { loadBoard } from "../../_lib/kanbanRepo";
import { toInternal } from "../../_lib/idConversion";
import KanbanPage from "../board";
import "../board.css";

/**
 * One project's board: `/kanban/<public id>`.
 *
 * The id in the URL is the cyphered project id from `app/_lib/idConversion`;
 * it is turned back into the internal integer primary key before the rows of
 * `web/db/models` are read through Supabase.
 */
export default async function KanbanRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const internalId = parsePublicId(id);

    return <RequireSession>{(session) => <Board ownerId={session.sub ?? ""} internalId={internalId} />}</RequireSession>;
}

/** Public id → internal project id; anything unusable is a 404. */
function parsePublicId(publicId: string): number {
    let internal: number | undefined;
    try {
        internal = Number.parseInt(toInternal(publicId), 10);
    } catch {
        internal = undefined; // not a digit string — no such project
    }
    if (internal === undefined || !Number.isFinite(internal) || internal < 0) notFound();
    return internal;
}

/** Loads the board only when the project belongs to the signed-in user. */
async function Board({ ownerId, internalId }: { ownerId: string; internalId: number }) {
    const board = await loadBoard(ownerId, internalId);
    if (!board) notFound();
    return <KanbanPage board={board} />;
}
