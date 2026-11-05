"use client";

import { signOut } from "supertokens-auth-react/recipe/session";
import { LogOut } from "lucide-react";

export function LogoutButton({ label }: { label: string }) {
    async function logoutClicked() {
        await signOut();
        window.location.href = "/";
    }

    return (
        <button type="button" className="kb-side__btn" onClick={logoutClicked} title={label}>
            <LogOut size={15} />
            <span>{label}</span>
        </button>
    );
}
