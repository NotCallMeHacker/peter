import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { AppShell } from "./components/app-shell";
import { getLocale, getMessages } from "./lib/i18n";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "SuperTokens + Nextjs",
    description: "SuperTokens demo app",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const locale = await getLocale();
    const messages = getMessages(locale);
    return (
        <html lang={locale} suppressHydrationWarning>
            <body className={`${inter.className} app-wrapper`}>
                <Providers locale={locale} messages={messages}>
                    <AppShell locale={locale}>{children}</AppShell>
                </Providers>
            </body>
        </html>
    );
}
