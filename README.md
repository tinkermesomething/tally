# Tally

A personal budget app. Built to replace a spreadsheet that had outgrown itself — monthly category grid, a debt ledger instead of a mutable "amount owed" cell, and (as of v2.0) automatic bank transaction import.

Multi-user, self-hosted, LAN-only by default. Each account's data lives in its own encrypted SQLite file, unlocked automatically by their own OIDC login — nobody, including an admin, can read another account's data without their key.

## Screenshots

| | |
|---|---|
| ![Budget grid comparison report](docs/screenshots/08-reports-compare.png) | ![Spend trend](docs/screenshots/11-reports-trend.png) |
| ![Account settings](docs/screenshots/03-account-settings.png) | ![Bank sync](docs/screenshots/02-bank-sync.png) |
| ![Auto-categorization rules](docs/screenshots/04-rules.png) | ![Admin panel](docs/screenshots/01-admin.png) |
| ![Savings buckets](docs/screenshots/07-savings.png) | ![Logged entries](docs/screenshots/06-entries.png) |

Figures in the Reports screenshots are blurred; everything else is a real (anonymized) instance.

## What it does

- **Budget grid**: categories (with sub-category rollups) × months, planned vs. actually spent, carries unspent money into the next period automatically from a point you choose
- **Debt ledger**: per-person running balance from loan/repayment entries, not a cell you overwrite by hand
- **Savings buckets**: goal + target date per bucket, deposits/withdrawals, optionally auto-funded from a linked category
- **Reports**: category spend grouped and charted by year/month, exportable to PDF (landscape by default) for the whole page or a single panel
- **Bank sync**: connects real accounts via GoCardless Bank Account Data (your own API credentials, set per-account in Settings), stages imported transactions for review, auto-categorizes via explicit rules + a learned-pattern fallback, flags possible duplicates against manual entries (suggestion only, never automatic); unsettled pending transactions can be "pencilled in" as a guess before they clear
- **CSV import**: for accounts not on GoCardless, or backfilling history
- **Backups**: automatic scheduled backups (admin-configured folder/password), plus every account gets its own scoped "download/restore my data" pair
- **Accounts**: invite people by email; admin status comes from an OIDC group claim (with a bootstrap-email fallback so a group misconfiguration can never lock every admin out), disable or permanently delete an account, re-link a broken OIDC identity
- **Token-authed API** (see `API.md`) for a script or agent to read/write budget data without a browser session

## Stack

Next.js 15 (App Router, Turbopack) · TypeScript · Drizzle ORM + better-sqlite3 (SQLCipher-compatible fork) · Auth.js v5 (generic OIDC) · Tailwind · Base UI · recharts

One container, one SQLite file per account - each encrypted with a key sealed to that account's own OIDC identity, plus a small shared, unencrypted keystore file (just account metadata: email, admin status, which login unlocks which file - never budget data).

## Running it locally

```
npm install
npm run dev
```

Needs a `.env.local`:

- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` — your identity provider (pocket-id by default; needs a `groups` claim if you want OIDC-group-based admins)
- `ALLOWED_EMAIL` — the one address allowed to bootstrap the first (admin) account
- `ALLOWED_HOSTS` — comma-separated hostnames this app answers for; defaults to `tally.home.internal,tally.angelsomething.com` (change this)
- `AUTH_SECRET` — also seals every account's own encryption key, treat it like any other production secret
- `TALLY_API_TOKEN` — the machine API's bearer token
- `GOCARDLESS_REDIRECT_URL` — where GoCardless redirects back to after a bank's consent step (GoCardless credentials themselves are no longer an env var - each account sets its own in Settings → Bank sync)
- `DATABASE_PATH` — defaults to `./config/tally.db`; `USERS_DB_DIR` defaults to a `users/` folder next to it
- `BACKUP_DIR` / `BACKUP_PASSWORD` — optional, for the automatic scheduled backup; `APP_TIMEZONE` controls when it runs (defaults to `Europe/London`)

Migrations run automatically on boot (`instrumentation.ts`) — no separate migrate step needed, including in production.

## Deployment

Multi-arch image (`linux/amd64`, `linux/arm64`) built on GitHub release via `.github/workflows/release-docker.yml`, pushed to GHCR. One `docker-compose.yml`, one bind-mounted data directory (the shared keystore file plus a `users/` folder of per-account encrypted files), reverse-proxied behind your own auth-aware proxy or OIDC provider — there's no built-in rate limiting or network-layer protection, that's expected to live in front of it.

## Structure

- `app/` — routes: `grid`, `entries`, `debt`, `reports`, `review` (bank-sync queue), `settings` (account, bank sync, categories, rules, admin), `api/v1` (the token API)
- `lib/db/` — schema + all query/mutation logic, one file per domain (`queries.ts`, `debt.ts`, `bank-sync.ts`, `settings.ts`, `users.ts`); `context.ts`/`pool.ts`/`connection.ts` resolve which account's encrypted file the current request sees
- `lib/gocardless.ts` — the bank-sync API client
- `components/` — grouped by the route that owns them, plus `ui/` for the shared primitives

Money is always stored as integer pence, never float.
