"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { MenuButton } from "./menuButton";

const themes = [
    { key: "system", Icon: Monitor },
    { key: "light", Icon: Sun },
    { key: "dark", Icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
    const { theme, setTheme } = useTheme();
    const t = useTranslations("theme");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const active = themes.find((th) => th.key === theme) ?? themes[0];

    return (
        <MenuButton
            className={className}
            label={t("toggle")}
            icon={mounted ? active.Icon : Sun}
            value={mounted ? t(active.key) : "..."}
            options={themes.map(({ key, Icon }) => ({ key, label: t(key), Icon }))}
            activeKey={theme ?? active.key}
            onSelect={setTheme}
            disabled={!mounted}
        />
    );
}