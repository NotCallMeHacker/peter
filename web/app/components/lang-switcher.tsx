"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Globe, ChevronDown } from "lucide-react";

const locales = [
    { key: "en", label: "English" },
    { key: "de", label: "Deutsch" },
];

export function LangSwitcher({ currentLocale }: { currentLocale: string }) {
    const router = useRouter();
    const [, startTransition] = useTransition();

    function switchLocale(locale: string) {
        document.cookie = `locale=${locale};path=/;max-age=31536000`;
        startTransition(() => {
            router.refresh();
        });
    }

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className="lang-trigger" aria-label="Change language">
                <Globe size={16} />
                <span>{locales.find((l) => l.key === currentLocale)?.label ?? currentLocale}</span>
                <ChevronDown size={14} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="theme-dropdown" sideOffset={4} align="end">
                    {locales.map(({ key, label }) => (
                        <DropdownMenu.Item
                            key={key}
                            className={`theme-dropdown-item${currentLocale === key ? " active" : ""}`}
                            onSelect={() => switchLocale(key)}
                        >
                            {label}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
