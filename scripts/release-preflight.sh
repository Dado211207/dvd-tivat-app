#!/usr/bin/env bash
# Private, local release rehearsal. No production write is issued. Run on a
# trusted Mac/Linux computer with Docker, Supabase CLI, PostgreSQL 17 client,
# age and Node installed. The secret URL is supplied in the environment, never
# as a command-line argument to this script or in a repository file.
set -euo pipefail
set +x
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
mode="${1:-check}"

fail() { printf 'Release preflight stopped: %s\n' "$1" >&2; exit 1; }

for cmd in node npm supabase docker psql age tar; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing $cmd. Install it before running this rehearsal."
done
docker info >/dev/null 2>&1 || fail 'Docker is not running.'

if [[ "$mode" == check ]]; then
  printf 'Required tools and Docker are available. Run with "run" after setting DVD_PRODUCTION_DB_URL, DVD_BACKUP_DIR and DVD_BACKUP_RECIPIENT.\n'
  exit 0
fi
[[ "$mode" == run ]] || fail 'Usage: bash scripts/release-preflight.sh [check|run]'
[[ -n "${DVD_PRODUCTION_DB_URL:-}" ]] || fail 'DVD_PRODUCTION_DB_URL is missing.'
[[ -n "${DVD_BACKUP_RECIPIENT:-}" && "$DVD_BACKUP_RECIPIENT" == age1* ]] || fail 'Set DVD_BACKUP_RECIPIENT to an age public recipient.'
[[ -n "${DVD_BACKUP_DIR:-}" && "$DVD_BACKUP_DIR" == /* ]] || fail 'DVD_BACKUP_DIR must be an existing absolute directory outside the repository.'

export DVD_READONLY_DATABASE_URL="$DVD_PRODUCTION_DB_URL"
node --input-type=module -e "import { sourceUrl } from './scripts/p4-capture-production.mjs'; sourceUrl(process.env.DVD_READONLY_DATABASE_URL)" \
  >/dev/null 2>&1 || fail 'The database URL is not for the expected DVD Tivat project.'
backup_dir="$(cd "$DVD_BACKUP_DIR" && pwd -P)" || fail 'Backup directory does not exist.'
case "$backup_dir/" in "$REPO/"*) fail 'Backup directory cannot be inside the repository.';; esac

work="$(mktemp -d "${TMPDIR:-/tmp}/boka-release.XXXXXXXX")"
started=0
cleanup() {
  if [[ "$started" == 1 ]]; then (cd "$work/local" && supabase stop >/dev/null 2>&1) || true; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir -p "$work/dump" "$work/local"

# Keep all database/CLI diagnostics private. They can include account data or
# the connection string; a failing run prints a generic stage and leaves no
# plaintext dump behind. The encrypted backup is retained even if restore fails.
run_private() {
  local stage="$1"; shift
  if ! "$@" >"$work/stage.log" 2>&1; then
    local diagnostic="$backup_dir/boka-preflight-diagnostic-$(date -u +%Y%m%dT%H%M%SZ)-$$.log.age"
    age -r "$DVD_BACKUP_RECIPIENT" -o "$diagnostic" "$work/stage.log" >/dev/null 2>&1 || true
    fail "$stage failed. Encrypted diagnostic: $diagnostic. Decrypt locally and redact before sharing."
  fi
  : >"$work/stage.log"
}

source_counts_sql="select (select count(*) from auth.users), (select count(*) from public.members), (select count(*) from public.interventions), (select count(*) from storage.objects), (select count(*) from storage.buckets), (select count(*) from supabase_migrations.schema_migrations)"
custom_sql="select (select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='create_dvd_account'), (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('report_objects_create_own','report_objects_read_authorized')), md5(coalesce((select pg_get_triggerdef(oid) from pg_trigger where tgrelid='auth.users'::regclass and tgname='create_dvd_account'),'') || '|' || coalesce((select string_agg(policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\\n' order by policyname) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('report_objects_create_own','report_objects_read_authorized')),''))"
source_before="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$DVD_PRODUCTION_DB_URL" -c "$source_counts_sql" 2>"$work/stage.log")" \
  || fail 'Production read-only count failed. Check the existing password and session connection.'
custom_before="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$DVD_PRODUCTION_DB_URL" -c "$custom_sql" 2>"$work/stage.log")" \
  || fail 'Production auth/storage definition check failed.'
[[ "$custom_before" == 1\|2\|* ]] || fail 'Expected app-owned auth trigger and two Storage policies are missing.'

cd "$work/dump"
run_private 'Roles dump' supabase db dump --db-url "$DVD_PRODUCTION_DB_URL" -f roles.sql --role-only
run_private 'Schema dump' supabase db dump --db-url "$DVD_PRODUCTION_DB_URL" -f schema.sql
run_private 'Data dump' supabase db dump --db-url "$DVD_PRODUCTION_DB_URL" -f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
run_private 'Migration history schema dump' supabase db dump --db-url "$DVD_PRODUCTION_DB_URL" -f history_schema.sql --schema supabase_migrations
run_private 'Migration history data dump' supabase db dump --db-url "$DVD_PRODUCTION_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations
for file in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do [[ -s "$file" ]] || fail "$file is empty."; done
cp "$REPO/scripts/restore-supabase-custom.sql" custom_auth_storage.sql

source_after="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$DVD_PRODUCTION_DB_URL" -c "$source_counts_sql" 2>"$work/stage.log")" \
  || fail 'Final production read-only count failed.'
[[ "$source_before" == "$source_after" ]] || fail 'Production row counts changed during backup; take another snapshot in a quiet window.'
custom_after="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$DVD_PRODUCTION_DB_URL" -c "$custom_sql" 2>"$work/stage.log")" \
  || fail 'Final production auth/storage definition check failed.'
[[ "$custom_before" == "$custom_after" ]] || fail 'Production auth/storage definitions changed during backup.'
printf 'Captured at %s UTC; auth users | members | interventions | storage objects | buckets | migration entries: %s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$source_before" > manifest.txt

archive="$backup_dir/boka-db-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
[[ ! -e "$archive" ]] || fail 'The encrypted archive filename already exists.'
tar -cf - roles.sql schema.sql data.sql history_schema.sql history_data.sql custom_auth_storage.sql manifest.txt | age -r "$DVD_BACKUP_RECIPIENT" -o "$archive" \
  >"$work/stage.log" 2>&1 || { rm -f -- "$archive"; fail 'Backup encryption failed.'; }
[[ -s "$archive" ]] || fail 'Encrypted archive is empty.'
printf 'Encrypted backup saved: %s\n' "$archive"

# A newly initialised local Supabase project is an independent restore target.
cd "$work/local"
run_private 'Local Supabase init' supabase init
run_private 'Local Supabase start' supabase start
started=1
local_url='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
local_major="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$local_url" -c "select current_setting('server_version_num')::int / 10000" 2>"$work/stage.log")" \
  || fail 'Local PostgreSQL connection failed.'
[[ "$local_major" == 17 ]] || fail 'The restore target must run PostgreSQL 17.'

cd "$work/dump"
run_private 'Independent restore' psql -X --single-transaction -v ON_ERROR_STOP=1 \
  -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql \
  --dbname "$local_url"
run_private 'Migration history restore' psql -X --single-transaction -v ON_ERROR_STOP=1 \
  -f history_schema.sql -f history_data.sql --dbname "$local_url"
run_private 'App-owned auth/storage restore' psql -X --single-transaction -v ON_ERROR_STOP=1 \
  -f custom_auth_storage.sql --dbname "$local_url"
restored="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$local_url" -c "$source_counts_sql" 2>"$work/stage.log")" \
  || fail 'Restored count check failed.'
[[ "$restored" == "$source_before" ]] || fail 'Restored row counts differ from the production snapshot.'
custom_restored="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$local_url" -c "$custom_sql" 2>"$work/stage.log")" \
  || fail 'Restored auth/storage definition check failed.'
[[ "$custom_restored" == "$custom_before" ]] || fail 'Restored auth/storage definitions differ from production.'
printf 'Independent PostgreSQL 17 restore counts match.\n'

# The gate creates/drops its own databases on the local server, not production.
cd "$REPO"
capture="$work/fresh.production-export.json"
run_private 'Production read-only equivalence capture' npm run capture:p4 -- "$capture"
export DVD_TEST_DATABASE_URL="$local_url"
run_private 'Production-copy migration equivalence gate' npm run gate:p4 -- "$capture" --report "$work/gate-report.json"
[[ -s "$work/gate-report.json" ]] || fail 'The gate produced no report.'
report="$archive.gate-report.age"
run_private 'Gate report encryption' age -r "$DVD_BACKUP_RECIPIENT" -o "$report" "$work/gate-report.json"
printf 'Production-copy equivalence gate passed. Encrypted backup: %s\nEncrypted gate report: %s\n' "$archive" "$report"
