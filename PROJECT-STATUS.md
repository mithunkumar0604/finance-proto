# LedgerPro — Project Status

A handover note for anyone (person or AI assistant) picking this project up.
Last updated: 2 October 2026.

## What this is

A clickable **prototype** of a loan and collection manager for a private finance
business in India. It is shown to a client to agree the workflow before the real
product is built. There is **no backend**: all data is fictional demo data kept in the
browser, and all money calculations are placeholder demo rules.

- Live demo: https://mithunkumar0604.github.io/finance-proto/
- Repository: https://github.com/mithunkumar0604/finance-proto (`main` = source, `gh-pages` = deployed site)
- Demo login is pre-filled. Lock-screen PIN: `1234`.

## How the business works (confirmed by the client so far)

- Most customers pay **interest only**, weekly or monthly. The principal usually stays
  untouched for a long time.
- Later the customer may return part of the principal, or settle the loan in full.
- So the app leads with **Interest paid / Interest pending / Principal Left**.
  "Principal Paid" is deliberately not a main column anywhere.
- Payments can be **backdated**. Every payment has a Payment Date and a Recorded Date;
  all reports count money on the **Payment Date**.
- The client is not highly computer-literate. Use very simple English and as few
  screens and choices as possible.

**Not yet confirmed:** the client's exact interest formulas. Everything in
`src/lib/demo-calculations.ts` is a stand-in until they are.

## What is built

| Area | State |
|---|---|
| Login, lock screen (PIN), auto-lock, device sessions | Done (prototype) |
| Home dashboard: today's expected / collected / pending, due list, money outside | Done |
| Global search: name, phone, vehicle number, loan ID | Done |
| Collections register: Today / Tomorrow / Overdue / Upcoming, loan-type filter | Done |
| Customers list and customer profile (loans, payments, documents, notes) | Done |
| Loans list and loan details with payment timeline and collateral | Done |
| Receive Payment: Pay Interest / Part Payment / Full Settlement; Pay Principal, Principal + Interest, Adjustment under "More options"; backdated dates | Done |
| Reschedule (move a payment date) | Done |
| New Customer, New Loan wizard (6 steps; jewel / vehicle / document security) | Done |
| Security (collateral) register | Done |
| Reports: one simple screen with PDF download (see below) | Done |
| Users and roles (Owner / Collector / Staff "view as" demo), activity log, settings | Done (concept only) |

### Reports (current design)

One screen: choose **Person** (All People or one person), **Period** and **Show**,
then press **Show Report**. **Download PDF** saves exactly what is on screen.

- Period: Today, This Week, This Month, Last Month, This Year, Next Week, Next Month,
  or Choose Dates (any dates, past or future).
- Show: All, Paid, Pending, Partial, Overdue, Upcoming, Closed.
- Quick buttons: Today, This Month, Pending, Overdue.
- All People → four headline figures and a register (table on desktop, cards on phones).
- One person → a ledger-style statement ending in Principal Left.
- **Future periods** show who has to pay and how much (status UPCOMING). These are
  estimates worked out from today's principal and each loan's interest setting.

## History of changes

1. **First build** — all screens above, demo data, deployed to GitHub Pages.
2. **Interest-first rework** — demo loans became mostly interest-only; Receive Payment
   reorganised around paying interest; payment and recorded dates added (backdating).
   Reports got six tabs (Overview, Interest, Loan Position, Overdue, Settlements, Closed)
   with configurable columns.
3. **Reports simplified** — the six tabs and column settings were judged too complex for
   the client and replaced by the single Person / Period / Show screen with PDF download.
4. **Upcoming reports** — Next Week, Next Month and future custom dates added, so the
   owner can see who has to pay in the coming weeks or months.

## Open points

- Real interest and settlement rules from the client (replace `demo-calculations.ts`).
- PDFs print money as "Rs." because the built-in PDF fonts have no ₹ sign. Embedding a
  font would fix this at the cost of a larger download.
- On phones a payment date is moved from the loan page, not from the collections list.
- Demo data is rebuilt every day relative to today's date, so anything entered during
  a demo is gone the next day (More → Settings → Reset demo data does the same on demand).
- No backend, accounts or real permissions yet. The actions in `src/lib/store.ts` are
  written as the future API surface.

## Tech and layout

Next.js 16 (App Router, static export), TypeScript, Tailwind CSS v4, lucide-react,
date-fns, jsPDF. `AGENTS.md` warns that this Next.js version differs from older ones —
read `node_modules/next/dist/docs/` before changing framework-level code.

| Path | Purpose |
|---|---|
| `src/lib/demo-calculations.ts` | All money rules (interest, payment split, settlement, schedule, future projection). The single place to replace with the client's real rules. |
| `src/lib/demo-data.ts` | Fictional customers, loans and payment history, dated relative to today. |
| `src/lib/store.ts` | Browser data store and actions (`receivePayment`, `reschedule`, `createLoan`, …). |
| `src/lib/selectors.ts` | Derived views: collection register, summaries, search, role permissions. |
| `src/lib/reports.ts` | Report logic: periods, the All People register, the one-person ledger, titles. |
| `src/lib/report-pdf.ts` | Lays the on-screen report out as an A4 PDF. |
| `src/app/(app)/*` | One folder per screen. |
| `src/components/*` | UI by area: `layout`, `collections`, `customers`, `loans`, `payments`, `reports`, `security`, `ui`. |

## Run and deploy

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build    # static site in ./out
```

Deploy (GitHub Pages serves the `gh-pages` branch): build with
`NEXT_PUBLIC_BASE_PATH=/finance-proto`, add an empty `.nojekyll` file to `out/`, and
force-push the contents of `out/` as the `gh-pages` branch. On Windows Git Bash, prefix
the build with `MSYS_NO_PATHCONV=1` or the base path is rewritten into a Windows path.
