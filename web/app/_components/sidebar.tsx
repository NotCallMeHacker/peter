"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "./themeToggle";
import { LangSwitcher } from "./langSwitcher";
import "./sidebar.css";

export type SidebarItem = {
    icon: ComponentType<{ size?: number }>;
    label: string;
    href: string;
    active?: boolean;
    /** Small count lozenge pinned to the row's right edge. */
    badge?: number;
};

export type SidebarGroup = {
    section: string;
    items: SidebarItem[];
};

export type SidebarProps = {
    brand: { title: string; subtitle: string };
    groups: SidebarGroup[];
    /** Extra controls for the foot row (logout, user menu…); theme and language
     *  are always included. Add `className="side-row"` to whatever you pass so
     *  it picks up the shared row base the nav links use. */
    foot?: React.ReactNode;
    /** Locale shown by the language selector. Defaults to "en". */
    currentLocale?: string;
    /** aria-label for the navigation landmark. Defaults to "Primary". */
    ariaLabel?: string;
    /** aria-label for the mobile hamburger trigger. */
    menuLabel?: string;
    /** aria-label for the mobile menu's close button. */
    closeLabel?: string;
};

/**
 * App sidebar: brand, grouped nav, foot controls.
 *
 * Past 860px it rests as a 76px icon rail and expands to a 236px column as an
 * overlay on hover/focus (position + z-index keep the page from reflowing) —
 * the rail width is reserved by the page root, which renders the `kb` class.
 * At 860px and below it leaves the flow entirely: a fixed-position panel that
 * slides in over the whole viewport from the left, opened by the hamburger
 * trigger this component renders next to the page's top bar. Escape, the close
 * button, a nav tap or a jump back to a desktop-width viewport all dismiss it,
 * and the page behind it stops scrolling while it is open.
 */
export function Sidebar({
    brand,
    groups,
    foot,
    currentLocale = "en",
    ariaLabel = "Primary",
    menuLabel = "Open menu",
    closeLabel = "Close menu",
}: SidebarProps) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const openedOnce = useRef(false);

    // While open: lock the page behind the panel, close on Escape, and drop the
    // panel the moment the viewport grows back to the desktop rail.
    useEffect(() => {
        if (!open) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        const wide = window.matchMedia("(min-width: 861px)");
        const onWide = (event: MediaQueryListEvent) => {
            if (event.matches) setOpen(false);
        };

        document.addEventListener("keydown", onKey);
        wide.addEventListener("change", onWide);
        document.body.style.overflow = "hidden";

        return () => {
            document.removeEventListener("keydown", onKey);
            wide.removeEventListener("change", onWide);
            document.body.style.overflow = "";
        };
    }, [open]);

    // Focus follows the panel: into its close button on open (one frame later,
    // once the panel is actually visible), back to the trigger on close —
    // skipped on first render, when nothing was opened yet.
    useEffect(() => {
        if (open) {
            openedOnce.current = true;
            const frame = requestAnimationFrame(() => closeRef.current?.focus());
            return () => cancelAnimationFrame(frame);
        }
        if (openedOnce.current) triggerRef.current?.focus();
    }, [open]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="side-burger"
                aria-label={menuLabel}
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen(true)}
            >
                <Menu size={20} />
            </button>

            <aside className={"side" + (open ? " side--open" : "")} id={menuId}>
                <button
                    ref={closeRef}
                    type="button"
                    className="side-close"
                    aria-label={closeLabel}
                    onClick={() => setOpen(false)}
                >
                    <X size={20} />
                </button>

                <div className="side-brand">
                    <span className="side-brand-logo" aria-hidden="true">
                        {brand.title.slice(0, 1)}
                    </span>
                    <div>
                        <b>{brand.title}</b>
                        <span>{brand.subtitle}</span>
                    </div>
                </div>

                <nav className="side-nav" aria-label={ariaLabel}>
                    {groups.map((group) => (
                        <div key={group.section} className="side-nav-group">
                            <p className="side-nav-section">{group.section}</p>
                            {group.items.map((item) => (
                                <a
                                    key={item.label}
                                    href={item.href}
                                    className={"side-row side-nav-item" + (item.active ? " side-nav-item--on" : "")}
                                    aria-current={item.active ? "page" : undefined}
                                    title={item.label}
                                    onClick={() => setOpen(false)}
                                >
                                    <item.icon size={15} />
                                    <span className="side-nav-label">{item.label}</span>
                                    {item.badge ? <span className="side-nav-badge">{item.badge}</span> : null}
                                </a>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="side-foot">
                    <ThemeToggle className="side-row" />
                    <LangSwitcher currentLocale={currentLocale} className="side-row" />
                    {foot}
                </div>
            </aside>
        </>
    );
}
