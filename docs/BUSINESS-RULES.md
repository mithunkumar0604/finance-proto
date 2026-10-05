# Money rules

How LedgerPro works money out. Every rule lives in `src/lib/finance/engine.ts` with a
test beside it. Three rules are repeated in the database so that it can check and
apply them itself (`period_interest`, `next_due_date`, `accrue_dues` in
`supabase/migrations`); tests compare both sides. **Change a rule in both places.**

All amounts are whole paise. Nothing is stored or added as a decimal number.

## Confirmed by the client

- Most customers pay interest only. Principal stays until it is returned.
- Principal can be returned in part, or in full.
- A payment has a payment date and a recorded date. Reports use the payment date.
- "Principal Left" is what matters on screen, not "Principal Paid".
- **Missed interest (confirmed 4 October 2026).** Interest falls due every period,
  whether or not the last period was paid. A customer who misses July, August and
  September owes all three, and each stays pending **on its own** until it is:
  paid, part-paid, or waived by the owner. Paying a newer month never clears an
  older one.
- **The owner decides what a payment covers:** all pending months, one, some, part of
  one, principal only, principal with chosen months, or any custom amount.
- **Interest is never cleared automatically.** It can only be paid, or waived by the
  owner with a reason. Every waiver is recorded (who, when, which month, how much, why).

## How that works in the app

- A loan has one **collection** per period. When the app opens, the database adds a
  collection for every period that has started since the last one (`accrue_dues`).
- Receive Payment lists the pending periods with a tick box each. The periods already
  due are ticked to start with; the one still running is not.
- An amount typed with no choice made goes to the oldest pending period first.
- Interest goes only to ticked periods. Money beyond their interest is counted as
  principal (as in the approved prototype), and shown before Confirm.
- Returning all the principal while interest is pending does **not** close the loan.
  It stays open, with no further interest added, until the pending interest is
  collected or waived. Full Settlement does both in one step: collect what is paid,
  waive the rest with a reason.
- Waiving: the owner only. Full Settlement → "− Waive", or More options → Adjustment →
  "− Waive interest". The reason goes in Notes and is required.

## Loans brought in from the old book (confirmed 5 October 2026)

- An imported loan is an **opening position**: principal left, what is pending, and
  the oldest unpaid collection, as they stand on the day of import. From that day
  LedgerPro is the record.
- **Old payments are not recreated**, and no payment is invented to make a total look
  complete. The app says "Collected since (import day)" for these loans.
- A closed loan comes in as a closed record with its date; nothing to collect.
- **A customer's identity is its own LedgerPro id.** The phone is contact information:
  it may be empty or shared. Two people sharing a phone are two customers.
- Dates in an import are day first with a four-digit year (`04/05/2026` = 4 May).

## Assumptions — NOT yet confirmed by the client

| # | Rule | Where |
|---|---|---|
| A1 | Percentage interest is rounded to the nearest whole rupee (half a rupee rounds up). | `percentOf` |
| A2 | "On balance" interest is a percentage of the principal left; "flat" is a percentage of the amount first given. | `periodInterest` |
| A3 | A collection falls due one period after the last one: 7, 15 or 30 days, or one month. "Custom" means 30 days. | `nextDueDate` |
| A4 | Monthly loans keep to the day of the month the loan was given (31 Jan → 28 Feb → 31 Mar). | `nextDueDate` |
| A5 | While principal is owed, a period's interest is never less than ₹1. | `periodInterest` |
| A6 | A loan cannot be closed on a date before its latest payment. | `applyPayment` |
| A7 | **A missed period's interest is worked out on the principal owed when that period's collection is added**, and is not changed afterwards. Returning principal lowers the interest of later periods only. | `accrueDues` |
| A8 | **No interest on interest, and no late fee.** A missed month stays at its own amount however late it is paid. A late fee can be taken by hand as an Adjustment. | — |
| A9 | **At settlement, a period that has begun is owed in full**; a period that had not begun by the payment date is not owed and is dropped. (Loan given on the 1st: settle on the 20th and that month's interest is pending; settle on the collection day and nothing further is.) No part-month interest. | `applyPayment` |
| A10 | An instalment loan (principal with each collection) that falls behind keeps charging interest each period, even past its planned end date, until the principal is returned. | `accrueDues` |
| A11 | A collector can choose which periods a payment covers, but cannot waive. | database |

## Questions for the client

- A7–A10 above: are these right?
- Do short-term loans have an agreed return date? (An optional "loan period".)
- "Manual" interest: should the owner be able to type any interest amount each time?
  Today interest collected for a period cannot be more than that period's interest;
  extra goes under Adjustment.
- Who may move a collection date, and how far? Today: owner and collectors, up to a year.
