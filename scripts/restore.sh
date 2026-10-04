#!/usr/bin/env bash
# Loads a backup made by scripts/backup.sh into an EMPTY database that already has
# the table structure (a new Supabase project with the migrations applied).
#
#   DB_URL=postgresql://...  BACKUP_PASSPHRASE=...  scripts/restore.sh <backup-file>
#
# It refuses to run if the database already holds customers. See BACKUP_RESTORE.md.
set -euo pipefail

: "${DB_URL:?Set DB_URL to the database connection string}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
file="${1:?Usage: scripts/restore.sh <backup-file>}"

# The connection string is handed to the container as an environment variable, so it
# never appears on a command line (process lists, logs).
pg() { docker run --rm -i -e DB_URL ${DOCKER_NET:---network host} postgres:17 sh -c 'tool="$1"; shift; exec "$tool" "$DB_URL" "$@"' sh "$@"; }
export DB_URL

existing="$(pg psql -At -c "select count(*) from public.customers")"
if [ "$existing" != "0" ]; then
  echo "This database already has $existing customers. Restore only into an empty database." >&2
  exit 1
fi

# One transaction: either the whole backup is loaded, or nothing is.
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --decrypt "$file" 3<<<"$BACKUP_PASSPHRASE" \
  | gunzip -c \
  | pg psql --single-transaction -v ON_ERROR_STOP=1 -q

echo "Restored. Rows:"
pg psql -At -F ' ' -c "select 'customers', count(*) from public.customers union all select 'loans', count(*) from public.loans union all select 'dues', count(*) from public.dues union all select 'payments', count(*) from public.payments union all select 'activity', count(*) from public.activity union all select 'logins', count(*) from auth.users order by 1"
