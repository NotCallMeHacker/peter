import Link from "next/link";
import { ThemeToggle } from "./themeToggle";
import { LangSwitcher } from "./langSwitcher";
import { createServerTranslator, type Locale } from "../_lib/i18n";

/**
 * Top bar + page frame for every route. The chrome is brand-neutral now that
 * SuperTokens is gone: the wordmark points home, and the nav keeps the docs
 * links (repo + Next.js docs) with theme and language toggles.
 */
export function AppShell({ children, locale }: { children: React.ReactNode; locale: Locale }) {
    const { t } = createServerTranslator(locale, "common");

    return (
        <div className="App app-container">
            <header>
                <nav className="header-container">
                    <Link href="/" className="brand-mark" aria-label="peter">
                        peter
                    </Link>
                    <ul className="header-container-right">
                        <li>
                            <a
                                href="https://nextjs.org/docs"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t("docs")}
                            </a>
                        </li>
                        <li>
                            <a
                                href="https://github.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t("cliRepo")}
                            </a>
                        </li>
                        <li>
                            <ThemeToggle />
                        </li>
                        <li>
                            <LangSwitcher currentLocale={locale} />
                        </li>
                    </ul>
                </nav>
            </header>
            <div className="fill" id="home-container">
                {children}
                <footer>
                    Built with ❤️ · Supabase Auth · Next.js
                </footer>
            </div>
        </div>
    );
}