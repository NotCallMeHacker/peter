import { CelebrateIcon } from "../../assets/images";
import Image from "next/image";
import { RequireSession } from "../_components/requireSession";
import DashboardButtons from "./_components/dashboardButtons";
import { getLocale, createServerTranslator } from "../_lib/i18n";

export default async function Dashboard() {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "dashboard");

    return (
        <RequireSession>
            {(user) => (
                <div className="main-container">
                    <div className="top-band success-title bold-500">
                        <Image src={CelebrateIcon} alt="Login successful" className="success-icon" />{" "}
                        {t("loginSuccessful")}
                    </div>
                    <div className="inner-content">
                        <div>{t("yourUserId")}</div>
                        <div className="truncate" id="user-id">
                            {user.sub}
                        </div>
                        <DashboardButtons />
                    </div>
                </div>
            )}
        </RequireSession>
    );
}
