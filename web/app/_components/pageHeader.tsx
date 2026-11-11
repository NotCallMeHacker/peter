import type { ReactNode } from "react";

/**
 * Route card above a framed page — the shape every page leads with: the
 * 30/800 display heading, the route path directly under it (mono — a machine
 * fact) and an optional prose note below that. The optional navy tile mark
 * precedes the heading where a surface carries one.
 */
export function PageHeader({
    title,
    path,
    note,
    mark,
}: {
    title: ReactNode;
    /** Route path shown directly under the title, in the mono face. */
    path?: string;
    /** Optional prose line under the path, in the body face. */
    note?: ReactNode;
    /** Optional navy tile glyph before the heading ("peter"). */
    mark?: string;
}) {
    return (
        <div className="page-head">
            {mark && (
                <span className="tile tile--mark" aria-hidden="true">
                    {mark}
                </span>
            )}
            <h1 className="page-title">{title}</h1>
            {path && <p className="page-path">{path}</p>}
            {note && <p className="page-intro">{note}</p>}
        </div>
    );
}