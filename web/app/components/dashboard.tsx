import { CelebrateIcon } from "../../assets/images";
import Image from "next/image";
import { RequireSession } from "./requireSession";
import DashboardButtons from "./dashboardButtons";
import { getLocale, createServerTranslator } from "../lib/i18n";

export async function DashboardPage() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale);

    return (
        <RequireSession>
            {(accessTokenPayload) => (
                <div className="main-container">
                    <div className="top-band success-title bold-500">
                        <Image src={CelebrateIcon} alt="Login successful" className="success-icon" />{" "}
                        {t("loginSuccessful")}
                    </div>
                    <div className="inner-content">
                        <div>{t("yourUserId")}</div>
                        <div className="truncate" id="user-id">
                            {accessTokenPayload.sub}
                        </div>
                        <DashboardButtons />
                    </div>
                </div>
            )}
        </RequireSession>
    );
}
