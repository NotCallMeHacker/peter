import { RequireSession } from "../components/requireSession";
import { getLocale, createServerTranslator } from "../lib/i18n";

export default async function KanbanPage() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale);

    return (
        <RequireSession>
            <div className="main-container">
                <h1>{t("kanbanTitle")}</h1>
            </div>
        </RequireSession>
    );
}
