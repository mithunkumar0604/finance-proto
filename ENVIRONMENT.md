# Environment

Where every setting lives. Nothing secret is stored in this repository.

## Built into the app (public)

Set as GitHub **Variables** (Settings → Secrets and variables → Actions → Variables).
They end up in the browser, which is fine: the database decides what each user may do.

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_...`), from Project Settings → API Keys |
| `NEXT_PUBLIC_BUSINESS_NAME` | Business name shown in the app and on receipts |
| `NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN` | Optional. Leave unset unless the business owns the domain (see below) |
| `BACKUP_REPO` | The private backup repository, as `owner/name` |

The same two Supabase values (and the business name, if used) must also be set in
**Cloudflare** as **build** variables, because Cloudflare builds the site itself
(`DEPLOYMENT.md`, section 3). Cloudflare needs no secrets for this app.

## Secrets

Set as GitHub **Secrets** (same page, Secrets tab). Never in code, never in a
`NEXT_PUBLIC_` variable.

| Secret | Used by | What it is |
|---|---|---|
| `SUPABASE_DB_URL` | backup, migrations | Postgres connection string. Use the **Session pooler** string from Supabase (Connect → Session pooler); GitHub cannot reach the direct one |
| `BACKUP_PASSPHRASE` | backup | Long random passphrase that encrypts backups. **Keep a copy outside GitHub** (password manager, and on paper with the owner). Without it backups cannot be opened |
| `BACKUP_REPO_TOKEN` | backup | GitHub fine-grained token with "Contents: read and write" on the backup repository only |

The Supabase **secret key** (`sb_secret_...`, formerly the "service role" key) is not
used by the app or by any workflow. It bypasses every access rule. Keep it in the
Supabase dashboard; it is needed only on an administrator's computer, for the one-off
project check (`DEPLOYMENT.md` 5a) and for importing customers (`IMPORT.md`).

Older names still work if they are already set somewhere:
`NEXT_PUBLIC_SUPABASE_ANON_KEY` for the publishable key, and `*_SERVICE_KEY` /
`IMPORT_SERVICE_ROLE_KEY` for the secret key.

## Local development

Copy `.env.example` to `.env.local`.

- Leave the Supabase values empty to run on demo data.
- For a local database: `npx supabase start`, then put the printed `API_URL` and
  `PUBLISHABLE_KEY` in `.env.local`, then `npm run seed:local`.

## Logins and the e-mail domain

People sign in with a mobile number and a password. Supabase needs an e-mail address,
so the number is stored as `<number>@ledgerpro.invalid`. `.invalid` can never receive
mail, so nobody can have a password-reset link for a login sent anywhere.

Each person changes their own password in the app (More → Settings → Security →
Change Password; the current password is asked for). A forgotten password is reset by
an administrator in the Supabase dashboard
(Authentication → Users), not by e-mail.

## Supabase project settings to check once

- Authentication → Sign In / Providers: **Allow new users to sign up = off**.
- Authentication → Policies: minimum password length 8 or more.
- Authentication → Policies (or "Password security"): if the project offers **"Require
  current password when updating"**, turn it on. The app already asks for the current
  password and sends it; this setting makes the server refuse a change without it, so
  someone holding an unlocked phone cannot change the password by other means.
- Consider turning on MFA for the owner's login.
