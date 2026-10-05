# Importing existing customers and loans

For bringing the business's existing book (about 850 customers) into LedgerPro
without typing it in. **No real data has been imported yet.** It has been tested with
the 20 sample records in `import/sample-20.csv`.

## The file

Fill in `import/template.csv` in Excel or Google Sheets and save it as **CSV**.
One row is one loan. A customer with two loans has two rows with the same phone
number. A row with no loan amount adds the customer only.

| Column | What to put |
|---|---|
| `customer_name`, `phone` | Required. Phone is the 10-digit mobile; it is how a customer is recognised |
| `alt_phone`, `area`, `address`, `id_ref`, `notes` | Optional |
| `loan_type` | `weekly`, `monthly`, `15day`, `30day`, `vehicle`, `jewel` or `custom` |
| `loan_amount` | Money first given, in rupees (`2,00,000` is fine) |
| `principal_left` | Principal still owed today |
| `start_date` | Day the loan was given, `DD-MM-YYYY` |
| `interest_style` | `percent` or `fixed` |
| `interest_value` | The percentage (e.g. `3`) or the rupees per period (e.g. `2,500`) |
| `interest_method` | `reducing` (on balance), `fixed` (on amount given) or `manual` |
| `frequency` | `weekly`, `15days`, `30days` or `monthly` |
| `principal_per_collection` | Rupees of principal collected with each collection; empty for interest-only |
| `next_due_date` | **The oldest collection that is still unpaid.** If the customer is behind, this is in the past and every period since then becomes pending |
| `security_type` | `none`, `jewel`, `vehicle`, `document` or `other` |
| `security_description`, `vehicle_registration` | What is held; the vehicle number is required for `vehicle` |
| `status` | `active` or `closed` |
| `closed_date` | Required for a closed loan |
| `reference` | Optional note on the loan |

What is **not** imported: the history of past payments. An imported loan starts from
its balance today ("Principal left") and its next collection. "Total collected"
on an imported loan counts from the import onwards.

## Steps

```bash
# 1. Check the file. Saves nothing. Lists every problem with its row and column.
npm run import -- book.csv

# 2. Fix the file until it says "No problems found."

# 3. Import. Needs the project URL and the secret key, on an administrator's computer only.
IMPORT_SUPABASE_URL=https://xxxx.supabase.co IMPORT_SUPABASE_SECRET_KEY=sb_secret_... npm run import -- book.csv --apply
```

Keep the **batch id** it prints.

## What makes it safe

- **All or nothing.** A file with any problem is not imported at all. If the database
  refuses even one row, nothing from the file is saved (one transaction).
- **Checked before saving:** name, phone, loan amount, principal left (never more than
  the amount), interest setting, loan type, start date, next due date, security type,
  status, and that these agree with each other (a closed loan has no principal left;
  a running loan has a next collection after its start date).
- **Same file twice = saved once.** The file's contents decide the batch id.
- **No duplicate customers.** A phone number already in the system is reused.
- **Can be taken back**, completely, as long as no payment or waiver has been
  recorded on the imported loans:
  ```bash
  IMPORT_SUPABASE_URL=... IMPORT_SUPABASE_SECRET_KEY=... npm run import -- --undo <batch id>
  ```
- **Not reachable from the app.** Only someone holding the secret key can import.

## Before importing the real book

1. Take a backup (Actions → Backup).
2. Import 10–20 real rows first, look at them in the app with the owner, then take
   that import back (`--undo`) and import the full file.
3. After the full import, compare three totals with the owner's own records: number
   of running loans, total principal still out, and the list of loans that are behind.
   The check in step 1 prints all three.
