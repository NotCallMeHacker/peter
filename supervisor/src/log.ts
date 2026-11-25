/**
 * Leveled, dependency-free logger for the supervisor.
 *
 * Why this exists: every track logs through here instead of ad-hoc `console.log`,
 * so the level gate (`LOG_LEVEL`) and the `redact()` pass live in exactly one
 * place. Redaction happens *inside* the logger — a call site cannot forget it —
 * and the exported `redact()` covers the places that bypass this logger (e.g.
 * redacting an `error.message`/`StatusMessage` before it goes on the wire).
 *
 * This module is log-only: program logs must never be written to the ACP/bridge
 * wire, so nothing here formats protocol payloads and nothing imports protocol code.
 *
 * Output: one line per event — `ISO-8601 LEVEL [task:id] message key=value ...`.
 * info/debug go to stdout (console.log), warn/error to stderr (console.error),
 * so `2>` filtering by severity works without a log shipper.
 */

/** Minimum level that gets emitted; anything below is dropped. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured fields attached to a log line, e.g. `{ task: agentTaskId }`. */
export type LogFields = Record<string, unknown>;

/**
 * The shape `redact()` can return: primitives pass through, containers are rebuilt
 * with redacted children. `undefined`/`null` survive because they carry no secret.
 */
export type Redacted = string | number | boolean | bigint | null | undefined | Redacted[] | { [key: string]: Redacted };

export interface Logger {
    /** Fine-grained diagnostics; emitted only when `LOG_LEVEL=debug`. */
    debug(message: string, fields?: LogFields): void;
    /** Normal operational progress. */
    info(message: string, fields?: LogFields): void;
    /** Something recovered from / worth attention but not fatal. */
    warn(message: string, fields?: LogFields): void;
    /** A failure; goes to stderr. */
    error(message: string, fields?: LogFields): void;
    /**
     * Child logger whose lines are prefixed `[task:<id>]`. Chains:
     * `log.task("a").task("b")` → `[task:a/b]`.
     */
    task(taskId: string): Logger;
}

/** Severity order — higher number = more severe = emitted at a higher minimum level. */
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * `LOG_LEVEL` decides the minimum level. Read once at import time (env is loaded
 * before any module runs via `node --env-file`); an unknown value falls back to
 * `info` rather than throwing — a typo in an env var must not take the supervisor down.
 */
function resolveMinLevel(): number {
    const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
    const level = LEVELS.find((l) => l === raw);
    return LEVEL_ORDER[level ?? "info"];
}

let minLevel = resolveMinLevel();

/** The mask replacing any value that must never appear in a log line or on the wire. */
const MASK = "[REDACTED]";

/** Field names whose *values* are always fully masked (case-insensitive). */
const SECRET_KEY_RE =
    /api[-_]?key|ssh[-_]?key|token|passw(?:or)?d|secret|authorization|credential|private[-_]?key|askpass/i;

/** Env vars whose *values* get scrubbed out of any logged string (GIT_ASKPASS etc.). */
const SECRET_ENV_NAME_RE = /token|secret|passw(?:or)?d|credential|askpass|apikey|sshkey|auth/i;

/** Shortest env value we bother scrubbing — masking "1" or "0" would eat real data. */
const MIN_SECRET_ENV_LEN = 4;

/**
 * `key=value` / `key: value` occurrences *inside free text* where the key looks secret
 * (git commands echo `GIT_ASKPASS=...`, config dumps echo `password=...`). The value is
 * masked; the key is kept so the line still says what was hidden. The key group may carry a
 * prefix (`GIT_` in `GIT_ASKPASS`) because `\b` cannot match between `_` and a word char.
 */
const SECRET_KV_RE =
    /([A-Za-z0-9_.-]*(?:api[-_]?key|ssh[-_]?key|token|passw(?:or)?d|secret|authorization|credential|askpass))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;

/** Credentials inside a URL: `https://user:pass@host` → password masked, user kept. */
const URL_CREDENTIALS_RE = /(:\/\/)([^\s/:@]+):([^\s/@]+)@/g;

/**
 * Patterns that mark a *bare string* as an obvious secret: such a string is masked
 * in full, not partially. Provider tokens, JWTs, PEM private keys, `Bearer` headers.
 * Deliberately no generic hex/base64 rule — 40-char hex is a git SHA we want to log.
 */
const OBVIOUS_SECRET_PATTERNS: readonly RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
    /gh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub PAT (classic + fine-grained prefixes)
    /github_pat_[A-Za-z0-9_]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
    /sk-[A-Za-z0-9_-]{16,}/g, // common "sk-" API keys
    /AKIA[0-9A-Z]{16}/g, // AWS access key id
    /\bBearer\s+[A-Za-z0-9\-._~+/=]{8,}/gi,
];

/** Current secret-bearing env values; recomputed per top-level call so a runtime change is seen. */
function collectSecretEnvValues(): string[] {
    const out: string[] = [];
    for (const [name, value] of Object.entries(process.env)) {
        if (value && value.length >= MIN_SECRET_ENV_LEN && SECRET_ENV_NAME_RE.test(name)) {
            out.push(value);
        }
    }
    // Longest first so overlapping values are masked deterministically.
    return out.sort((a, b) => b.length - a.length);
}

/** Redact a string: env-value scrub, URL credentials, then whole-string masking for obvious secrets. */
function redactString(raw: string, secrets: readonly string[]): string {
    let s = raw;
    for (const secret of secrets) {
        if (s.includes(secret)) s = s.split(secret).join(MASK);
    }
    s = s.replace(URL_CREDENTIALS_RE, (_m, scheme: string, user: string) => `${scheme}${user}:${MASK}@`);
    SECRET_KV_RE.lastIndex = 0;
    s = s.replace(SECRET_KV_RE, (_m, key: string, sep: string) => `${key}${sep}${MASK}`);
    const trimmed = s.trim();
    for (const pattern of OBVIOUS_SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        const whole = pattern.exec(trimmed);
        if (whole && whole[0] === trimmed) {
            // The whole string *is* the secret (not a substring of it) → mask everything.
            return MASK;
        }
        pattern.lastIndex = 0;
        s = s.replace(pattern, MASK);
    }
    return s;
}

/** Redact the leaf kinds (string/primitive/Error) — no recursion, no cycle tracking. */
function redactLeaf(value: unknown, secrets: readonly string[]): Redacted {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value, secrets);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
    // Error messages/stacks routinely embed git URLs or tokens, so unwrap and redact them.
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactString(value.message, secrets),
            stack: redactString(value.stack ?? "", secrets),
        };
    }
    // Anything else (functions, symbols, exotic objects) → its string form, redacted too.
    return redactString(String(value), secrets);
}

function redactValue(value: unknown, secrets: readonly string[], depth: number, seen: WeakSet<object>): Redacted {
    // Leaf kinds (primitives, null/undefined, Error) resolve without recursion or cycle tracking.
    if (value === null || typeof value !== "object" || value instanceof Error) {
        return redactLeaf(value, secrets);
    }
    if (depth >= 8) return "[depth-limited]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, depth + 1, seen));
    const out: { [key: string]: Redacted } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        // Key-based masking wins: `git.token`/`git.sshKey` are "never logged" (schema doc),
        // so no value shape can leak through under a secret-looking name.
        out[key] = SECRET_KEY_RE.test(key) ? MASK : redactValue(item, secrets, depth + 1, seen);
    }
    return out;
}

/**
 * Mask secrets in any value: recursively over objects/arrays and inside strings.
 *
 * Masks by field name (`apiKey`, `sshKey`, `token`, `password`, `authorization`,
 * `secret`, `credential`, `privateKey`, `askPass` — case-insensitive, any nesting),
 * scrubs secret-bearing env values (incl. `GIT_ASKPASS`/`SSH_ASKPASS`) out of strings,
 * strips `user:pass@` credentials from URLs, and fully masks strings that are obvious
 * secrets (provider tokens, JWTs, PEM private keys). Pass every value that could reach
 * a log line or the wire through this *before* printing it.
 */
export function redact(value: unknown): Redacted {
    return redactValue(value, collectSecretEnvValues(), 0, new WeakSet<object>());
}

/** Collapse embedded newlines so one event stays one line. */
function oneLine(s: string): string {
    return s.replace(/\r?\n/g, "\\n");
}

function formatValue(key: string, value: unknown): string {
    const safeKey = key.replace(/\s+/g, "_");
    if (typeof value === "string") {
        // Quote anything with whitespace so field boundaries stay unambiguous.
        return /\s/.test(value) ? `${safeKey}=${JSON.stringify(value)}` : `${safeKey}=${value}`;
    }
    if (value === null) return `${safeKey}=null`;
    if (typeof value === "number" || typeof value === "boolean") return `${safeKey}=${value}`;
    try {
        return `${safeKey}=${JSON.stringify(value)}`;
    } catch {
        // Cyclic/throwing toJSON must not crash logging — degrade to a placeholder.
        return `${safeKey}="[unserializable]"`;
    }
}

function write(level: LogLevel, task: string | undefined, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < minLevel) return;
    const secrets = collectSecretEnvValues();

    // `fields.task` overrides the child-logger prefix — the explicit argument wins.
    let effectiveTask = task;
    let rest: LogFields | undefined = fields;
    if (fields && typeof fields.task === "string" && fields.task.length > 0) {
        effectiveTask = fields.task;
        // Rebuild without `task` — the prefix already carries it.
        rest = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "task"));
    }

    const parts: string[] = [new Date().toISOString(), level.toUpperCase()];
    if (effectiveTask) parts.push(`[task:${effectiveTask}]`);
    parts.push(oneLine(redactString(message, secrets)));
    if (rest) {
        for (const [key, value] of Object.entries(rest)) {
            // Same rules as inside `redact()`: a secret-looking *key* masks its value outright
            // (e.g. `log.info("msg", { token })` must not print the token).
            const safeValue = SECRET_KEY_RE.test(key)
                ? MASK
                : redactValue(value, secrets, 0, new WeakSet<object>()); // env secrets already collected
            parts.push(formatValue(key, safeValue));
        }
    }
    const line = parts.join(" ");

    // Split by severity: warn/error → stderr, info/debug → stdout.
    if (level === "warn" || level === "error") console.error(line);
    else console.log(line);
}

function createLogger(task: string | undefined): Logger {
    return {
        debug: (message, fields) => write("debug", task, message, fields),
        info: (message, fields) => write("info", task, message, fields),
        warn: (message, fields) => write("warn", task, message, fields),
        error: (message, fields) => write("error", task, message, fields),
        task: (taskId) => createLogger(task ? `${task}/${taskId}` : taskId),
    };
}

/** Module-level default instance: `import { log } from "./log.ts"`. */
export const log: Logger = createLogger(undefined);
