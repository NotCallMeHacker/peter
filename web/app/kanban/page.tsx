import { RequireSession } from "../_components/requireSession";
import { getLocale, createServerTranslator } from "../_lib/i18n";

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
