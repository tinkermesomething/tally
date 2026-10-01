# Tally

A personal budget app. Built to replace a spreadsheet that had outgrown itself — monthly category grid, a debt ledger instead of a mutable "amount owed" cell, and (as of v2.0) automatic bank transaction import.

Single user, self-hosted, LAN-only by default.

## What it does

- **Budget grid**: categories (with sub-category rollups) × months, planned vs. actually spent, carries unspent money into the next period automatically from a point you choose
- **Debt ledger**: per-person running balance from loan/repayment entries, not a cell you overwrite by hand
- **Reports**: category spend grouped and charted by year/month
- **Bank sync**: connects real accounts via GoCardless Bank Account Data, stages imported transactions for review, auto-categorizes via explicit rules + a learned-pattern fallback, flags possible duplicates against manual entries (suggestion only, never automatic)
- **Token-authed API** (see `API.md`) for a script or agent to read/write budget data without a browser session

## Stack

Next.js 15 (App Router, Turbopack) · TypeScript · Drizzle ORM + better-sqlite3 · Auth.js v5 (generic OIDC) · Tailwind · Base UI · recharts

Everything lives in one SQLite file. One container, one writer.

## Running it locally

```
npm install
npm run dev
```

Needs a `.env.local` — see the vars `auth.ts`, `lib/gocardless.ts`, and `lib/api-auth.ts` read from: OIDC issuer/client id/secret for your identity provider, `TALLY_API_TOKEN` for the machine API, `GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY` if you're touching bank sync. `DATABASE_PATH` defaults to `./config/tally.db`.

Migrations run automatically on boot (`instrumentation.ts`) — no separate migrate step needed, including in production.

## Deployment

Multi-arch image (`linux/amd64`, `linux/arm64`) built on GitHub release via `.github/workflows/release-docker.yml`, pushed to GHCR. One `docker-compose.yml`, one bind-mounted SQLite file, reverse-proxied behind your own auth-aware proxy or OIDC provider — there's no built-in rate limiting or network-layer protection, that's expected to live in front of it.

## Structure

- `app/` — routes: `grid`, `entries`, `debt`, `reports`, `review` (bank-sync queue), `settings`, `api/v1` (the token API)
- `lib/db/` — schema + all query/mutation logic, one file per domain (`queries.ts`, `debt.ts`, `bank-sync.ts`, `settings.ts`)
- `lib/gocardless.ts` — the bank-sync API client
- `components/` — grouped by the route that owns them, plus `ui/` for the shared primitives

Money is always stored as integer pence, never float.
