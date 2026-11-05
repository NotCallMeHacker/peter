import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { JwtPayload } from "jsonwebtoken";
import { TryRefreshComponent } from "./tryRefreshClientComponent";
import { SessionAuthForNextJS } from "./sessionAuthForNextJS";
import { getSessionForSSR } from "../_lib/util";
import { getLocale, createServerTranslator } from "../_lib/i18n";

type Props = {
    children: React.ReactNode | ((payload: JwtPayload) => React.ReactNode);
};

/**
 * Server component that gates a page behind an active session.
 *
 * - Renders an error message if the token could not be verified.
 * - Redirects to /auth if the user has no session token at all.
 * - Renders TryRefreshComponent if a token exists but is expired,
 *   so the client can refresh and retry.
 * - Otherwise wraps the children in SessionAuthForNextJS for
 *   client-side session enforcement.
 */
export async function RequireSession({ children }: Props) {
    const locale = await getLocale();
    const { t } = createServerTranslator(locale, "common");
    const cookiesFromReq = await cookies();
    const cookiesArray: Array<{ name: string; value: string }> = Array.from(cookiesFromReq.getAll()).map(
        ({ name, value }) => ({
            name,
            value,
        })
    );
    const { accessTokenPayload, hasToken, error } = await getSessionForSSR(cookiesArray);

    if (error) {
        return <div>{t("somethingWentWrong", { error: error.message })}</div>;
    }

    if (accessTokenPayload === undefined) {
        if (!hasToken) {
            redirect("/auth");
        }

        return <TryRefreshComponent key={Date.now()} />;
    }

    return (
        <SessionAuthForNextJS>
            {typeof children === "function" ? children(accessTokenPayload) : children}
        </SessionAuthForNextJS>
    );
}