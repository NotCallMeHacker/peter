"use client";

import { signOut } from "supertokens-auth-react/recipe/session";
import { LogOut } from "lucide-react";

export function LogoutButton({ label }: { label: string }) {
    async function logoutClicked() {
        await signOut();
        window.location.href = "/";
    }

    return (
        <button type="button" className="side-row side-logout" onClick={logoutClicked} title={label}>
            <LogOut size={15} />
            <span>{label}</span>
        </button>
    );
}
