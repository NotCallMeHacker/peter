"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function DashboardButtons() {
    const router = useRouter();
    const t = useTranslations("dashboard");
    const tCommon = useTranslations("common");

    const callAPIClicked = async () => {
        const userInfoResponse = await fetch("/api/user");
        alert(JSON.stringify(await userInfoResponse.json()));
    };

    async function logoutClicked() {
        try {
            await fetch("/api/auth/signout", { method: "POST" });
        } finally {
            router.push("/");
            router.refresh();
        }
    }

    return (
        <div className="buttons">
            <button onClick={callAPIClicked} className="dashboard-button">
                {t("callAPI")}
            </button>
            <button onClick={logoutClicked} className="dashboard-button">
                {tCommon("logout")}
            </button>
        </div>
    );
}