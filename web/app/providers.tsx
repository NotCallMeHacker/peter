"use client";

import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { SuperTokensProvider } from "./components/supertokensProvider";

type ProvidersProps = {
  children: React.ReactNode;
  locale: string;
  messages: Record<string, string>;
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
