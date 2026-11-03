import { cookies } from "next/headers";
import { TryRefreshComponent } from "../components/tryRefreshClientComponent";
import { redirect } from "next/navigation";
import { SessionAuthForNextJS } from "../components/sessionAuthForNextJS";
import { getSessionForSSR } from "../util";
import { getLocale, createServerTranslator } from "../lib/i18n";

export default async function KanbanPage() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale);
    const cookiesFromReq = await cookies();
    const cookiesArray: Array<{ name: string; value: string }> = Array.from(cookiesFromReq.getAll()).map(
        ({ name, value }) => ({
            name,
            value,
        })
    );
    const { accessTokenPayload, hasToken, error } = await getSessionForSSR(cookiesArray);

    if (error) {
        return <div>{t("somethingWentWrong", { error: error.message })}</div>;
    }

    if (accessTokenPayload === undefined) {
        if (!hasToken) {
            return redirect("/auth");
        }

        return <TryRefreshComponent key={Date.now()} />;
    }

    return (
        <SessionAuthForNextJS>
            <div className="main-container">
                <h1>{t("kanbanTitle")}</h1>
            </div>
        </SessionAuthForNextJS>
    );
}
