# Deployment

GitHub → Cloudflare Pages (the app) → Supabase (database, logins, private files).
All on free tiers. The web address never changes between deployments.

## One-time setup

### 1. Supabase

1. Create a project at supabase.com (region: Mumbai). Save the database password.
2. Authentication → Sign In / Providers: turn **off** "Allow new users to sign up".
3. Copy the project URL and the anon key (Project Settings → API).
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

GitHub → Actions → **Apply database changes** → Run workflow → type `apply`.
It takes a backup, then applies everything in `supabase/migrations`.

(The first run's backup step needs the tables to exist. For the very first time only,
run this from a computer instead:
`npx supabase db push --db-url "<SUPABASE_DB_URL>"`.)

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
