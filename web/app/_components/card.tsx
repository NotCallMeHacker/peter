import type { ReactNode } from "react";

/** The one dashed silhouette — the empty state every surface reuses.
 *  (The white card surface itself is styled in globals.css; issue cards keep
 *  their board-specific markup in kanban/board.tsx.) */
export function EmptyState({ children }: { children: ReactNode }) {
    return <p className="empty">{children}</p>;
}