"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import "./auth.css";

/** Only same-origin absolute paths are honoured as post-login targets. */
function safeNext(raw: string | null): string {
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
    return "/kanban";
}

function AuthForm() {
    const t = useTranslations("auth");
    const router = useRouter();
    const search = useSearchParams();

    const next = safeNext(search.get("next"));
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(search.get("error"));
    const [confirmSent, setConfirmSent] = useState(false);
    const [busy, setBusy] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(mode === "signin" ? "/api/auth/signin" : "/api/auth/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data: { error?: string; requiresConfirmation?: boolean } = await response
                .json()
                .catch(() => ({}));
            if (!response.ok) {
                setError(data.error ?? t("networkError"));
                return;
            }
            if (data.requiresConfirmation) {
                setConfirmSent(true);
                return;
            }
            // Session cookies are set — proxy.ts guards the destination from here.
            router.push(next);
            router.refresh();
        } catch {
            setError(t("networkError"));
        } finally {
            setBusy(false);
        }
    }

    const oauth = (provider: string) => `/api/auth/oauth?provider=${provider}&next=${encodeURIComponent(next)}`;

    return (
        <section className="main-container">
            <div className="auth">
                <div className="auth-head">
                    <span className="auth-mark" aria-hidden="true">
                        peter
                    </span>
                    <h1>{mode === "signin" ? t("signInTitle") : t("signUpTitle")}</h1>
                    <p className="auth-intro">{t("intro")}</p>
                </div>

                <div className="auth-tabs" role="tablist" aria-label={t("signInTitle")}>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "signin"}
                        className={mode === "signin" ? "is-active" : ""}
                        onClick={() => {
                            setMode("signin");
                            setError(null);
                        }}
                    >
                        {t("tabSignIn")}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "signup"}
                        className={mode === "signup" ? "is-active" : ""}
                        onClick={() => {
                            setMode("signup");
                            setError(null);
                        }}
                    >
                        {t("tabSignUp")}
                    </button>
                </div>

                {error ? (
                    <p className="auth-error" role="alert">
                        {error}
                    </p>
                ) : null}
                {confirmSent ? <p className="auth-note">{t("confirmationSent")}</p> : null}

                <form className="auth-form" onSubmit={submit}>
                    <label className="auth-field">
                        <span>{t("email")}</span>
                        <input
                            type="email"
                            required
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                        />
                    </label>
                    <label className="auth-field">
                        <span>
                            {t("password")}
                            {mode === "signup" ? <em>{t("passwordHint")}</em> : null}
                        </span>
                        <input
                            type="password"
                            required
                            minLength={mode === "signup" ? 8 : 1}
                            autoComplete={mode === "signin" ? "current-password" : "new-password"}
                            placeholder="••••••••"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                    </label>
                    <button type="submit" className="auth-submit" disabled={busy}>
                        {busy
                            ? t("working")
                            : mode === "signin"
                              ? t("submitSignIn")
                              : t("submitSignUp")}
                    </button>
                </form>

                <div className="auth-divider" aria-hidden="true">
                    <span>{t("or")}</span>
                </div>

                <div className="auth-oauth">
                    <a className="auth-oauth-btn" href={oauth("github")}>
                        {t("continueWith")} GitHub
                    </a>
                    <a className="auth-oauth-btn" href={oauth("google")}>
                        {t("continueWith")} Google
                    </a>
                </div>
            </div>
        </section>
    );
}

export default function Auth() {
    return (
        <Suspense fallback={null}>
            <AuthForm />
        </Suspense>
    );
}