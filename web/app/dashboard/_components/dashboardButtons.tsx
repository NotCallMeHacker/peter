"use client";

import { useTranslations } from "next-intl";

export default function DashboardButtons() {
    const t = useTranslations("dashboard");

    const callAPIClicked = async () => {
        const userInfoResponse = await fetch("/api/user");
        alert(JSON.stringify(await userInfoResponse.json()));
    };

    return (
        <button onClick={callAPIClicked} className="btn">
            {t("callAPI")}
        </button>
    );
}