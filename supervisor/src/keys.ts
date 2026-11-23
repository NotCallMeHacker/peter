/**
 * This instance's Ed25519 identity.
 *
 * On first boot the keypair is generated locally and persisted as a JWK file
 * (0600) next to a public entry (0644) that B's registry can serve. The
 * private key never leaves this machine — authentication is "sign B's
 * challenge", not "send a secret". Public entries land in the shared
 * registry directory so B (the web bridge) can verify without a round trip
 * to anywhere else; the Supabase `app."RunnerInstances"` table is canonical
 * once an instance has been provisioned through the dashboard's edge
 * function (revocation always wins — see web/server/bridge/registry.ts).
 *
 * Key file format (JWK, OKP/Ed25519):
 *   { "kty": "OKP", "crv": "Ed25519", "d": "<seed b64url>", "x": "<pub b64url>" }
 * The seed `d` is the whole private key; the edge function returns the same
 * shape so dashboard-provisioned and self-generated instances match.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrivateKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import type { Config } from "./config.ts";

/** Ed25519 JWK as this project stores it (all fields required). */
export interface Ed25519Jwk {
    kty: "OKP";
    crv: "Ed25519";
    d: string;
    x: string;
    /** Structural index signature: required to assign to Node's JsonWebKey. */
    [key: string]: unknown;
}

export interface InstanceKeys {
    /** Private key object for signing challenges. */
    privateKey: KeyObject;
    /** Raw public key, base64url — the registry/DB identity string. */
    publicKey: string;
}

/**
 * Load this instance's keypair, creating it on first boot.
 * Returns the signing key + the public identity string B verifies against.
 */
export function ensureKeys(config: Config): InstanceKeys {
    mkdirSync(config.registryDir, { recursive: true, mode: 0o700 });
    const keyPath = resolve(config.registryDir, `${config.instanceId}.key.json`);
    const entryPath = resolve(config.registryDir, `${config.instanceId}.json`);

    let jwk: Ed25519Jwk;
    if (existsSync(keyPath)) {
        const parsed = JSON.parse(readFileSync(keyPath, "utf8")) as Ed25519Jwk;
        if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519" || !parsed.d || !parsed.x) {
            throw new Error(`${keyPath} is not an OKP/Ed25519 JWK`);
        }
        jwk = parsed;
    } else {
        const { privateKey, publicKey } = generateKeyPairSync("ed25519");
        const priv = privateKey.export({ format: "jwk" });
        const pub = publicKey.export({ format: "jwk" });
        if (!priv.d || !pub.x) throw new Error("unexpected JWK export from generateKeyPairSync");
        jwk = { kty: "OKP", crv: "Ed25519", d: priv.d, x: pub.x };
        writeFileSync(keyPath, JSON.stringify(jwk, null, 2), { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        console.info(`[keys] generated Ed25519 keypair for "${config.instanceId}" at ${keyPath}`);
    }

    const entryPathExisting = existsSync(entryPath);
    const previous = entryPathExisting
        ? (JSON.parse(readFileSync(entryPath, "utf8")) as { createdAt?: string })
        : undefined;
    const entry = {
        id: config.instanceId,
        publicKey: jwk.x,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        source: "self" as const,
    };
    // Public entry: B's registry fallback for instances that exist only locally.
    writeFileSync(entryPath, JSON.stringify(entry, null, 2), { mode: 0o644 });

    return {
        privateKey: createPrivateKey({ key: jwk, format: "jwk" }),
        publicKey: jwk.x,
    };
}

/** Sign an arbitrary buffer (B's challenge nonce) with this instance's key. */
export function signChallenge(keys: InstanceKeys, nonce: Buffer): string {
    return sign(null, nonce, keys.privateKey).toString("base64");
}
