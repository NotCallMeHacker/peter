"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

/** Layout effect in the browser, plain effect in the server render pass — the
 *  jump has to land before paint, but `useLayoutEffect` warns on the server. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Start the mobile board rail on its first kanban column.
 *
 * The rail keeps its DOM order — the "Needs you" hero / agent chat slide is
 * still first — this only sets the rail's *initial scroll offset* to the
 * position snap-to-center would give the first column, so opening or
 * refreshing the board always lands on Backlog instead of on the stack.
 * Idempotent: a second run finds the column already centred and the offset
 * stays put, and a scroll position the browser restored is pulled back too.
 */
export function useStartOnFirstColumn(railRef: RefObject<HTMLElement | null>) {
    useIsomorphicLayoutEffect(() => {
        const rail = railRef.current;
        // rails that do not scroll (desktop grid, tablet wrap) have nothing to park
        if (!rail || rail.scrollWidth <= rail.clientWidth) return;
        const first = rail.querySelector<HTMLElement>(".kb-col");
        if (!first) return;

        const railBox = rail.getBoundingClientRect();
        const colBox = first.getBoundingClientRect();
        // distance from the column's centre to the rail's snap centre
        const delta = colBox.left + colBox.width / 2 - (railBox.left + railBox.width / 2);
        if (delta === 0) return;

        // jump, don't glide: the stylesheet asks for smooth scrolling
        const behavior = rail.style.scrollBehavior;
        rail.style.scrollBehavior = "auto";
        rail.scrollLeft += delta;
        rail.style.scrollBehavior = behavior;
    }, [railRef]);
}
