#!/usr/bin/env bash
# Makes an encrypted copy of all business data: customers, loans, collections,
# payments, security details, activity log, and the logins.
#
#   DB_URL=postgresql://...  BACKUP_PASSPHRASE=...  scripts/backup.sh [output-file]
#
# The output is a gzip'd SQL data dump encrypted with AES-256 (gpg, symmetric).
# The table structure is not in the dump: it lives in supabase/migrations.
# See BACKUP_RESTORE.md.
set -euo pipefail
umask 077

: "${DB_URL:?Set DB_URL to the database connection string}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
out="${1:-ledgerpro-$(date -u +%Y-%m-%dT%H%MZ).sql.gz.gpg}"

# pg_dump must match the server's major version (17), so it runs from the official image.
# The connection string is handed to the container as an environment variable, so it
# never appears on a command line (process lists, logs).
pg() { docker run --rm -i -e DB_URL ${DOCKER_NET:---network host} postgres:17 sh -c 'tool="$1"; shift; exec "$tool" "$DB_URL" "$@"' sh "$@"; }
export DB_URL

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

{
  echo "-- LedgerPro backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # replica mode: rows go back exactly as they were, without firing triggers or
  # re-checking foreign keys row by row
  echo "SET session_replication_role = replica;"
  # logins first (profiles point at them)
  pg pg_dump --data-only --no-owner --no-privileges --table=auth.users --table=auth.identities
  pg pg_dump --data-only --no-owner --no-privileges --schema=public
  echo "SET session_replication_role = DEFAULT;"
} > "$tmp"

# A backup with no payments table in it is not a backup.
grep -q "^COPY public.payments " "$tmp" || { echo "backup looks incomplete: no payments table" >&2; exit 1; }

gzip -9 -c "$tmp" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 -o "$out" 3<<<"$BACKUP_PASSPHRASE"

echo "Backup written: $out ($(wc -c < "$out") bytes)"
echo "Rows:"
pg psql -At -F ' ' -c "select 'customers', count(*) from public.customers union all select 'loans', count(*) from public.loans union all select 'dues', count(*) from public.dues union all select 'payments', count(*) from public.payments union all select 'activity', count(*) from public.activity union all select 'logins', count(*) from auth.users order by 1"
