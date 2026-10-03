# LedgerPro — Finance & Collection Manager (prototype)

> Project state, decisions and change history: see [PROJECT-STATUS.md](PROJECT-STATUS.md).

Clickable, mobile-first prototype of a loan and collection manager for a private
finance business. It is a **UX/workflow demo**: all data is fictional and all
money calculations are placeholder demo rules.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in ./out (includes scripts/flatten-rsc.mjs)
```

Demo login is pre-filled. Lock-screen PIN: `1234`.
Demo data is generated relative to today's date and resets each day, or via
**More → Settings → Reset demo data**.

## Demo flow to present

1. Home → today's expected / collected / pending, due-today list.
2. Search "Ravi" → Ravi Kumar → loan **LP-1024** → payment timeline, including the
   coming collections (instalment loans also show "Loan Ends" and an "Ends On" date).
3. Receive Payment → enter `33600` (₹3,600 interest + ₹30,000 principal) → Confirm.
4. Principal drops ₹1,20,000 → ₹90,000; Collections → Today shows Ravi as Paid.
5. Karthik R (₹10,000 due) → Collect `6000` → shows **Partial**, ₹4,000 still due.
6. Any loan → Reschedule → move the date → "Rescheduled · <date>".
7. Search `TN 33 AB 1234` → Murugan's vehicle loan → collateral details.
8. Reports → choose Person, Period and Show → Show Report (see below).
9. More → Users → "view as" Collector / Staff to show role permissions.

## Reports (one simple screen)

Choose **Person** (All People or one person — search by name or phone), **Period**
(Today … This Year, Next Week, Next Month, or Choose Dates — any dates, past or future)
and **Show** (All, Paid, Pending, Partial, Overdue, Upcoming, Closed), then press
**Show Report**. Quick buttons (Today, This Month, Pending, Overdue)
apply straight away. **Download PDF** saves exactly the report on screen (A4).

Demo examples:
1. All People · This Month · Pending → people with interest still to pay.
2. All People · This Month · Paid → people who paid all interest due this month.
3. Ravi Kumar · This Year · All → "Ravi Kumar Yearly Statement" (a ledger ending in Principal Left).
4. All People · This Year · Closed → "Closed Loans This Year".
5. All People · Next Month · All → "… Upcoming Report": who has to pay next month and
   how much (expected amounts, worked out from today's principal).
6. Choose Dates up to 31 December → what was paid, what is pending and what is coming.
7. Backdated: Kumaresan (LP-1057) → Receive Payment → pick a date last month →
   it shows in Last Month reports, not this month. Senthil V (LP-1101) already has one.

Most customers pay **interest only**; reports lead with Interest, Paid, Pending and
Principal Left. Money received is always counted on the **payment date**.

Receive Payment: *Pay Interest / Part Payment / Full Settlement* up front; *Pay Principal,
Principal + Interest, Adjustment* under **More options**.

## Where things live

| Path | Purpose |
|---|---|
| `src/lib/demo-calculations.ts` | **All money rules** (interest, split, settlement, next date). Replace with the client's confirmed rules. |
| `src/lib/store.ts` | Local data store + actions (`receivePayment`, `reschedule`, `createLoan`, …) — the future API surface. |
| `src/lib/demo-data.ts` | Fictional seeded customers, loans and history. |
| `src/lib/selectors.ts` | Derived views: collection register, summaries, search, role permissions. |
| `src/lib/reports.ts` | Report maths: periods (past and future), All People register, one-person ledger, titles. |
| `src/lib/report-pdf.ts` | Turns the on-screen report into an A4 PDF (jsPDF, loaded on demand). |
| `src/components/reports/*` | Reports screen: Person / Period / Show controls, register, person statement. |
| `src/lib/config.ts` | App name / branding. |
| `src/components/*` | UI by area: `layout`, `collections`, `customers`, `loans`, `payments`, `security`, `ui`. |

## Hosting

`next.config.ts` uses `output: "export"`. Set `NEXT_PUBLIC_BASE_PATH=/repo-name`
when hosting under a sub-path (GitHub Pages). On Vercel, import the repo with
default settings.
