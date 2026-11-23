import Link from "next/link";
import { headers } from "next/headers";
import { PageHeader } from "./_components/pageHeader";
import { createServerTranslator, getLocale } from "./_lib/i18n";

/**
 * 404 — one card, same as every other framed route.
 *
 * Two ways in: an unmatched URL (Next renders this inside the root layout, so
 * the rail and the field are already there) and `notFound()` from
 * `/kanban/<public id>` when the id does not decode or the project is not the
 * caller's.
 *
 * Why this file exists at all: without `app/not-found.tsx` Next falls back to
 * its built-in error page, which injects its own `body { background: #fff }`
 * (and `#000` under `prefers-color-scheme: dark`) into the document — the one
 * place in the app that painted a ground the world does not own, so a mistyped
 * URL flipped the blue field to white. Owning the markup keeps the shell's
 * ground, rail and type.
 */
export default async function NotFound() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "notFound");

    // The route register takes a path, so print the one that was asked for.
    // (`proxy.ts` tags every forwarded request with it.)
    const path = (await headers()).get("x-pathname");

    return (
        <section className="main-container">
            <div className="page">
                <PageHeader title={t("title")} path={path ?? undefined} note={t("intro")} />

                <nav className="page-actions">
                    <Link href="/kanban" className="btn">
                        {t("backToProjects")}
                    </Link>
                    <Link href="/" className="btn btn--quiet">
                        {t("home")}
                    </Link>
                </nav>
            </div>
        </section>
    );
}
