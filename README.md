# LedgerPro — Finance & Collection Manager

A mobile-first loan and collection manager for a private finance business: who has
the money, what interest is due, what was collected, and what is still owed.

> Current state, decisions and open questions: [PROJECT-STATUS.md](PROJECT-STATUS.md).
> How money is worked out, and what the client has not yet confirmed:
> [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md).

The screens are the prototype the client approved (tag `prototype-approved-v1`).
The design is frozen; this repository makes it real.

## Architecture

```
Browser (Next.js static site on Cloudflare Pages)
   │  signs in, reads, calls database functions
   ▼
Supabase: Postgres (data + rules) · Auth (logins) · Storage (private files)
   │  nightly, encrypted
   ▼
Private GitHub repository (backups)
```

- **No server of our own.** The site is static files. The browser talks to Supabase
  with the public key; what a user may see or change is enforced by the database
  (Row Level Security), not by the app.
- **Money is whole paise** everywhere (integers), never decimals.
- **One place works money out:** `src/lib/finance/engine.ts`, with unit tests.
- **The database saves it safely.** Money tables cannot be written from the browser.
  Every change goes through a database function that locks the loan, checks the
  engine's result, and saves all of it or none of it. A payment carries a one-time
  key, so a double tap or a retry never records it twice.
- **History is kept.** A recorded payment cannot be edited or deleted, only reversed;
  the reversal and the reason stay on record. Every action is in the activity log.
- **Two modes.** With no Supabase settings the app runs on built-in demo data (the
  prototype). With them it is the live app.

## Local development

```bash
npm install
npm run dev                 # http://localhost:3000 — demo data, no database
```

With a real local database (needs Docker):

```bash
npx supabase start          # prints API_URL and ANON_KEY → put them in .env.local
npm run seed:local          # demo book + four logins (password: ledger-local-1)
npm run dev                 # sign in as 98000 12345 (owner)
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Static site in `./out` |
| `npm run lint` · `npm run typecheck` | Code checks |
| `npm test` | Unit tests: money engine, mappers, demo data (fast, no database) |
| `npm run test:db` | Database tests: payment scenarios, duplicates, reversal, roles, files (needs `npx supabase start`) |
| `npm run test:e2e` | Browser tests of the critical flows against a local database (resets and seeds it) |
| `npm run seed:local` | Fill an empty local database with the demo book |
| `npm run import -- file.csv` | Check an import file of existing customers and loans (`--apply` to save). See [IMPORT.md](IMPORT.md) |

`E2E_CLOUDFLARE=1 npm run test:e2e` runs the browser tests on Cloudflare's own Pages
runtime, with the production security headers.

## Where things live

| Path | Purpose |
|---|---|
| `src/lib/finance/` | **All money rules** (`engine.ts`, `money.ts`) and their tests |
| `src/lib/store.ts` | The app's data store and actions; live or demo |
| `src/lib/data/` | Supabase client, every database call (`remote.ts`), row ↔ type mapping |
| `src/lib/reports.ts`, `report-pdf.ts` | Report figures and the A4 PDF |
| `src/lib/selectors.ts` | Derived views: collection register, search, permissions |
| `src/app/(app)/*`, `src/components/*` | Screens and UI (frozen design) |
| `supabase/migrations/` | Tables, access rules, database functions |
| `tests/db/`, `tests/e2e/` | Database and browser tests |
| `scripts/` | Backup, restore, local seed, build helpers |
| `.github/workflows/` | CI, browser tests, deploy, nightly backup, database changes |

## Operations

- Deploying and first-time setup: [DEPLOYMENT.md](DEPLOYMENT.md)
- Settings and secrets: [ENVIRONMENT.md](ENVIRONMENT.md)
- Backups and how to restore: [BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- Importing existing customers and loans: [IMPORT.md](IMPORT.md)

## Roles

| | Owner | Collector | Staff |
|---|---|---|---|
| See customers and loans | all | their own customers | all |
| Take payments, move a date | yes | their own customers | no |
| Give a loan, edit a loan, release security | yes | no | no |
| Add / edit customers | yes | no | yes |
| Choose which pending months a payment covers | yes | their own customers | no |
| Waive interest (reason required) | yes | no | no |
| Reports, activity log, reverse a payment, manage users | yes | no | no |

## Demo data notes

In demo mode the login is pre-filled and the lock-screen PIN is `1234`. Demo data is
re-made each day relative to today's date. Try: search "Ravi" → loan **LP-1024** →
Receive Payment; search `TN 33 AB 1234`; Reports → All People · This Month · Pending.
