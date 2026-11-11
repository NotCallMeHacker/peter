# peter — web app

Next.js (App Router) app for **peter**: kanban boards over a self-hosted Supabase
stack. This repo was bootstrapped from the upstream SuperTokens + Next.js demo
and has since been migrated off SuperTokens — auth is **Supabase Auth (GoTrue)**.

## How a request works

1. **Sign in** at `/auth` (email + password, or GitHub/Google via OAuth) — a
   client form posts to `POST /api/auth/signin` (or `/signup`), the route
   handler exchanges the credentials with GoTrue and stores the session in two
   httpOnly cookies (`sb-access-token`, `sb-refresh-token`). Cookies can only be
   set from a route handler/server action, which is why these endpoints exist.
2. **`proxy.ts`** (Next 16's middleware) refreshes a near-expiry access token
   server-side and redirects unauthenticated visitors away from gated paths
   (`/kanban`, `/dashboard`).
3. **Pages** call `RequireSession`, which resolves the cookie into a verified
   `SessionUser`; `user.sub` (the account uuid) becomes the `ownerId` every
   board read is scoped to.
4. **Reads** go server→PostgREST with the GoTrue access token
   (`app/_lib/db.ts` → `appSchema()`). Row Level Security on the `app` schema
   resolves the caller from the token's `sub`, so a query that forgets a filter
   returns nothing instead of somebody else's rows. The browser never talks to
   PostgREST directly, and the app holds no JWT signing secret.

## Layout

```
app/
├── proxy.ts                 # token refresh + auth redirects (middleware successor)
├── auth/[[...path]]/        # /auth — custom sign-in / sign-up form (+ auth.css)
├── api/
│   ├── auth/                # signin, signup, signout, refresh, oauth, callback
│   └── user/                # current session as JSON
├── kanban/                  # project picker (/kanban) + board (/kanban/[id])
├── dashboard/               # session/debug surface
├── _lib/                    # auth, session, db (PostgREST), kanbanRepo, i18n, idConversion
└── _components/             # appShell, requireSession, sidebar, toggles
db/                          # Sequelize models, migrations, seeders (host-run CLI)
```

## Local development

```bash
# 1. stack (Supabase incl. GoTrue, Postgres, gateway) — from the repo root
docker compose up -d

# 2. web app, dev server on :3000
cd web && npm install && npm run dev

# migrations + sample boards (host-side, needs DB_* in the root .env)
npm run db:migrate
bash .agents/dbq.sh "$(cat db/seeders/kanban-sample-data.sql)"
```

Configuration lives in `web/.env` (see `web/.env.example`) and `supabase/.env`.
GoTrue needs `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` in the root `.env` for
GitHub sign-in, and `ENABLE_EMAIL_AUTOCONFIRM=true` in `supabase/.env` if you
don't run a mail catcher for signup confirmation.