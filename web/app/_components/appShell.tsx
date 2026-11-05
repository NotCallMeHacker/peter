import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "./themeToggle";
import { LangSwitcher } from "./langSwitcher";
import { SeparatorLine } from "../../assets/images";
import { ComponentWrapper } from "../config/frontend";
import { createServerTranslator, type Locale } from "../_lib/i18n";

export function AppShell({ children, locale }: { children: React.ReactNode; locale: Locale }) {
    const { t } = createServerTranslator(locale, "common");

    return (
        <div className="App app-container">
            <header>
                <nav className="header-container">
                    <Link href="/">
                        <img src="/ST.svg" alt="SuperTokens" />
                    </Link>
                    <ul className="header-container-right">
                        <li>
                            <a
                                href="https://supertokens.com/docs//"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t("docs")}
                            </a>
                        </li>
                        <li>
                            <a
                                href="https://github.com/supertokens/create-supertokens-app"
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
                <ComponentWrapper>
                    <>
                        {children}
                        <footer>
                            Built with ❤️ by the folks at{" "}
                            <a href="https://supertokens.io" target="_blank" rel="noopener noreferrer">
                                supertokens.com
                            </a>
                            .
                        </footer>
                        <Image className="separator-line" src={SeparatorLine} alt="separator" />
                    </>
                </ComponentWrapper>
            </div>
        </div>
    );
}
