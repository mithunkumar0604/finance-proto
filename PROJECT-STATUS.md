# LedgerPro — Project Status

A handover note for anyone (person or AI assistant) picking this project up.
Last updated: 5 October 2026.

## Where things stand

The client approved the clickable prototype. It is preserved as tag
`prototype-approved-v1` (source) and `prototype-approved-v1-site` (the deployed demo).

The `production` branch turns that prototype into a real application, with the
screens unchanged: real logins, a real database, tested money rules, backups.
**It is built and tested locally and in CI. It is not live yet**, because the hosting
accounts do not exist yet (see "Needed to go live").

- Demo (prototype, demo data): https://mithunkumar0604.github.io/finance-proto/
- Repository: https://github.com/mithunkumar0604/finance-proto
  - `main` = approved prototype source · `gh-pages` = deployed demo
  - `production` = the production conversion. **Do not merge into `main` until the
    production secrets and settings are in place** (the deploy runs on `main`).

## How the business works (confirmed by the client)

- Most customers pay **interest only**, weekly or monthly. Principal stays untouched
  until part or all of it is returned.
- **Every missed interest period stays pending on its own** until it is paid,
  part-paid, or waived by the owner. Three missed months of ₹3,000 = ₹9,000 pending.
  Paying a newer month never clears an older one.
- **The owner decides what a payment covers**: all pending months, some, part of one,
  principal only, principal with chosen months, or any amount.
- Interest is never cleared automatically; only paid, or waived by the owner with a
  reason (recorded).
- The app leads with **Interest paid / Interest pending / Principal Left**.
- Payments can be **backdated**. Reports count money on the **payment date**.
- The client is not highly computer-literate: simple English, few screens, few choices.

Full rules, and the assumptions still to confirm: `docs/BUSINESS-RULES.md`.

## What the production branch has

| Area | State |
|---|---|
| Money engine in whole paise, with unit tests (`src/lib/finance`) | Done |
| Missed interest: a collection per period, chosen by the owner at payment, waivers | Done |
| Database: tables, constraints, indexes (`supabase/migrations`) | Done |
| Access rules: owner / collector / staff, enforced by the database | Done |
| Atomic saves: payment, waiver, new loan, moved date, loan edit, security release | Done |
| Duplicate protection (double tap, retry) and two-people-at-once protection | Done |
| Reversing a wrong payment (owner); history never edited or deleted | Done |
| Activity log, payment allocations and waiver records written by the database | Done |
| Sign-in with Supabase Auth; roles from the user's profile | Done |
| All screens reading and saving through the database | Done |
| Reports and PDF on real data; older history read on demand | Done |
| Private file storage with access rules (bucket + policies, tested) | Done |
| Import of existing customers and loans from CSV (`IMPORT.md`) | Done; tested with 20 sample rows. **No real data imported** |
| Photo upload buttons on the customer / security forms | **Not wired yet** (still placeholders) |
| Encrypted nightly backup + restore script | Done; restore tested **locally only** |
| CI (lint, types, unit tests, build, database tests) | Running on GitHub for `production` |
| Browser tests, deploy, backup and migration workflows | Written; **not yet run on GitHub** (they need the secrets, or `main`) |
| Security headers (CSP etc.) for Cloudflare Pages | Done, tested on Cloudflare's local runtime |
| Handover documents | README, DEPLOYMENT, ENVIRONMENT, BACKUP_RESTORE, IMPORT, docs/BUSINESS-RULES |

Tests: unit (engine, missed interest, import checker, mappers), database (payments,
missed interest, waivers, roles, files, import), browser (critical flows at phone,
tablet and desktop widths). Run them with the commands in `README.md`.

## Hosted Supabase project (5 October 2026)

Project `ledgerpro`, region Singapore (ap-southeast-1). Its URL and keys are in `.env.local` on the developer machine and in GitHub variables, never in this repository.

- All 7 migrations applied with the Supabase CLI (`link` → `db push --dry-run` → `db push`).
- Read-only verification (`scripts/verify-hosted.sql`): 18 of 18 checks ok.
- Probed from outside with only the publishable key: every table, the view, inserts
  and function calls are refused without signing in.
- Supabase advisors: no errors. The only warnings are the by-design ones described
  in `DEPLOYMENT.md`.
- A build pointed at the hosted project reaches hosted sign-in (a wrong login is
  refused) and contains no secret key.
- The app uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **The database holds no data and no logins.** Nothing was seeded.

Still to do on the hosted project:

- ~~Turn off "Allow new users to sign up".~~ Done; checked off on 5 October 2026.
- Create the owner login (`DEPLOYMENT.md` step 6).
- ~~Run the full database test suite against the hosted project.~~ Done 5 October
  2026: 86 of 86 passed against the real project (roles, payments, missed interest,
  waivers, reversal, locked history, direct-write blocking, private files, import).
  The project was then reset, all 7 migrations re-applied, and re-verified: 18 of 18
  checks, every table empty, 0 logins, 0 stored files, sign-ups off.
- ~~A real backup and a compared restore.~~ Done 5 October 2026 against the empty
  hosted project; see "Last tested" in `BACKUP_RESTORE.md` for what it does and does
  not prove. **The nightly schedule does not run until `production` is merged.**

## Cloudflare (5 October 2026)

Live at **https://finance-proto.skaroweb.workers.dev** (Cloudflare Worker serving the
static export; project `finance-proto`, connected to the `production` branch).

- Published once by hand with `npx wrangler deploy` from the developer machine, because
  Cloudflare's own build of the branch was failing (it had auto-detected Next.js and
  run an adapter that does not fit a static export). `wrangler.jsonc` now tells it how
  to build; see `DEPLOYMENT.md` section 3 for the dashboard settings to check.
- Smoke test on the live address: login screen renders at 390, 768 and 1440 px with no
  overflow; a wrong login is refused by hosted Supabase; sign-up is refused; all 14
  inner pages return to the login screen without a sign-in; no failed files or errors.
- Security: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy
  are present; all 135 served files were scanned and contain no secret key, database
  address, token or passphrase (only the publishable key, which is public).
- The hosted database is still empty and no login exists.

## Needed to go live (only the project owner can do these)

1. ~~Create the Supabase project~~ (done). Create the Cloudflare account/project and
   the private backup repository with its token. Steps: `DEPLOYMENT.md`.
2. Add the variables and secrets from `ENVIRONMENT.md` to GitHub.
3. Then, in order (all in `DEPLOYMENT.md`): apply the migrations → verify the empty
   project with the database tests → create the owner login → run one real backup and
   restore it somewhere safe (`BACKUP_RESTORE.md`) → merge `production` into `main`
   to deploy → import a small sample of real customers, check with the owner, then
   the full book (`IMPORT.md`).

## Changes to the approved screens

The design is unchanged. Additions, all small:

- a busy state on save buttons, and plain-language error messages;
- a "Could not open your data" screen;
- "Entered by mistake? Reverse" on the latest payment (owner only);
- **Receive Payment**: when more than one period is pending, a "Pending Interest"
  list with a tick box per period and a total; a "− Waive interest" choice under
  Adjustment (owner only); the Notes box becomes "Reason for waiving" when waiving;
- the loan page lists every missed period as "Overdue Collection";
- in the live app the demo-only items are hidden (pre-filled login, PIN hint, "view
  as" role switcher, "Reset demo data", "demo" captions).

## Known gaps and follow-ups

- Photo / document upload is not connected to the buttons yet (storage is ready).
- An import carries balances, not payment history: "Total collected" on an imported
  loan counts from the import onwards.
- Device list in Settings shows only "this device"; "Logout all other devices" is real.
- Lock-screen PIN is per device and starts as `1234`. It is a convenience lock on top
  of the real sign-in, not the security boundary. Each user should change it.
- New logins are created in the Supabase dashboard, not in the app.
- PDFs print "Rs." instead of ₹ (the built-in PDF font has no ₹ sign).
- Backup does not include uploaded files, only database records.
- A waiver made on its own (not as part of a payment) cannot be undone in the app.

## History of changes

1. **First build** — all screens, demo data, deployed to GitHub Pages.
2. **Interest-first rework** — interest-only loans, Receive Payment reorganised,
   payment and recorded dates (backdating).
3. **Reports simplified** — one Person / Period / Show screen with PDF download.
4. **Upcoming reports** — Next Week, Next Month and future custom dates.
5. **Loan schedule and end date** — coming collections and "Loan Ends" on the loan page.
6. **Production conversion** (`production` branch) — database, sign-in, tested engine,
   backups, CI, security review.
7. **Missed interest and import** — the client confirmed that every missed period
   stays pending and the owner chooses what a payment covers; the engine, database
   and Receive Payment sheet follow that. CSV import of existing customers added.

## Tech

Next.js 16 (App Router, static export), TypeScript, Tailwind CSS v4, Supabase
(Postgres, Auth, Storage), Cloudflare Pages, jsPDF, Vitest, Playwright.
`AGENTS.md` warns that this Next.js version differs from older ones — read
`node_modules/next/dist/docs/` before changing framework-level code.

See `README.md` for the layout of the code and the commands.
