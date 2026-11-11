"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function LogoutButton({ label }: { label: string }) {
    const router = useRouter();

    async function logoutClicked() {
        // Route handler revokes the refresh token at GoTrue and clears the
        // cookies — cookies can only be set/cleared there (Next restriction).
        try {
            await fetch("/api/auth/signout", { method: "POST" });
        } finally {
            // Same-origin app route, never a user-supplied URL.
            router.push("/");
            router.refresh();
        }
    }

    return (
        <button type="button" className="side-row side-logout" onClick={logoutClicked} title={label}>
            <LogOut size={15} />
            <span>{label}</span>
        </button>
    );
}