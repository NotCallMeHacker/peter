import Link from "next/link";
import { getLocale, createServerTranslator } from "./_lib/i18n";
import { getSession } from "./_lib/session";

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
            <div className="inner-content">
                <h1>
                    <strong>peter</strong> × <strong>Kanban</strong> <br /> {t("title")}
                </h1>
                <div>
                    {signedIn ? <p>{t("signedIn")}</p> : <p>{t("signIn")}</p>}
                </div>
                <nav className="buttons">
                    {signedIn ? (
                        <Link href="/kanban" className="dashboard-button">
                            {t("dashboard")}
                        </Link>
                    ) : (
                        <Link href="/auth" className="dashboard-button">
                            {t("signUpLogin")}
                        </Link>
                    )}
                </nav>
            </div>
        </section>
    );
}