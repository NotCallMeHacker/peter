"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Sign out: the route handler revokes the refresh token at GoTrue and clears
 * the cookies — cookies can only be set/cleared there (Next restriction).
 * Lives with the shell because it is shared chrome: the sidebar foot renders
 * it as a `side-row`, other surfaces can dress it as their own button.
 */
export function LogoutButton({
    label,
    className = "side-row side-logout",
}: {
    label: string;
    className?: string;
}) {
    const router = useRouter();

    async function logoutClicked() {
        try {
            await fetch("/api/auth/signout", { method: "POST" });
        } finally {
            // Same-origin app route, never a user-supplied URL.
            router.push("/");
            router.refresh();
        }
    }

    return (
        <button type="button" className={className} onClick={logoutClicked} title={label}>
            <LogOut size={15} />
            <span>{label}</span>
        </button>
    );
}