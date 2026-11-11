import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "./providers";
import { AppShell } from "./_components/appShell";
import { getLocale, getMessages } from "./_lib/i18n";

export const metadata: Metadata = {
    title: "peter — Kanban",
    description: "Kanban boards for teams — peter",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const locale = await getLocale();
    const messages = getMessages(locale);
    return (
        <html lang={locale} suppressHydrationWarning>
            <body className="app-wrapper">
                <Providers locale={locale} messages={messages}>
                    <AppShell locale={locale}>{children}</AppShell>
                </Providers>
            </body>
        </html>
    );
}
