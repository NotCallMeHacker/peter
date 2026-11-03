"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Monitor, Moon, Sun, ChevronDown } from "lucide-react";

const themes = [
    { key: "system", label: "System", Icon: Monitor },
    { key: "light", label: "Light", Icon: Sun },
    { key: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <button className="theme-trigger" disabled aria-label="Toggle theme">
                <Sun size={16} />
                <span>...</span>
                <ChevronDown size={14} />
            </button>
        );
    }

    const active = themes.find((t) => t.key === theme) ?? themes[0];
    const ActiveIcon = active.Icon;

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className="theme-trigger" aria-label="Toggle theme">
                <ActiveIcon size={16} />
                <span>{active.label}</span>
                <ChevronDown size={14} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="theme-dropdown" sideOffset={4} align="end">
                    {themes.map(({ key, label, Icon }) => (
                        <DropdownMenu.Item
                            key={key}
                            className={`theme-dropdown-item${theme === key ? " active" : ""}`}
                            onSelect={() => setTheme(key)}
                        >
                            <Icon size={14} />
                            {label}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
