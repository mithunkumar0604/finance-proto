# LedgerPro Prototype — Design

**Date:** 2026-09-28 · **Path:** Architectural (new project) · **Source brief:** client prototype brief supplied by the user

## Intent

A clickable, mobile-first prototype of a lending & collection manager for a private
finance owner in India, demonstrated live to that client. Success = the owner
immediately understands "who owes me what, who pays today, what did I collect, what
is outside", and the 19-step demo flow (dashboard → search Ravi → loan → partial
payment → collections → vehicle search → reports) runs smoothly on a phone.

**Stated constraints:** no real calculation engine (rules not yet confirmed), simple
English, mobile first (390px) scaling to desktop, deploy to a shareable HTTPS URL.

**Assumptions made (brief says: decide, don't ask):**
- Totals are *derived from the demo dataset* so every number the client taps matches
  the list behind it (instead of hard-coding ₹1.73 Cr against 20 visible loans).
- Demo data is generated *relative to today's date* so the demo always looks live;
  data re-seeds when the day changes and via "Reset demo data".
- Where the brief contradicts itself (e.g. vehicle TN 33 AB 1234 under both Ravi and
  Murugan), one consistent story is chosen: TN 33 AB 1234 is Murugan's vehicle loan.

## Architecture

- Next.js (App Router) + TypeScript + Tailwind v4 + lucide-react. Static export
  (`output: "export"`) so it can be hosted anywhere (Vercel or GitHub Pages).
- Detail pages use query params (`/customer?id=`, `/loan?id=`) so records created at
  runtime work without server routes.
- `lib/types.ts` — domain types (Customer, Loan, Due, Payment, Security).
- `lib/demo-data.ts` — seeded, relative-dated fictional dataset.
- `lib/demo-calculations.ts` — **all** money logic (interest per period, allocation,
  settlement, applying a payment, next due date). Marked DEMO; single swap point.
- `lib/store.tsx` — React context + reducer, persisted to localStorage. Actions are the
  future API surface (`receivePayment`, `reschedule`, `createLoan`, …).
- `lib/selectors.ts` — derived views (today's register, overdue, summaries, reports).
- UI: `components/{ui,layout,collections,customers,loans,payments,security,reports}`.

## Data model (collections)

A loan has a stream of **Dues** (dueDate, amount split into interest/principal,
paid so far, optional reschedule). The collection register is simply the dues list:
Paid / Partial / Pending / Overdue / Rescheduled are derived from a due. Paying a due
in full creates the next due (demo rule: + one frequency period).

## Screens

Login · Home · Collections (Today/Tomorrow/Overdue/Upcoming + type filter) · Customers
· Customer profile · Loans · Loan detail + timeline · Receive Payment sheet + success ·
Reschedule sheet · New Customer · New Loan wizard (6 steps, jewel/vehicle/document
security fields) · Reports (overview, collections, breakdown, overdue aging with
drill-down) · Security register · More · Users & roles concept · Activity · Settings
(privacy: auto-lock, change PIN, sessions, logout all) · Lock screen · Global search.

Navigation: mobile bottom bar (Home, Collections, +, Customers, More) with safe-area
padding; desktop left sidebar. "+" opens New Loan / Add Customer / Receive Payment.

## Visual direction

Warm neutral background, white surfaces, one deep-emerald accent, Plus Jakarta Sans,
tabular numerals for money, status chips, restrained motion (sheet slide, success
check, count-up numbers).

## Verification

`next build` passes with no type/lint errors; walk the 19-step demo flow in a browser
at 390 / 768 / 1440 widths; no horizontal overflow.
