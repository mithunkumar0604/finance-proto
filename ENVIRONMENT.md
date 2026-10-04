# Environment

Where every setting lives. Nothing secret is stored in this repository.

## Built into the app (public)

Set as GitHub **Variables** (Settings → Secrets and variables → Actions → Variables).
They end up in the browser, which is fine: the database decides what each user may do.

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public "anon" key |
| `NEXT_PUBLIC_BUSINESS_NAME` | Business name shown in the app and on receipts |
| `NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN` | Optional. Leave unset unless the business owns the domain (see below) |
| `CLOUDFLARE_PROJECT` | Name of the Cloudflare Pages project (decides the web address) |
| `BACKUP_REPO` | The private backup repository, as `owner/name` |

## Secrets

Set as GitHub **Secrets** (same page, Secrets tab). Never in code, never in a
`NEXT_PUBLIC_` variable.

| Secret | Used by | What it is |
|---|---|---|
| `SUPABASE_DB_URL` | backup, migrations | Postgres connection string. Use the **Session pooler** string from Supabase (Connect → Session pooler); GitHub cannot reach the direct one |
| `BACKUP_PASSPHRASE` | backup | Long random passphrase that encrypts backups. **Keep a copy outside GitHub** (password manager, and on paper with the owner). Without it backups cannot be opened |
| `BACKUP_REPO_TOKEN` | backup | GitHub fine-grained token with "Contents: read and write" on the backup repository only |
| `CLOUDFLARE_API_TOKEN` | deploy | Cloudflare token with "Cloudflare Pages: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | deploy | Cloudflare account id |

The Supabase **service-role key** is not used by the app or by any workflow. Keep it
in the Supabase dashboard only.

## Local development

Copy `.env.example` to `.env.local`.

- Leave the Supabase values empty to run on demo data.
- For a local database: `npx supabase start`, then put the printed `API_URL` and
  `ANON_KEY` in `.env.local`, then `npm run seed:local`.

## Logins and the e-mail domain

People sign in with a mobile number and a password. Supabase needs an e-mail address,
so the number is stored as `<number>@ledgerpro.invalid`. `.invalid` can never receive
mail, so nobody can have a password-reset link for a login sent anywhere.

Passwords are therefore reset by an administrator in the Supabase dashboard
(Authentication → Users), not by e-mail.

## Supabase project settings to check once

- Authentication → Sign In / Providers: **Allow new users to sign up = off**.
- Authentication → Policies: minimum password length 8 or more.
- Consider turning on MFA for the owner's login.
