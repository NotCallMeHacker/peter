"use client";

import Link from "next/link";
import { useSessionContext } from "supertokens-auth-react/recipe/session";
import { useTranslations } from "next-intl";

export default function Home() {
    const session = useSessionContext();
    const t = useTranslations("home");

    if (session.loading) {
        return null;
    }

    return (
        <>
            <section className="logos">
                <img src="/ST.svg" alt="SuperTokens" />
                <span>x</span>
                <img src="/next.svg" alt="Next" />
            </section>
            <section className="main-container">
                <div className="inner-content">
                    <h1>
                        <strong>SuperTokens</strong> x <strong>Next.js</strong> <br /> {t("title")}
                    </h1>
                    <div>
                        {session.doesSessionExist ? <p>{t("signedIn")}</p> : <p>{t("signIn")}</p>}
                    </div>
                    <nav className="buttons">
                        {session.doesSessionExist ? (
                            <Link href="/dashboard" className="dashboard-button">
                                {t("dashboard")}
                            </Link>
                        ) : (
                            <Link href="/auth" className="dashboard-button">
                                {t("signUpLogin")}
                            </Link>
                        )}
                    </nav>
                </div>
            </section>
        </>
    );
}
