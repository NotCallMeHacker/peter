import { FolderKanban, LayoutDashboard, Settings, type LucideIcon } from "lucide-react";

export type NavEntry = {
    icon: LucideIcon;
    /** translation key under the `kanban.nav` namespace */
    key: string;
    href: string;
};

/**
 * The sidebar's navigation, once — Dashboard and Projects under Overview,
 * Settings under Account.
 *
 * Entries are exact routes (they never share an href): a board page
 * (/kanban/{id}) must not light up Projects — only /kanban itself may, and
 * the matcher below is deliberately `===` for that reason. Callers add the
 * active state and the localized label, so routes mark themselves without
 * duplicating entry lists.
 */
export function appNavGroups(): { section: string; items: NavEntry[] }[] {
    return [
        {
            section: "overview",
            items: [
                { icon: LayoutDashboard, key: "dashboard", href: "/dashboard" },
                { icon: FolderKanban, key: "projects", href: "/kanban" },
            ],
        },
        {
            section: "account",
            items: [{ icon: Settings, key: "settings", href: "/settings" }],
        },
    ];
}

/**
 * Localized labels, `active` marked when `pathname` is exactly an entry's
 * href (prefix matching is banned here: it would highlight Projects on
 * /kanban/{publicId} too, where the open page is a single board).
 *
 * `t` is typed as `(key: never) => string` so both a plain translator and
 * next-intl's key-narrowed one satisfy it (its keys are a literal union, so
 * it refuses a plain `(key: string) => string`); the string-keyed calls below
 * re-widen once inside, where the keys are built at runtime anyway and
 * misses come back as the key itself (next-intl dev behavior).
 */
export function localizedNavGroups(
    t: (key: never) => string,
    pathname: string | null,
): { section: string; items: (NavEntry & { active?: boolean; label: string })[] }[] {
    // SAFETY: `t`'s parameter is `never`, so TypeScript already accepts every
    // call here — the widening only restores string keys for the template
    // literals below; the runtime translator resolves any string key anyway.
    const tr = t as unknown as (key: string) => string;
    return appNavGroups().map(({ section, items }) => ({
        section: tr(`nav.${section}`),
        items: items.map((item) => ({
            ...item,
            label: tr(`nav.${item.key}`),
            active: pathname === item.href,
        })),
    }));
}