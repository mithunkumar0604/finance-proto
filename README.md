# LedgerPro — Finance & Collection Manager (prototype)

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
2. Search "Ravi" → Ravi Kumar → loan **LP-1024** → payment timeline.
3. Receive Payment → enter `33600` (₹3,600 interest + ₹30,000 principal) → Confirm.
4. Principal drops ₹1,20,000 → ₹90,000; Collections → Today shows Ravi as Paid.
5. Karthik R (₹10,000 due) → Collect `6000` → shows **Partial**, ₹4,000 still due.
6. Any loan → Reschedule → move the date → "Rescheduled · <date>".
7. Search `TN 33 AB 1234` → Murugan's vehicle loan → collateral details.
8. Reports → Money Outside, collections, overdue aging (tap a row for customers).
9. More → Users → "view as" Collector / Staff to show role permissions.

## Where things live

| Path | Purpose |
|---|---|
| `src/lib/demo-calculations.ts` | **All money rules** (interest, split, settlement, next date). Replace with the client's confirmed rules. |
| `src/lib/store.ts` | Local data store + actions (`receivePayment`, `reschedule`, `createLoan`, …) — the future API surface. |
| `src/lib/demo-data.ts` | Fictional seeded customers, loans and history. |
| `src/lib/selectors.ts` | Derived views: collection register, summaries, search, reports, role permissions. |
| `src/lib/config.ts` | App name / branding. |
| `src/components/*` | UI by area: `layout`, `collections`, `customers`, `loans`, `payments`, `security`, `ui`. |

## Hosting

`next.config.ts` uses `output: "export"`. Set `NEXT_PUBLIC_BASE_PATH=/repo-name`
when hosting under a sub-path (GitHub Pages). On Vercel, import the repo with
default settings.
