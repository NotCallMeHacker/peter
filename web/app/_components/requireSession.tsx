import { redirect } from "next/navigation";
import type { SessionUser } from "@/app/_lib/auth";
import { getSession } from "../_lib/session";
import { getLocale, createServerTranslator } from "../_lib/i18n";

type Props = {
    children: React.ReactNode | ((user: SessionUser) => React.ReactNode);
};

/**
 * Server component that gates a page behind a GoTrue session.
 *
 * - Redirects to /auth when there is no (or no longer a valid) session;
 *   proxy.ts already refreshed near-expiry tokens before we get here.
 * - Renders a readable error if GoTrue itself is unreachable.
 * - Otherwise hands the verified user to the children — `user.sub` is the id
 *   the RLS policies resolve the caller from, so pages pass it as `ownerId`.
 */
export async function RequireSession({ children }: Props) {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "common");

    let session: Awaited<ReturnType<typeof getSession>>;
    try {
        session = await getSession();
    } catch (error) {
        return <div>{t("somethingWentWrong", { error: (error as Error).message })}</div>;
    }

    if (!session.user) {
        // proxy.ts redirects gated paths before a render starts, so reaching
        // here means the refresh failed mid-request — restart at /auth.
        redirect("/auth");
    }

    return <>{typeof children === "function" ? children(session.user) : children}</>;
}