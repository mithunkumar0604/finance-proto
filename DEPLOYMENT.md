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

The site is a Cloudflare **Worker that serves static files** (project `finance-proto`),
connected to this GitHub repository and built from the `production` branch.
Stable address: **https://finance-proto.skaroweb.workers.dev**

How it is built is in `wrangler.jsonc` in this repository: `npx wrangler deploy` runs
`npm run build`, checks the result (`scripts/check-live-build.mjs`) and publishes the
`out` folder. There is no server code.

In the Cloudflare dashboard (Workers & Pages → finance-proto → Settings → Build):

| Setting | Value |
|---|---|
| Git repository / branch | `mithunkumar0604/finance-proto` / `production` |
| Build command | leave **empty** |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |
| **Build** variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and optionally `NEXT_PUBLIC_BUSINESS_NAME`) |

The two Supabase values must be **build** variables: they are baked into the site
when it is built. If they are missing, the build stops with a clear message instead
of publishing a demo site. No secret of any kind belongs in Cloudflare for this app.

Do not use a Next.js preset or `opennextjs-cloudflare`: this app is a static export
and that adapter fails on it.

To publish by hand from a computer signed in with `npx wrangler login` (uses the
values in `.env.local`): `npx wrangler deploy`.

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

Then wipe the test data and re-create the empty tables, so the project starts clean.
First remove any files the tests stored (Storage → `documents` in the dashboard), then:

```bash
npx supabase db reset --linked --no-seed
```

The reset clears the tables, functions, policies and logins, but leaves the two number
sequences behind, so re-applying stops at the first migration with
`relation "customer_no" already exists`. If that happens:

```bash
npx supabase db query --linked "drop sequence if exists public.customer_no, public.loan_no"
npx supabase db push
npx supabase db query --linked -f scripts/verify-hosted.sql    # must be 18 of 18 again
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

Pushing to the branch Cloudflare is connected to (`production`) builds and publishes
the site. `main` still holds the approved prototype; merging `production` into it is
a separate decision and is not needed for the site to be live.

### 8. Custom domain (when the client has bought one)

Cloudflare → Workers & Pages → finance-proto → Settings → Domains & Routes → add the
custom domain. The `workers.dev` address keeps working. Also turn on "Always Use
HTTPS" for the domain.

### 9. Existing customers

See `IMPORT.md`. Do not import real data until steps 1–7 are done and a real backup
has been restored successfully (`BACKUP_RESTORE.md`).

## Every deployment after that

Push to `production`. Cloudflare builds that commit and publishes it to the same
address. GitHub runs CI (lint, types, unit tests, build, database tests) on the same
commit; look for a red mark beside it. A build that fails on Cloudflare leaves the
live site as it was.

## Changing the database

1. Add a new file to `supabase/migrations` (never edit one that has been applied).
2. Test locally: `npx supabase db reset && npm run test:db`.
3. Merge, then run **Apply database changes**. It backs up first.

## Roll back

- App: Cloudflare → Workers & Pages → finance-proto → Deployments → roll back to an earlier version.
- Database: see `BACKUP_RESTORE.md`.

## The approved prototype

Tag `prototype-approved-v1` is the exact source the client approved, and
`prototype-approved-v1-site` the exact site that was shown. The demo at
https://mithunkumar0604.github.io/finance-proto/ is a separate build on demo data.
