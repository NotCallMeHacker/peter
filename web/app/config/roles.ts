import UserRoles from "supertokens-node/recipe/userroles";

export async function createRole(params: { name: string, permissions?: string[] }) {
    const { name } = params;
    const permissions = params.permissions ?? [];
    const result = await UserRoles.createNewRoleOrAddPermissions(name, permissions);
    if (result.status === "OK" && result.createdNewRole) {
        return { created: result.createdNewRole };
    } else {
        throw new Error("Failed to create role");
    }
}

export async function getRole(params: { name: string }) {
    const { name } = params;
    const roles = await UserRoles.getAllRoles();
    const role = roles.roles.find((role) => role === name);
    if (role) {
        return role;
    } else {
        throw new Error("Role not found");
    }
}

export async function getOrCreateRole(params: { name: string, permissions?: string[] }) {
    const { name, permissions } = params;
    try {
        const role = await getRole({ name });
        return role;
    } catch (error) {
        if (error instanceof Error && error.message === "Role not found") {
            const newRole = await createRole({ name, permissions });
            return newRole;
        } else {
            throw error;
        }
    }
}

export async function init() {
    try {
        await getOrCreateRole({ name: "admin" })
        await getOrCreateRole({ name: "user" })
        console.info({ component: "SuperTokens" }, "SuperTokens.init.roles.success")
    } catch (error) {
        console.error({ component: "SuperTokens" }, "SuperTokens.init.roles.error", error)
    }
}
