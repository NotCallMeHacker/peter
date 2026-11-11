import Link from "next/link";
import { getLocale, createServerTranslator } from "./_lib/i18n";
import { getSession } from "./_lib/session";
import { PageHeader } from "./_components/pageHeader";

/**
 * Demo heritage landing page (PRODUCT.md: scaffold history, not product truth).
 * Points at the two surfaces that matter: /kanban when signed in, /auth when not.
 * Not gated — a logged-out visitor just sees the sign-in call to action.
 */
export default async function Home() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "home");

    let signedIn = false;
    try {
        signedIn = (await getSession()).user !== null;
    } catch {
        // GoTrue unreachable: treat as signed out rather than erroring the page.
    }

    return (
        <section className="main-container">
            <div className="page">
                <PageHeader
                    title="peter × Kanban"
                    path="/"
                    note={signedIn ? t("signedIn") : t("signIn")}
                />
                <nav className="page-actions">
                    {signedIn ? (
                        <Link href="/kanban" className="btn">
                            {t("dashboard")}
                        </Link>
                    ) : (
                        <Link href="/auth" className="btn">
                            {t("signUpLogin")}
                        </Link>
                    )}
                </nav>
            </div>
        </section>
    );
}