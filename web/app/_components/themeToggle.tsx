"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Monitor, Moon, Sun, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

const themes = [
    { key: "system", Icon: Monitor },
    { key: "light", Icon: Sun },
    { key: "dark", Icon: Moon },
] as const;

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const t = useTranslations("theme");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <button className="theme-trigger" disabled aria-label={t("toggle")}>
                <Sun size={16} />
                <span>...</span>
                <ChevronDown size={14} />
            </button>
        );
    }

    const active = themes.find((th) => th.key === theme) ?? themes[0];
    const ActiveIcon = active.Icon;

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className="theme-trigger" aria-label={t("toggle")}>
                <ActiveIcon size={16} />
                <span>{t(active.key)}</span>
                <ChevronDown size={14} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="theme-dropdown" sideOffset={4} align="end">
                    {themes.map(({ key, Icon }) => (
                        <DropdownMenu.Item
                            key={key}
                            className={`theme-dropdown-item${theme === key ? " active" : ""}`}
                            onSelect={() => setTheme(key)}
                        >
                            <Icon size={14} />
                            {t(key)}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
