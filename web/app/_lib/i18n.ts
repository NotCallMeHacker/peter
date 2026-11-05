import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "next-intl";
import { cookies } from "next/headers";
import enMessages from "../../messages/en.json";
import deMessages from "../../messages/de.json";

export type Messages = typeof enMessages;

const messagesMap = {
    en: enMessages,
    de: deMessages,
} satisfies Record<string, Messages>;

export type Locale = keyof typeof messagesMap;
export type MessageNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

const defaultLocale: Locale = "en";

function isLocale(value: string | undefined): value is Locale {
    return value !== undefined && value in messagesMap;
}

export async function getLocale(): Promise<Locale> {
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get("locale")?.value;
    return isLocale(localeCookie) ? localeCookie : defaultLocale;
}

export function getMessages(locale: Locale): Messages {
    return messagesMap[locale] ?? messagesMap[defaultLocale];
}

export function createServerTranslator<N extends MessageNamespace = never>(locale: Locale, namespace?: N) {
    const messages = getMessages(locale);
    return {
        t: createTranslator({ locale, messages, namespace }),
        locale,
        messages,
    };
}
