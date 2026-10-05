# Deployment

GitHub → Cloudflare Pages (the app) → Supabase (database, logins, private files).
All on free tiers. The web address never changes between deployments.

## One-time setup

### 1. Supabase

1. Create a project at supabase.com (region: Mumbai is closest; any works). Save the database password.
2. Authentication → Sign In / Providers: turn **off** "Allow new users to sign up".
   Check it took effect: `curl -s <project URL>/auth/v1/settings -H "apikey: <publishable key>"` must show `"disable_signup":true`.
3. Copy the project URL and the **publishable** key (Project Settings → API Keys).
4. Copy the **Session pooler** connection string (Connect → Session pooler) and put
   the database password into it. This is `SUPABASE_DB_URL`.

### 2. Backup repository

1. Create a **private** GitHub repository, e.g. `ledgerpro-backups`, with a README.
2. Create a fine-grained token (GitHub → Settings → Developer settings) limited to
   that repository, permission "Contents: read and write". This is `BACKUP_REPO_TOKEN`.
3. Choose a long passphrase. This is `BACKUP_PASSPHRASE`. Store a copy outside GitHub.

### 3. Cloudflare

1. Create a Cloudflare account. Workers & Pages → Create → Pages → "Upload assets",
   name the project (e.g. `ledgerpro`). The address will be `https://ledgerpro.pages.dev`.
2. Create an API token with the "Cloudflare Pages: Edit" permission.
3. Note the account id (Workers & Pages overview, right-hand side).

### 4. GitHub settings

Add the variables and secrets listed in `ENVIRONMENT.md`.

### 5. Create the tables

From a computer where the Supabase CLI is logged in (`npx supabase login`):

```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run     # lists what would be applied; changes nothing
npx supabase db push               # applies it
npx supabase db query --linked -f scripts/verify-hosted.sql    # read-only: every line must say ok = true
npx supabase db advisors --linked  # Supabase's own security and performance checks
```

`verify-hosted.sql` checks, without writing anything: every table has row level
security; nothing is reachable without signing in; signed-in users cannot write money
tables or delete anything; only the app's functions can be called; the documents
bucket is private; the history locks exist; the interest and date rules give the
tested answers.

The advisors will list "Signed-In Users Can Execute SECURITY DEFINER Function" for
the app's own functions (`record_payment`, `create_loan`, …). That is by design:
those functions are the only way money changes, and each one checks who is calling.

Later changes to the database can also be applied from GitHub (Actions → **Apply
database changes**), which takes a backup first.

### 5a. Verify the new project (before any real data goes in)

While the project holds no real data, run the database tests against it. They create
test logins, customers and loans, and check access rules, roles, payments, missed
interest, waivers, private files and the import.

```bash
SUPABASE_TEST_URL=https://xxxx.supabase.co \
SUPABASE_TEST_PUBLISHABLE_KEY=<publishable key> \
SUPABASE_TEST_SECRET_KEY=<secret key> \
SUPABASE_TEST_ALLOW_REMOTE=this-project-has-no-real-data \
npm run test:db
```

To look at the app with safe demo data, load the fictional demo book the same way
(`npm run seed:local` with the same four variables; it refuses a database that
already has customers).

Then wipe the test data and re-create the empty tables, so the project starts clean:

```bash
npx supabase db reset --db-url "<SUPABASE_DB_URL>"
```

**Never run these once real customers are in the project.** After that, use the
local stack for tests.

### 6. Create the first login (the owner)

1. Supabase → Authentication → Users → Add user. E-mail: `<mobile>@ledgerpro.invalid`
   (10 digits, no spaces), a strong password, "Auto confirm user" on.
2. Supabase → SQL editor:
   ```sql
   insert into public.profiles (id, name, phone, role)
   select id, 'Owner name', '98xxxxxxxx', 'owner' from auth.users where email = '98xxxxxxxx@ledgerpro.invalid';
   ```

Collectors and staff are added the same way with role `collector` or `staff`. The
owner can then change a role or switch a login off from Users & Roles in the app.

### 7. Go live

Merge the `production` branch into `main`. That runs the checks and browser tests
and, if they pass, publishes to Cloudflare Pages.

### 8. Custom domain (when the client has bought one)

Cloudflare → the Pages project → Custom domains → add the domain. The
`pages.dev` address keeps working.

### 9. Existing customers

See `IMPORT.md`. Do not import real data until steps 1–7 are done and a real backup
has been restored successfully (`BACKUP_RESTORE.md`).

## Every deployment after that

Push to `main`. The Deploy workflow:

1. runs lint, type check, unit tests and the browser tests against a local database;
2. builds the app with the production settings;
3. publishes to the same Cloudflare Pages project.

A failed check stops the deployment; the live site is not touched.

## Changing the database

1. Add a new file to `supabase/migrations` (never edit one that has been applied).
2. Test locally: `npx supabase db reset && npm run test:db`.
3. Merge, then run **Apply database changes**. It backs up first.

## Roll back

- App: Cloudflare → the Pages project → Deployments → "Rollback" on an earlier one.
- Database: see `BACKUP_RESTORE.md`.

## The approved prototype

Tag `prototype-approved-v1` is the exact source the client approved, and
`prototype-approved-v1-site` the exact site that was shown. The demo at
https://mithunkumar0604.github.io/finance-proto/ is a separate build on demo data.
