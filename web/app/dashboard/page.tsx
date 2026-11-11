import { RequireSession } from "../_components/requireSession";
import { LogoutButton } from "../_components/logoutButton";
import { PageHeader } from "../_components/pageHeader";
import DashboardButtons from "./_components/dashboardButtons";
import { getLocale, createServerTranslator } from "../_lib/i18n";

export default async function Dashboard() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "dashboard");
    const { t: tCommon } = createServerTranslator(locale, "common");

    return (
        <RequireSession>
            {(user) => (
                <div className="main-container">
                    <div className="page">
                        <PageHeader
                            title={t("title")}
                            path="/dashboard"
                            note={`${t("loginSuccessful")} — ${t("yourUserId")}`}
                        />
                        <p className="meta-value">{user.sub}</p>
                        <div className="page-actions">
                            <DashboardButtons />
                            <LogoutButton label={tCommon("logout")} className="btn btn--quiet" />
                        </div>
                    </div>
                </div>
            )}
        </RequireSession>
    );
}