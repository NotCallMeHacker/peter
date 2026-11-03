import EmailPassword from "supertokens-node/recipe/emailpassword";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import type { ProviderInput } from "supertokens-node/recipe/thirdparty/types";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import UserRoles from "supertokens-node/recipe/userroles";
import type { TypeInput } from "supertokens-node/types";

export function getApiDomain() {
    const apiPort = 3000;
    const apiUrl = `http://localhost:${apiPort}`;
    return apiUrl;
}

export function getWebsiteDomain() {
    const websitePort = 3000;
    const websiteUrl = `http://localhost:${websitePort}`;
    return websiteUrl;
}

export function getSuperTokensConnectionURI(): string {
    const connectionURI = process.env.SUPERTOKENS_CONNECTION_URI;
    if (!connectionURI) {
        throw new Error(
            "SUPERTOKENS_CONNECTION_URI must be set in the environment."
        );
    }
    return connectionURI;
}

export function getGithubClientId(): string {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
        throw new Error(
            "GITHUB_CLIENT_ID must be set in the environment."
        );
    }
    return clientId;
}

export function getGithubClientSecret(): string {
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientSecret) {
        throw new Error(
            "GITHUB_CLIENT_SECRET must be set in the environment."
        );
    }
    return clientSecret;
}

export const SuperTokensConfig: TypeInput = {
    supertokens: {
        connectionURI: getSuperTokensConnectionURI(),
    },
    appInfo: {
        appName: "SuperTokens Demo App",
        apiDomain: getApiDomain(),
        websiteDomain: getWebsiteDomain(),
        apiBasePath: "/api/auth/",
        websiteBasePath: "/auth",
    },
    recipeList: [
        EmailPassword.init(), // Removed, as we only want to support github login for now
        ThirdParty.init({
            signInAndUpFeature: {
                providers: [
                    {
                        config: {
                            thirdPartyId: "github",
                            clients: [
                                {
                                    clientId: getGithubClientId(),
                                    clientSecret: getGithubClientSecret(),
                                }
                            ]
                        }
                    }
                ]
            }
        }),
        Dashboard.init(),
        UserRoles.init(),
        Session.init()
    ],
};