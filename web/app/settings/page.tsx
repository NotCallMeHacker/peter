import { RequireSession } from "../_components/requireSession";
import { PageHeader } from "../_components/pageHeader";
import { ThemeToggle } from "../_components/themeToggle";
import { LangSwitcher } from "../_components/langSwitcher";
import { getLocale, createServerTranslator } from "../_lib/i18n";

/**
 * /settings — the sidebar's Account entry points here. Same card as the
 * dashboard; the controls themselves are the shared MenuButton consumers
 * (the header's copy was removed, so their home is this page).
 */
export default async function Settings() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "settings");

    return (
        <RequireSession>
            {() => (
                <div className="main-container">
                    <div className="page">
                        <PageHeader title={t("title")} path="/settings" note={t("intro")} />
                        <div className="settings-list">
                            <div className="settings-row">
                                <span>{t("theme")}</span>
                                <ThemeToggle />
                            </div>
                            <div className="settings-row">
                                <span>{t("language")}</span>
                                <LangSwitcher currentLocale={locale} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </RequireSession>
    );
}