# LedgerPro — Project Status

A handover note for anyone (person or AI assistant) picking this project up.
Last updated: 5 October 2026.

## Where things stand

The client approved the clickable prototype. It is preserved as tag
`prototype-approved-v1` (source) and `prototype-approved-v1-site` (the deployed demo).

The prototype has been turned into a real application, with the screens unchanged:
real logins, a real database, tested money rules, backups. **It is live**, with one
owner login and no customer data yet.

- Live app: https://finance-proto.skaroweb.workers.dev (Cloudflare, built from the
  `production` branch)
- Demo (prototype, demo data): https://mithunkumar0604.github.io/finance-proto/
- Repository: https://github.com/mithunkumar0604/finance-proto
  - `production` = what Cloudflare publishes. Work happens here.
  - `main` = the default branch. `production` was merged into it on 5 October 2026
    (fast-forward, history kept), so the nightly backup and the "Run workflow" buttons
    work. Keep the two the same: after a change is tested on `production`, bring
    `main` up to it.
  - `gh-pages` = the deployed demo. Tag `prototype-approved-v1` = the approved prototype.

**What is left** (in this order): the client's 10–20 loan sample import and their check
of it (`IMPORT.md`) → the full import of about 850 customers → staff and collector
logins if wanted → the client's own web address when they buy one.

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
| **Delete Payment** (owner): takes back the latest payment on a loan; the record is kept underneath | Done |
| Activity log, payment allocations and waiver records written by the database | Done |
| Sign-in with Supabase Auth; roles from the user's profile | Done |
| All screens reading and saving through the database | Done |
| Reports and PDF on real data; older history read on demand | Done |
| Private file storage with access rules (bucket + policies, tested) | Done |
| Import of existing customers and loans from CSV (`IMPORT.md`) | Done; tested with 20 sample rows. **No real data imported** |
| Photos and documents of security (jewel, vehicle, document): add, view, replace, remove | Done |
| Customer photo and ID photo boxes (customer page, new customer) | **Not wired** (still placeholders; not asked for) |
| Change Password (More → Settings → Security) | Done |
| Encrypted nightly backup + restore script | Done; runs nightly from `main`; restore tested **locally only** |
| CI (lint, types, unit tests, build, database tests) | Running on GitHub for `production` and `main` |
| Browser tests and release checks | Run on GitHub for every push to `main` |
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
- ~~Create the owner login.~~ Done 5 October 2026.
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
- Automatic builds from `production` work (the Cloudflare production branch had to be
  set to `production`).

## First owner account and live authenticated test (5 October 2026)

- The owner login was created with the project's secret key (public sign-up stays
  off): one Auth user, one profile, role `owner`.
- A full flow was run on the live site as the owner with labelled test data: customer,
  a loan given 95 days earlier (three missed months), one month's interest, part of a
  month, a backdated payment, part of the principal, reports and filters, PDF, logout
  and login, at 390 / 768 / 1440 px. 50 of 50 checks passed, with no errors, and the
  hosted database matched the screens figure for figure.
- The project was then reset, all migrations re-applied, and the owner re-created.
  **Final state: 1 Auth user, 1 profile (owner), every other table empty, 0 files,
  counters at their start (C001, LP-1001), sign-up off, 18 of 18 checks.**
- Not exercised on the live site: staff and collector logins (none exist yet; their
  restrictions were proven in the 86-test hosted run), and photo upload (not wired).
- To do in the Supabase dashboard: Authentication → turn on "Leaked password
  protection" if the plan allows it (Supabase's advisor flags it as off).

## Client onboarding (in progress, 5 October 2026)

- A backup of the clean, owner-only state is in the backup repository (run of
  10:38 UTC; fingerprint matched; it holds 1 login, 1 profile, nothing else).
- The client fills `import/template.csv` using `import/HOW-TO-FILL.md`
  (`import/sample-22.csv` shows one made-up row per kind of loan). **First only
  10–20 real loans.**
- Imported loans are **opening positions**: old payments are not recreated, and the
  app labels their totals "Collected since (import day)". Customers are identified by
  their own LedgerPro id, never by phone alone (shared and missing phones are
  allowed). Dates are day first. The check reports warnings before import and stops
  on anything that could change a balance. Details: `IMPORT.md`.
- The importer checks every row, refuses the whole file on any error, saves all or
  nothing, saves the same file once, and can be taken back before any payment. It
  now also carries a part-paid month and the last payment date. Tested locally (15
  import tests) and, before those two columns were added, against the hosted project.
- The hosted project has the matching migration (8 of 8), still with no client data.
- **Not done yet:** the real sample import (waiting for the client's sheet), the
  client's check of 3–5 customers, and the full import.
- Real client files are personal data: keep them outside this (public) repository.
  Any CSV under `import/` other than the template and the sample is ignored by git.

## Final pre-handover fixes (5 October 2026)

- **Delete Payment.** On the latest payment of a loan the owner sees "Delete Payment",
  confirms "Delete this payment?", and may type a reason (otherwise "Entered by
  mistake"). The loan, its collections and every report go back to how they were. The
  payment row stays in the database, marked as taken back, with who and why, and the
  activity list says "Deleted payment of …". There is no "edit payment": delete and
  enter again. Payments can be deleted one after another, newest first. (The tests for
  this found, and a migration fixed, a case where the second delete was refused.)
- **Security photos.** The tiles on a loan's security and the photo boxes in New Loan
  save to the private `documents` bucket as `<loan id>/<tile>-<time>.<ext>`. JPG, PNG,
  WebP and PDF; photos are made smaller in the browser before sending; 5 MB limit.
  Shown only through signed links that last an hour. Owner and staff add, only the
  owner replaces or removes, a collector only views (enforced by the storage rules).
- **Change Password.** Current, new (8 or more characters), confirm. This device stays
  signed in; other devices are signed out.
- **Tests:** 193 unit, 98 database, 26 browser, all passing. On the live site a
  temporary owner ran the whole flow with fake data (customer, loan, photos, payment,
  delete, re-enter, password change, phone / tablet / desktop widths); everything was
  then removed. **The hosted project is again: 1 login, 1 profile (the owner), every
  other table empty, no files, 12 migrations, 18 of 18 checks.**
- **Merge and backup (5 October 2026):** `main` was fast-forwarded to `production`; the two
  are identical. On `main`, CI and the release checks (including the 26 browser tests on
  GitHub) pass. A backup started by hand from `main` succeeded and is in the private
  backup repository; the nightly run (02:00 IST) is active.
- **Cloudflare shows a failed build for every push to `main`.** Cloudflare publishes
  `production` (that build succeeds and is what is live); it also tries a preview build
  of other branches, which this project does not support. To stop the red mark: Cloudflare
  dashboard → the `finance-proto` Worker → Settings → Build → Branch control → switch
  off builds for non-production branches. The live site is not affected either way.
- **To do by hand in the Supabase dashboard:** turn on "Require current password when
  updating" if offered (see `ENVIRONMENT.md`), and "Leaked password protection".

## Needed to go live (all done; kept for the record)

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
- "Delete Payment" on the latest payment (owner only), with a "Delete this payment?" sheet;
- the three photo tiles of a security open, add, replace and remove real files; the
  photo boxes in New Loan show the chosen file's name;
- a "Security" section in Settings with "Change Password";
- **Receive Payment**: when more than one period is pending, a "Pending Interest"
  list with a tick box per period and a total; a "− Waive interest" choice under
  Adjustment (owner only); the Notes box becomes "Reason for waiving" when waiving;
- the loan page lists every missed period as "Overdue Collection";
- in the live app the demo-only items are hidden (pre-filled login, PIN hint, "view
  as" role switcher, "Reset demo data", "demo" captions).

## Known gaps and follow-ups

- The customer photo and ID photo boxes are still placeholders (security photos work).
- Uploaded photos are not in the nightly backup (it covers the database). Download the
  `documents` bucket from the Supabase dashboard from time to time.
- Only the latest payment on a loan can be deleted; older ones after deleting the later ones.
- An import carries balances, not payment history: "Total collected" on an imported
  loan counts from the import onwards.
- Device list in Settings shows only "this device"; "Logout all other devices" is real.
- Lock-screen PIN is per device and starts as `1234`. It is a convenience lock on top
  of the real sign-in, not the security boundary. Each user should change it.
- New logins are created in the Supabase dashboard, not in the app.
- PDFs print "Rs." instead of ₹ (the built-in PDF font has no ₹ sign).
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

8. **Import as opening positions** — imported loans start from where they stand;
   customers are identified by their own id, not by phone; day-first dates.
9. **Final pre-handover fixes** — Delete Payment, security photos, Change Password;
   `production` merged into `main`; nightly backups running.

## Tech

Next.js 16 (App Router, static export), TypeScript, Tailwind CSS v4, Supabase
(Postgres, Auth, Storage), Cloudflare Pages, jsPDF, Vitest, Playwright.
`AGENTS.md` warns that this Next.js version differs from older ones — read
`node_modules/next/dist/docs/` before changing framework-level code.

See `README.md` for the layout of the code and the commands.
