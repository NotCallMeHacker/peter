"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { MenuButton } from "./menuButton";

const locales = [
    { key: "en", label: "English" },
    { key: "de", label: "Deutsch" },
];

export function LangSwitcher({ currentLocale }: { currentLocale: string }) {
    const router = useRouter();
    const t = useTranslations("common");
    const [, startTransition] = useTransition();

    function switchLocale(locale: string) {
        document.cookie = `locale=${locale};path=/;max-age=31536000`;
        startTransition(() => {
            router.refresh();
        });
    }

    return (
        <MenuButton
            label={t("changeLanguage")}
            icon={Globe}
            value={locales.find((l) => l.key === currentLocale)?.label ?? currentLocale}
            options={locales}
            activeKey={currentLocale}
            onSelect={switchLocale}
        />
    );
}