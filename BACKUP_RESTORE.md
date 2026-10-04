# Backup and restore

Supabase is never the only copy of the data.

## What happens

Every night at 02:00 IST the **Backup** workflow (`.github/workflows/backup.yml`):

1. dumps all business data: customers, loans, collections, payments, security
   details, the activity log, and the logins;
2. compresses it and encrypts it (AES-256) with `BACKUP_PASSPHRASE`;
3. stores it in the private backup repository (`BACKUP_REPO`):
   - `daily/` — the last 60 days;
   - `monthly/` — the first backup of every month, kept for good.

It can also be started by hand (Actions → Backup → Run workflow), and it runs
automatically before any database change.

If a backup fails, GitHub e-mails the repository owner. **Check the Actions tab
once a week** until you trust it.

## What is not in the backup

- The table structure. It is in `supabase/migrations` in this repository.
- Photos and documents in Supabase Storage. (Download the `documents` bucket from
  the Supabase dashboard from time to time if files are being uploaded.)

## The passphrase

Without `BACKUP_PASSPHRASE` a backup cannot be opened. Keep a copy somewhere that
is not GitHub: a password manager, and on paper with the owner.

## Restore

You need Docker, `gpg`, the backup file, and the passphrase.

1. Create a new Supabase project (or use a local one: `npx supabase start`).
2. Create the tables: `npx supabase db push --db-url "<new database URL>"`.
3. Load the backup:
   ```bash
   DB_URL="<new database URL>" BACKUP_PASSPHRASE="..." scripts/restore.sh daily/ledgerpro-2026-10-04.sql.gz.gpg
   ```
   It refuses to run on a database that already has customers, and loads everything
   in one transaction (all of it or none of it).
4. Point the app at the new project: update `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_DB_URL` in GitHub, then run Deploy.

Logins are restored with their passwords, so people sign in as before.

## Test a restore

Do this once before handover and again every few months.

```bash
# 1. fingerprint the live data (one line per table)
docker run --rm -i -e DB_URL postgres:17 sh -c 'psql "$DB_URL" -At -F " "' < scripts/checksum.sql > before.txt

# 2. take a backup
DB_URL=... BACKUP_PASSPHRASE=... scripts/backup.sh test.sql.gz.gpg

# 3. restore it into an empty local database
npx supabase start && npx supabase db reset
DB_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres BACKUP_PASSPHRASE=... scripts/restore.sh test.sql.gz.gpg

# 4. fingerprint the restored data and compare
... same as step 1, against the local database ... > after.txt
diff before.txt after.txt     # no output = identical
```

### Last tested

4 October 2026, on the local stack with the demo book (60 customers, 67 loans, 332
collections, 271 payments, 4 logins): backup → wipe → restore. All 9 fingerprints
identical, a restored login signed in, new customer and loan numbers continued
after the restored ones, and the 46 database tests passed on the restored copy.
A wrong passphrase was refused.

**Not yet tested against the production Supabase project**, which does not exist
yet. Repeat the test above once it does.
