import { headers } from "next/headers";
import { ShellSidebar } from "./shellSidebar";
import type { Locale } from "../_lib/i18n";

/**
 * Page frame for every route — no header: the shell is the sidebar rail
 * riding the blue field, the scrolling page column under it and the footer
 * stamp at the end. (The wordmark lives in the rail's brand block.)
 *
 * The path arrives tagged by `proxy.ts`, so this server component can shape
 * the chrome per route: `/auth` drops the sidebar — the sign-in card is a
 * single focused surface and carries its own theme/locale controls.
 */
export async function AppShell({ children, locale }: { children: React.ReactNode; locale: Locale }) {
    const pathname = (await headers()).get("x-pathname") ?? "/";

    const bare = pathname === "/auth" || pathname.startsWith("/auth/");

    return (
        <div className="App app-container">
            {/* No pathname prop: the rail reads the live path client-side
                (see ShellSidebar) — this header only shapes which chrome
                exists, and survives client-side navigations. */}
            {!bare && <ShellSidebar currentLocale={locale} />}

            <div className="fill" id="home-container">
                {children}
            </div>
        </div>
    );
}