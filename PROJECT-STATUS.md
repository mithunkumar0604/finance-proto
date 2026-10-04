# LedgerPro — Project Status

A handover note for anyone (person or AI assistant) picking this project up.
Last updated: 4 October 2026.

## Where things stand

The client approved the clickable prototype. It is preserved as tag
`prototype-approved-v1` (source) and `prototype-approved-v1-site` (the deployed demo).

The `production` branch turns that prototype into a real application, with the
screens unchanged: real logins, a real database, tested money rules, backups.
**It is built and tested locally. It is not live yet**, because the hosting accounts
do not exist yet (see "Needed to go live").

- Demo (prototype, demo data): https://mithunkumar0604.github.io/finance-proto/
- Repository: https://github.com/mithunkumar0604/finance-proto
  - `main` = approved prototype source · `gh-pages` = deployed demo
  - `production` = the production conversion (not merged)

## How the business works (confirmed by the client)

- Most customers pay **interest only**, weekly or monthly. Principal stays untouched
  until part or all of it is returned. Full return closes the loan.
- The app leads with **Interest paid / Interest pending / Principal Left**.
- Payments can be **backdated**. Reports count money on the **payment date**.
- The client is not highly computer-literate: simple English, few screens, few choices.

## What the production branch adds

| Area | State |
|---|---|
| Money engine in whole paise, with unit tests (`src/lib/finance`) | Done · 77 tests |
| Database: tables, constraints, indexes (`supabase/migrations`) | Done |
| Access rules: owner / collector / staff, enforced by the database | Done |
| Atomic saves: payment, new loan, moved date, loan edit, security release | Done |
| Duplicate protection (double tap, retry) and two-people-at-once protection | Done |
| Reversing a wrong payment (owner), history never edited or deleted | Done |
| Activity log written by the database for every change | Done |
| Sign-in with Supabase Auth; roles from the user's profile | Done |
| All screens reading and saving through the database | Done |
| Reports and PDF on real data; older history read on demand | Done |
| Private file storage with access rules (bucket + policies, tested) | Done |
| Photo upload buttons on the customer / security forms | **Not wired yet** (still placeholders) |
| Database tests against a local Supabase | Done · 46 tests |
| Browser tests of the critical flows (mobile, tablet, desktop) | Done · 20 tests |
| Encrypted nightly backup + restore script; restore tested locally | Done |
| CI, browser tests, deploy, backup and migration workflows | Written · **not yet run on GitHub** |
| Security headers (CSP etc.) for Cloudflare Pages | Done, tested on Cloudflare's local runtime |
| Independent security review and money-engine review | Done; findings fixed or listed below |
| Handover documents | README, DEPLOYMENT, ENVIRONMENT, BACKUP_RESTORE, docs/BUSINESS-RULES |

## Needed to go live (only the project owner can do these)

1. Create a Supabase project and a Cloudflare account (both free). Steps in `DEPLOYMENT.md`.
2. Create the private backup repository and its token.
3. Add the variables and secrets from `ENVIRONMENT.md` to GitHub.
4. Get the client's answer to the open question below.
5. Decide how the client's existing ~850 customers and their loans get in: typed in,
   or imported from a file they already keep. An import script is not written yet.

## Open question that changes what customers are asked to pay

**What does a customer owe after missing whole periods?** Today a new collection
opens only when the previous one is paid, so a customer who missed July, August and
September is shown one month's interest pending, not three. This is how the approved
prototype behaves and it has not been changed. Details and the other open questions:
`docs/BUSINESS-RULES.md`.

## Known gaps and follow-ups

- Photo / document upload is not connected to the buttons yet (storage is ready).
- Device list in Settings shows only "this device"; "Logout all other devices" is real.
- Lock-screen PIN is per device (kept in the browser) and starts as `1234`. It is a
  convenience lock on top of the real sign-in, not the security boundary. Each user
  should change it in Settings.
- New logins are created in the Supabase dashboard, not in the app.
- PDFs print "Rs." instead of ₹ (the built-in PDF font has no ₹ sign).
- Backup does not include uploaded files, only database records.
- Reports treat a backdated payment by its payment date while the collection it paid
  stays in its own period; a period can show interest "paid" with ₹0 paid in it.

## History of changes

1. **First build** — all screens, demo data, deployed to GitHub Pages.
2. **Interest-first rework** — interest-only loans, Receive Payment reorganised,
   payment and recorded dates (backdating).
3. **Reports simplified** — one Person / Period / Show screen with PDF download.
4. **Upcoming reports** — Next Week, Next Month and future custom dates.
5. **Loan schedule and end date** — coming collections and "Loan Ends" on the loan page.
6. **Production conversion** (`production` branch, 4 Oct 2026) — everything in the
   table above. The only additions to the approved screens: a busy state on save
   buttons, plain-language error messages, a "Could not open your data" screen, a
   "Entered by mistake? Reverse" link on the latest payment (owner only), and in the
   live app the demo-only items are hidden (pre-filled login, PIN hint, "view as"
   role switcher, "Reset demo data", "demo" captions).

## Tech

Next.js 16 (App Router, static export), TypeScript, Tailwind CSS v4, Supabase
(Postgres, Auth, Storage), Cloudflare Pages, jsPDF, Vitest, Playwright.
`AGENTS.md` warns that this Next.js version differs from older ones — read
`node_modules/next/dist/docs/` before changing framework-level code.

See `README.md` for the layout of the code and the commands.
