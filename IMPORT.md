# Importing existing customers and loans

For bringing the business's existing book (about 850 customers) into LedgerPro
without typing it in. **No real data has been imported yet.** It has been tested with
the 22 made-up records in `import/sample-22.csv`.

## What an import is: opening positions

An imported loan is an **opening position**: where the loan stands on the day it is
brought in. From that day LedgerPro is the record.

| Brought in | Not brought in |
|---|---|
| Customer, loan amount, principal left, interest setting, loan type | Payments made before the import |
| The oldest unpaid collection (`next_due_date`) and every period since, each pending on its own | A reconstructed payment timeline |
| A part-paid period (`interest_already_paid`) | |
| The last payment date (`last_paid_date`), shown as "Last Paid" | |
| Security held; closed loans as closed records | |

Nothing is invented: no payment rows are created to make totals look complete. The
database keeps `opened_on` and `opening_principal` on each imported loan, and the app
labels its totals **"Collected since (that day)"** and shows a "Brought into
LedgerPro" line in the loan's timeline, so the owner is never shown a lifetime
"total collected" the system cannot know.

## The file

`import/template.csv` is the sheet to fill. `import/HOW-TO-FILL.md` is the
plain-language guide to give to the client. `import/sample-22.csv` has one made-up
row for each kind of loan. One row is one loan. Columns may be in any order.

| Column | What to put |
|---|---|
| `customer_ref` | Optional. The client's own number for the customer |
| `customer_name` | Required |
| `phone` | Optional. 10-digit mobile. Contact information, not identity |
| `alt_phone`, `area`, `address`, `id_ref`, `notes` | Optional |
| `loan_ref` | Optional. The client's own number for the loan. Stops it being imported twice |
| `loan_type` | `weekly`, `monthly`, `15day`, `30day`, `vehicle`, `jewel` or `custom` |
| `loan_amount` | Money first given, in rupees (`2,00,000` is fine) |
| `principal_left` | Principal still owed today |
| `start_date` | Day the loan was given |
| `interest_style` | `percent` or `fixed` |
| `interest_value` | The percentage (e.g. `3`) or the rupees per period (e.g. `2,500`) |
| `interest_method` | `reducing` (on balance), `fixed` (on amount given) or `manual` |
| `frequency` | `weekly`, `15days`, `30days` or `monthly` |
| `principal_per_collection` | Rupees of principal collected with each collection; empty for interest-only |
| `status` | `active` or `closed` |
| `next_due_date` | **The oldest collection that is still unpaid.** If the customer is behind, this is in the past and every period since then becomes pending |
| `interest_already_paid` | Optional. Rupees already paid towards that collection. Must be less than one period's interest |
| `interest_pending_today` | Optional. The client's own figure for interest owed today. Compared with what the app works out |
| `last_paid_date` | Optional |
| `closed_date` | Required for a closed loan |
| `security_type` | `none`, `jewel`, `vehicle`, `document` or `other` |
| `security_description`, `vehicle_registration` | What is held; the vehicle number is required for `vehicle` |
| `reference` | Optional note on the loan |

### Dates

One rule: **day first, four-digit year.** `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`,
or `YYYY-MM-DD`. `04/05/2026` is always 4 May 2026. Anything else (`04/05/26`,
`4 May 2026`) is refused, not guessed. The check prints how the first dates in the
file were read, so a sheet saved in another format is caught before importing.

### Who is who

A customer's identity in LedgerPro is its own id (`C001`, …). The phone is contact
information: it may be empty, and two customers may share one.

- In a file, two rows are the same customer when they have the same `customer_ref`,
  or, with no ref, the same name **and** phone.
- Two rows with the same name, no phone and no ref are refused: the sheet must say
  (with `customer_ref`) whether they are one person or two.
- A customer already in LedgerPro is reused only when it is clearly the same one:
  the `customer_ref` matches, or the name and phone both match. A shared phone alone
  never merges two people. An existing customer's details are never overwritten.
- A `loan_ref` already in LedgerPro stops the whole file.

### How missed periods are worked out

Every period from `next_due_date` up to today becomes its own pending collection,
each for one period's interest **on the principal left today**. If the customer
returned principal part-way through the missed stretch, the client's own figure for
the older months may be higher. That is what `interest_pending_today` is for: when
the client's figure and the app's differ, the import stops until the reason is known.

## Steps

```bash
# 1. Check the file. Saves nothing.
npm run import -- "C:\path\outside\the\repo\book.csv"

# 2. Read the report. Fix the sheet until it says "No problems found."

# 3. Import. Needs the project URL and the secret key, on an administrator's computer only.
IMPORT_SUPABASE_URL=https://xxxx.supabase.co IMPORT_SUPABASE_SECRET_KEY=sb_secret_... npm run import -- book.csv --apply
```

The report shows: how dates were read; every error with its row and column; things to
read that do not stop the import (a shared phone, a missing phone, loans with no
`loan_ref`, a long unpaid stretch); and, for each running loan, what it will show on
day one. With the two variables set, the check also looks, read-only, at what is
already in LedgerPro.

Keep the **batch id** it prints.

Real client files hold personal data. Keep them **outside this repository** (it is
public) and never commit them. Git ignores any CSV under `import/` other than the
template and the sample.

## What makes it safe

- **All or nothing.** A file with any error is not imported at all. If the database
  refuses even one row, nothing from the file is saved (one transaction).
- **Stops on anything that could change a balance:** the client's pending figure
  disagreeing with the app's, or a `loan_ref` that is already in LedgerPro.
- **Same file twice = saved once.** The file's contents decide the batch id.
- **Can be taken back**, completely, as long as no payment or waiver has been
  recorded on the imported loans:
  ```bash
  IMPORT_SUPABASE_URL=... IMPORT_SUPABASE_SECRET_KEY=... npm run import -- --undo <batch id>
  ```
  Taking an import back does not rewind the customer and loan numbers already used.
- **Not reachable from the app.** Only someone holding the secret key can import.

## The pilot (10–20 real loans), and the rest

1. Take a backup.
2. Check the pilot file and read every line of the report with the owner.
3. Import it. Compare every imported value with the sheet.
4. The owner opens 3–5 customers they know well and compares with their book.
   If a figure looks wrong, find out first whether it is the sheet, the import
   mapping, a business rule, or the calculation. Do not patch a single record.
5. Only then the full file. Either take the pilot back first and import one full
   file, or leave the pilot in and make sure every row has a `loan_ref` so the pilot
   loans cannot come in twice.
