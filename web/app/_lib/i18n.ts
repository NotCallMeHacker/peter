import { createTranslator } from "next-intl";
import { cookies } from "next/headers";
import enMessages from "../../messages/en.json";
import deMessages from "../../messages/de.json";

export type Messages = typeof enMessages;

const defaultLocale = "en";
const supportedLocales = ["en", "de"];

const messagesMap: Record<string, Messages> = {
    en: enMessages,
    de: deMessages,
};

export async function getLocale(): Promise<string> {
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get("locale")?.value;
    if (localeCookie && supportedLocales.includes(localeCookie)) {
        return localeCookie;
    }
    return defaultLocale;
}

export function getMessages(locale: string): Messages {
    return messagesMap[locale] ?? messagesMap[defaultLocale];
}

export function createServerTranslator(locale: string) {
    const messages = getMessages(locale);
    return {
        t: createTranslator({ locale, messages }),
        locale,
        messages,
    };
}
