"use client";

import { signOut } from "supertokens-auth-react/recipe/session";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function DashboardButtons() {
    const router = useRouter();
    const t = useTranslations();

    const callAPIClicked = async () => {
        const userInfoResponse = await fetch("http://localhost:3000/api/user");
        alert(JSON.stringify(await userInfoResponse.json()));
    };

    async function logoutClicked() {
        await signOut();
        router.push("/");
    }

    return (
        <div className="buttons">
            <button onClick={callAPIClicked} className="dashboard-button">
                {t("callAPI")}
            </button>
            <button onClick={logoutClicked} className="dashboard-button">
                {t("logout")}
            </button>
        </div>
    );
}
