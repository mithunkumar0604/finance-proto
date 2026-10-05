# How to fill the customer sheet

This sheet brings your existing customers and loans into LedgerPro.
**For now, please fill only 10 to 20 loans.** We check those together first. The
rest come later.

## The files

- `template.csv` — the empty sheet. Open it in Excel or Google Sheets and fill it.
- `sample-22.csv` — 22 made-up rows showing how each kind of loan is written.

When you finish, save it as **CSV** (in Excel: File → Save As → "CSV UTF-8").
You may move the columns around; please do not rename or delete them.

## The basic idea

- **One row = one loan.**
- A customer with two loans has **two rows**.
- We bring in **where each loan stands today**: principal left, what is pending, and
  the next date. We do **not** bring in old payments. From the day of the import,
  LedgerPro keeps every payment.
- Write amounts in rupees: `200000` or `2,00,000`. Both are fine.
- Leave a box empty if it does not apply.

## Dates: day first

Write every date as **day / month / year, with the full year**:

| Write | It means |
|---|---|
| `04/05/2026` | 4 May 2026 (never 5 April) |
| `31/01/2026` | 31 January 2026 |
| `04-05-2026` or `04.05.2026` | also fine, also 4 May 2026 |

Not accepted: `04/05/26` (short year), `4 May 2026`, `May 4, 2026`.
If a date cannot be read, nothing is brought in and you are told which row.

Before anything is brought in, we show you how the first few dates were read
(for example `"04/05/2026" = 4 May 2026`) so a wrong format is caught.

## Who is who

LedgerPro gives every customer its own number (C001, C002, …). The phone number is
only a way to contact them.

- **Two rows are the same customer** when the name **and** the phone are the same.
- **Two people who share one phone** (say, father and son) are two customers. Just
  write their two names.
- **No phone?** Leave `phone` empty.
- **Best of all:** if your book already has a number for each customer, write it in
  `customer_ref`. Rows with the same `customer_ref` are the same person, even if the
  phone is missing. Likewise write your own loan or page number in `loan_ref`. That
  number stops the same loan being brought in twice later.

## Which loans to pick for the first 10–20

Please include at least one of each, if you have them:

| Kind of loan | See this row in `sample-22.csv` |
|---|---|
| Monthly interest, customer paying on time | row 2 (Sample Arun) |
| Weekly interest | row 5 (Sample Chitra) |
| Customer who has **missed some months** | row 9 (Sample Ganesh) |
| A month that is **part-paid** | row 4 (Sample Bala) |
| Principal not yet returned at all | row 2 or row 7 |
| **Part of the principal** already returned | row 14 (Sample Kumar) |
| Loan fully **closed** | row 8 (Sample Fathima) |
| **Vehicle** as security | row 3 or row 12 |
| **Jewel** as security | row 7 (Sample Elango) |
| Short-term loan (15 or 30 days) | row 10, row 11 |
| **One customer with two loans** | rows 2 and 3 (Sample Arun) |
| Customer with **no phone** | row 22 |
| Two customers **sharing a phone** | rows 2 and 23 |

## What to put in each column

### About the customer

| Column | What to write | Needed? |
|---|---|---|
| `customer_ref` | Your own number for this customer, if your book has one | No, but best |
| `customer_name` | The customer's name | Yes |
| `phone` | 10-digit mobile number | No |
| `alt_phone` | A second number | No |
| `area` | Village / town / area | No, but useful |
| `address` | Full address | No |
| `id_ref` | Any ID you note down (e.g. "Aadhaar ending 4821") | No |
| `notes` | Anything to remember about the customer | No |

### About the loan

| Column | What to write | Needed? |
|---|---|---|
| `loan_ref` | Your own number for this loan (account / page number) | No, but best |
| `loan_type` | One of: `weekly`, `monthly`, `15day`, `30day`, `vehicle`, `jewel`, `custom` | Yes |
| `loan_amount` | Money you first gave | Yes |
| `principal_left` | Principal the customer still owes **today**. Same as `loan_amount` if nothing was returned. `0` if the loan is closed | Yes |
| `start_date` | The day you gave the money | Yes |
| `interest_style` | `percent` if you charge a percentage, `fixed` if you charge a fixed amount each time | Yes |
| `interest_value` | The percentage (e.g. `3`) **or** the fixed amount in rupees (e.g. `2500`) | Yes |
| `interest_method` | `reducing` = interest on the principal still owed. `fixed` = interest on the amount first given, even after some is returned | Yes |
| `frequency` | How often you collect: `weekly`, `15days`, `30days` or `monthly` | Yes |
| `principal_per_collection` | Only if the customer returns some principal with **every** collection: that amount. Otherwise leave empty | No |
| `reference` | A short note on the loan (e.g. "shop stock") | No |

### Where the loan stands today

| Column | What to write | Needed? |
|---|---|---|
| `status` | `active` if the loan is running, `closed` if it is fully settled | Yes |
| `next_due_date` | **The oldest collection the customer has not paid yet.** If they are up to date, this is the next collection date. If they missed July, August and September, write July's date — the app will then show all three months as pending | Yes, for running loans |
| `interest_already_paid` | Only if that oldest unpaid collection is **part-paid**: how much of it they already paid | No |
| `interest_pending_today` | **Your own figure** for how much interest this customer owes you today. We compare it with what the app works out. If the two differ, nothing is brought in until we find out why | No, but please fill it |
| `last_paid_date` | The day the customer last paid you | No, but useful |
| `closed_date` | The day the loan was settled | Yes, for closed loans |

### Security held (if any)

| Column | What to write | Needed? |
|---|---|---|
| `security_type` | `none`, `jewel`, `vehicle`, `document` or `other` | Yes |
| `security_description` | What you hold (e.g. "Gold chain 38 g", "Bajaj Pulsar 220", "Sale deed") | No |
| `vehicle_registration` | The vehicle number (e.g. `TN 33 AB 1234`) | Yes, for vehicles |

## Three examples in words

**1. Up to date.** Arun took ₹2,00,000 on 1 March at 3% a month and has returned
nothing. He pays every month; the next one is 1 November.
→ `loan_amount` 200000, `principal_left` 200000, `next_due_date` 01/11/2026,
`interest_pending_today` 0.

**2. Missed months.** Ganesh took ₹3,00,000 at 3% a month. He last paid on 30 June
and has not paid July, August or September.
→ `next_due_date` 30/07/2026 (the first one he missed), `last_paid_date` 30/06/2026,
`interest_pending_today` 27000. The app will show three months pending, ₹9,000 each.

**3. Part-paid month.** Bala owes ₹1,00,000 at 3% (₹3,000 a month). For the month
due on 15 October he has already given ₹1,000.
→ `next_due_date` 15/10/2026, `interest_already_paid` 1000. The app shows ₹2,000 left.

## What is not brought in

**Old payments are not brought in.** For these loans the app says "Collected since
(the day of import)", because it cannot know what you collected before. A closed
loan comes in as a record only: closed, with its date, nothing to collect.

## What happens after you send the sheet

1. The sheet is checked. If any row has a mistake, **nothing** is brought in and you
   get a list: which row, which column, what is wrong.
2. You are shown what each loan will look like on day one: principal left, interest
   pending, how many months.
3. When it is clean, the 10–20 loans are brought in.
4. You open 3 to 5 customers you know well and compare with your book.
5. Only when you are happy do we bring in everyone else.
