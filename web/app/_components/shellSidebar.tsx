"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { localizedNavGroups } from "./appNav";
import { Sidebar, type SidebarGroup } from "./sidebar";
import { LogoutButton } from "./logoutButton";

/**
 * The shell's rail for every non-bare route.
 *
 * Lives in the client bundle on purpose: the nav entries carry lucide icon
 * components (forwardRef objects), and those cannot cross the RSC boundary —
 * constructing them here keeps them client-side. The nav list itself is the
 * shared one in appNav.
 *
 * The active entry is marked from `usePathname()` — the live client path —
 * rather than the server's `x-pathname`: picking a project is a client-side
 * Link navigation, and the root layout (where that header is read) never
 * re-renders for it, so the prop stayed frozen at the path of the initial
 * document load and Projects kept its active state on a board page.
 */
export function ShellSidebar({ currentLocale }: { currentLocale?: string }) {
    const t = useTranslations("common");
    const tk = useTranslations("kanban");
    const pathname = usePathname();

    // The shared navigation (appNav): one list for the app, localized, with
    // the live path marked active (exact match — see appNav).
    const groups: SidebarGroup[] = localizedNavGroups(tk, pathname);

    return (
        <Sidebar
            brand={{ title: "peter", subtitle: tk("brandSub") }}
            groups={groups}
            foot={<LogoutButton label={t("logout")} />}
            currentLocale={currentLocale}
            menuLabel={t("openMenu")}
            closeLabel={t("closeMenu")}
        />
    );
}