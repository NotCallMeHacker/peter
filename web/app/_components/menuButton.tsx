"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * One button + dropdown shell for every selector in the app (theme, language…).
 * Rendering is split into small, styled parts so a consumer can dress the whole
 * control through the parent (e.g. the sidebar's foot rules):
 * - trigger — the button itself
 * - trigger icon / current value / chevron — its three children
 * - panel — the popover surface
 * - item — one option row
 */
export type MenuButtonProps = {
    /** aria-label for the trigger, e.g. "Change language". */
    label: string;
    /** Lucide icon rendered first inside the trigger. */
    icon: LucideIcon;
    /** Text of the currently selected option. */
    value: string;
    options: readonly { key: string; label: string; Icon?: LucideIcon }[];
    activeKey: string;
    onSelect: (key: string) => void;
    disabled?: boolean;
};

export function MenuButton({
    label,
    icon: Icon,
    value,
    options,
    activeKey,
    onSelect,
    disabled,
}: MenuButtonProps) {
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className="menu-trigger" aria-label={label} disabled={disabled}>
                <Icon size={16} className="menu-trigger-icon" />
                <span className="menu-trigger-value">{value}</span>
                <ChevronDown size={14} className="menu-trigger-chevron" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-panel" sideOffset={4} align="end">
                    {options.map(({ key, label: optionLabel, Icon: OptionIcon }) => (
                        <DropdownMenu.Item
                            key={key}
                            className={"menu-item" + (activeKey === key ? " menu-item--on" : "")}
                            onSelect={() => onSelect(key)}
                        >
                            {OptionIcon && <OptionIcon size={14} />}
                            {optionLabel}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}