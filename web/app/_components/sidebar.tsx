import type { ComponentType } from "react";
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
    /** Extra controls for the foot row (logout, user menu…); theme and language are always included. */
    foot?: React.ReactNode;
    /** Locale shown by the language selector. Defaults to "en". */
    currentLocale?: string;
    /** aria-label for the navigation landmark. Defaults to "Primary". */
    ariaLabel?: string;
};

/**
 * App sidebar: brand, grouped nav, foot controls.
 *
 * Past 860px it rests as a 76px icon rail and expands to a 236px column as an
 * overlay on hover/focus (position + z-index keep the page from reflowing) —
 * the rail width is reserved by the page root, which renders the `kb` class.
 * Below 861px it collapses to a horizontal, wrapping bar.
 */
export function Sidebar({
    brand,
    groups,
    foot,
    currentLocale = "en",
    ariaLabel = "Primary",
}: SidebarProps) {
    return (
        <aside className="side">
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
                                className={"side-nav-item" + (item.active ? " side-nav-item--on" : "")}
                                aria-current={item.active ? "page" : undefined}
                                title={item.label}
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
                <ThemeToggle />
                <LangSwitcher currentLocale={currentLocale} />
                {foot}
            </div>
        </aside>
    );
}