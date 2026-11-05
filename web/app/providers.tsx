"use client";

import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { SuperTokensProvider } from "./_components/supertokensProvider";
import type { Locale, Messages } from "./_lib/i18n";

type ProvidersProps = {
    children: React.ReactNode;
    locale: Locale;
    messages: Messages;
};

export function Providers({ children, locale, messages }: ProvidersProps) {
    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <SuperTokensProvider>{children}</SuperTokensProvider>
            </ThemeProvider>
        </NextIntlClientProvider>
    );
}
