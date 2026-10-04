# Money rules

How LedgerPro works money out. Every rule here lives in `src/lib/finance/engine.ts`
and has a test in `src/lib/finance/engine.test.ts`. Two rules (interest for a period,
the next collection date) are repeated in the database
(`supabase/migrations/…_functions.sql`, `period_interest` and `next_due_date`) so the
database can check them; a test compares both sides. **Change a rule in both places.**

All amounts are whole paise. Nothing is stored or added as a decimal number.

## Confirmed by the client

- Most customers pay interest only. Principal stays until it is returned.
- Principal can be returned in part, or in full (which closes the loan).
- A payment has a payment date and a recorded date. Reports use the payment date.
- "Principal Left" is what matters on screen, not "Principal Paid".

## Assumptions carried over from the approved prototype — NOT yet confirmed

| # | Rule | Where |
|---|---|---|
| A1 | Percentage interest is rounded to the nearest whole rupee (half a rupee rounds up). | `percentOf` |
| A2 | "On balance" interest is a percentage of the principal left; "flat" is a percentage of the amount first given. | `periodInterest` |
| A3 | A collection falls due one period after the last one: 7, 15 or 30 days, or one month. "Custom" means 30 days. | `nextDueDate` |
| A4 | Monthly loans keep to the day of the month the loan was given (31 Jan → 28 Feb → 31 Mar). | `nextDueDate` |
| A5 | Money received is counted as interest first, then principal; anything over goes to "Other". | `suggestAllocation` |
| A6 | To settle a loan: interest due on the open collection + all principal left. | `settlementAmount` |
| A7 | Interest left unpaid when a loan is settled is written off (recorded as "waived", never as received) and shown in the activity log. | `applyPayment` |
| A8 | While principal is owed, a period's interest is never less than ₹1. | `periodInterest` |
| A9 | A loan cannot be closed on a date before its latest payment. | `applyPayment` |
| A10 | **The next collection opens only when the current one is fully paid.** | `applyPayment` |

## Open question that changes amounts — needs the client's answer

**A10: what does a customer owe after missing whole periods?**

Today: a loan of ₹1,00,000 at 3% a month whose July interest is unpaid shows ₹3,000
pending in October, and can be settled for ₹1,03,000. The August and September
interest is never asked for, because a new collection opens only after the previous
one is paid.

The other reading: interest falls due every period whether or not the last one was
paid, so in October the customer owes ₹9,000 interest and settles for ₹1,09,000.

This is the approved prototype's behaviour and it has not been changed, because
guessing either way changes what customers are asked to pay. It also decides two
smaller things: whether one payment can cover several months of interest, and
whether an instalment loan keeps charging interest while an instalment is unpaid.

## Other questions for the client

- Do short-term loans have an agreed return date? (An optional "loan period".)
- "Manual" interest: should the owner be able to type any interest amount each time?
  Today the amount collected as interest cannot be more than the interest due; extra
  goes under Adjustment.
- Who may write off interest at settlement: the owner only, or collectors too?
  Today anyone who can take a payment can, and it is logged for the owner.
- Who may move a collection date, and how far? Today: owner and collectors, up to a year.
