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

for cmd in node npm supabase docker psql age tar git; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing $cmd. Install it before running this rehearsal."
done
docker info >/dev/null 2>&1 || fail 'Docker is not running.'

if [[ "$mode" == check ]]; then
  printf 'Required tools and Docker are available. Run with "run" after setting DVD_PRODUCTION_DB_URL, DVD_BACKUP_DIR and DVD_BACKUP_RECIPIENT.\n'
  exit 0
fi
[[ "$mode" == run ]] || fail 'Usage: bash scripts/release-preflight.sh [check|run]'
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || fail 'The release checkout has uncommitted files. Use a clean candidate commit.'
candidate_sha="$(git -C "$REPO" rev-parse HEAD)"
# The password-bearing URL arrives on file descriptor 3 from release-preflight.mjs
# (or in DVD_PRODUCTION_DB_URL when run by hand) and stays an unexported shell
# variable: only the passfile writer and the capture below are given it.
production_url="${DVD_PRODUCTION_DB_URL:-}"
unset DVD_PRODUCTION_DB_URL
[[ -n "$production_url" ]] || { IFS= read -r production_url <&3 || true; } 2>/dev/null
exec 3<&-
[[ -n "$production_url" ]] || fail 'DVD_PRODUCTION_DB_URL is missing.'
[[ -n "${DVD_BACKUP_RECIPIENT:-}" && "$DVD_BACKUP_RECIPIENT" == age1* ]] || fail 'Set DVD_BACKUP_RECIPIENT to an age public recipient.'
[[ -n "${DVD_BACKUP_DIR:-}" && "$DVD_BACKUP_DIR" == /* ]] || fail 'DVD_BACKUP_DIR must be an existing absolute directory outside the repository.'

backup_dir="$(cd "$DVD_BACKUP_DIR" && pwd -P)" || fail 'Backup directory does not exist.'
case "$backup_dir/" in "$REPO/"*) fail 'Backup directory cannot be inside the repository.';; esac

work="$(mktemp -d "${TMPDIR:-/tmp}/boka-release.XXXXXXXX")"
# The restore target is a Postgres of its own for this run only (see
# scripts/restore-target.mjs), so no earlier run's database is ever reused.
# Cleanup removes exactly its labelled containers, volumes and network - which
# hold the restored copy - and nothing else in Docker.
stack_id=''
cleanup() {
  local status=$?
  if [[ -n "$stack_id" ]] && ! node "$REPO/scripts/restore-target.mjs" down "$stack_id" >/dev/null 2>&1; then
    printf 'Release preflight: restore target %s was not fully removed. Remove it: node scripts/restore-target.mjs down %s\n' "$stack_id" "$stack_id" >&2
    status=1
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
mkdir -p "$work/dump"

# The password reaches psql and Supabase CLI (and through it pg_dump) only via
# a private libpq passfile inside $work, removed with it on exit: a URL in a
# command's arguments is visible to other processes (ps, /proc/<pid>/cmdline).
# db_url is the same URL without its password. Exit 3: not the DVD Tivat project.
export PGPASSFILE="$work/pgpass"
db_url="$(DVD_PRODUCTION_DB_URL="$production_url" node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  import { sourceUrl } from "./scripts/p4-capture-production.mjs";
  let url;
  try { url = sourceUrl(process.env.DVD_PRODUCTION_DB_URL); } catch { process.exit(3); }
  const field = (s) => s.replace(/[\\:]/g, (c) => "\\" + c);
  const entry = [url.hostname, url.port || "5432", decodeURIComponent(url.pathname.slice(1)),
    decodeURIComponent(url.username), decodeURIComponent(url.password)].map(field).join(":");
  writeFileSync(process.env.PGPASSFILE, `${entry}\n`, { mode: 0o600, flag: "wx" });
  url.password = "";
  process.stdout.write(url.toString());
')" || { [[ $? == 3 ]] && fail 'The database URL is not for the expected DVD Tivat project.'; fail 'Could not prepare the private password file.'; }

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
source_before="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "$source_counts_sql" 2>"$work/stage.log")" \
  || fail 'Production read-only count failed. Check the existing password and session connection.'
custom_before="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "$custom_sql" 2>"$work/stage.log")" \
  || fail 'Production auth/storage definition check failed.'
[[ "$custom_before" == 1\|2\|* ]] || fail 'Expected app-owned auth trigger and two Storage policies are missing.'

cd "$work/dump"
run_private 'Roles dump' supabase db dump --db-url "$db_url" -f roles.sql --role-only
run_private 'Schema dump' supabase db dump --db-url "$db_url" -f schema.sql
run_private 'Data dump' supabase db dump --db-url "$db_url" -f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
run_private 'Migration history schema dump' supabase db dump --db-url "$db_url" -f history_schema.sql --schema supabase_migrations
run_private 'Migration history data dump' supabase db dump --db-url "$db_url" -f history_data.sql --use-copy --data-only --schema supabase_migrations
for file in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do [[ -s "$file" ]] || fail "$file is empty."; done
cp "$REPO/scripts/restore-supabase-custom.sql" custom_auth_storage.sql
# pg_dump leaves extension-owned tables out of the data dump, so pg_cron's jobs
# and pg_net's queue are exported separately, read-only, for the archive only.
# They are never restored locally (see scripts/restore-accounting.mjs).
: > operational.sql
for table in cron.job cron.job_run_details net.http_request_queue net._http_response; do
  present="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "select to_regclass('$table') is not null" 2>"$work/stage.log")" \
    || fail "Operational table check failed for $table."
  [[ "$present" == t ]] || continue
  printf 'COPY %s FROM stdin;\n' "$table" >> operational.sql
  psql -X -q -v ON_ERROR_STOP=1 --dbname "$db_url" -c 'set default_transaction_read_only = on' -c "copy $table to stdout" \
    >> operational.sql 2>"$work/stage.log" || fail "Operational export failed for $table."
  printf '\\.\n\n' >> operational.sql
done
operational_counts="$(node "$REPO/scripts/restore-accounting.mjs" count operational.sql)" || fail 'Operational export is malformed.'
# Secrets are not in this backup, and no secret value is ever read here: Supabase
# CLI excludes the vault schema (its ciphertext is bound to the project's own key
# anyway), and the push worker's Edge Function secrets live outside the database.
# Only names and counts are recorded, so the owner's re-provisioning step can be
# checked against them (docs/P7_P8_RELEASE_PREP.md, "Secret material").
vault_secret_names='vault absent'
if [[ "$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "select to_regclass('vault.secrets') is not null" 2>"$work/stage.log")" == t ]]; then
  vault_secret_names="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "select coalesce(string_agg(coalesce(name, '(unnamed)'), ', ' order by name), 'none') from vault.secrets" 2>"$work/stage.log")" \
    || fail 'Vault secret inventory (names only) failed.'
fi
cron_secret_use='cron absent'
if [[ "$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "select to_regclass('cron.job') is not null" 2>"$work/stage.log")" == t ]]; then
  cron_secret_use="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "select count(*) filter (where command ~* 'vault\.decrypted_secrets') || ' read Vault, ' || count(*) filter (where command !~* 'vault\.decrypted_secrets' and command ~* 'x-push-worker-secret|authorization') || ' carry a credential inline, of ' || count(*) from cron.job" 2>"$work/stage.log")" \
    || fail 'Scheduled-job secret check failed.'
fi
run_private 'Local restore copy' node "$REPO/scripts/restore-accounting.mjs" split data.sql data.restore.sql accounting.json

source_after="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "$source_counts_sql" 2>"$work/stage.log")" \
  || fail 'Final production read-only count failed.'
[[ "$source_before" == "$source_after" ]] || fail 'Production row counts changed during backup; take another snapshot in a quiet window.'
custom_after="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$db_url" -c "$custom_sql" 2>"$work/stage.log")" \
  || fail 'Final production auth/storage definition check failed.'
[[ "$custom_before" == "$custom_after" ]] || fail 'Production auth/storage definitions changed during backup.'
printf 'Candidate: %s\nCaptured at %s UTC; auth users | members | interventions | storage objects | buckets | migration entries: %s\n' \
  "$candidate_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$source_before" > manifest.txt
printf 'Operational tables in operational.sql (archive only, never restored locally): %s\n' "${operational_counts:-none present}" >> manifest.txt
{
  printf 'THIS IS A DATABASE BACKUP, NOT A COMPLETE RECOVERY: secret material is not included.\n'
  printf 'Vault secrets (names only; values not in this backup): %s\n' "$vault_secret_names"
  printf 'Scheduled jobs: %s (an inline credential is in operational.sql, inside this encrypted archive).\n' "$cron_secret_use"
  printf 'Edge Function secrets (outside the database; not in this backup): VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT, PUSH_WORKER_SECRET, ALLOWED_ORIGIN; SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are supplied per project by Supabase.\n'
  printf 'Re-provision them from the owner'"'"'s offline record: docs/P7_P8_RELEASE_PREP.md, "Secret material".\n'
} >> manifest.txt

archive="$backup_dir/boka-db-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
[[ ! -e "$archive" ]] || fail 'The encrypted archive filename already exists.'
tar -cf - roles.sql schema.sql data.sql operational.sql history_schema.sql history_data.sql custom_auth_storage.sql manifest.txt | age -r "$DVD_BACKUP_RECIPIENT" -o "$archive" \
  >"$work/stage.log" 2>&1 || { rm -f -- "$archive"; fail 'Backup encryption failed.'; }
[[ -s "$archive" ]] || fail 'Encrypted archive is empty.'
printf 'Encrypted database backup saved (secrets not included - see its manifest): %s\n' "$archive"

# The independent restore target: a fresh Postgres for this run only, published
# on 127.0.0.1 alone. Supabase CLI's `supabase start` binds every port on all
# interfaces and has no option to change it, so it is not used here.
stack_id="boka-restore-$(date -u +%Y%m%d%H%M%S)-$RANDOM"
local_port="$(node "$REPO/scripts/restore-target.mjs" up "$stack_id" 2>"$work/stage.log")" \
  || fail 'The local restore target could not be started on loopback only.'
# Nothing is restored unless every port this run publishes is bound to loopback.
node "$REPO/scripts/restore-target.mjs" check "$stack_id" >/dev/null 2>"$work/stage.log" \
  || fail 'The local restore target publishes ports beyond this machine. Refusing to restore production data into it.'
# Every session on the restore target, the gate's included, runs in UTC.
local_url="postgresql://postgres@127.0.0.1:$local_port/postgres?options=-c%20TimeZone%3DUTC"  # password: PGPASSFILE
local_major="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$local_url" -c "select current_setting('server_version_num')::int / 10000" 2>"$work/stage.log")" \
  || fail 'Local PostgreSQL connection failed.'
[[ "$local_major" == 17 ]] || fail 'The restore target must run PostgreSQL 17.'
fresh="$(psql -X -A -t -v ON_ERROR_STOP=1 --dbname "$local_url" -c "select count(*) from pg_tables where schemaname = 'public'" 2>"$work/stage.log")" \
  || fail 'Local restore target check failed.'
[[ "$fresh" == 0 ]] || fail 'The restore target is not a fresh database.'

cd "$work/dump"
DVD_RESTORE_TARGET_URL="$local_url" run_private 'Local restore roles copy' node "$REPO/scripts/restore-accounting.mjs" roles roles.sql roles.restore.sql accounting.json
run_private 'Independent restore' psql -X --single-transaction -v ON_ERROR_STOP=1 \
  -f roles.restore.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.restore.sql \
  --dbname "$local_url"
# Every restored table must hold exactly the dumped rows, and the target no
# pg_cron job or pg_net request, before anything else runs against it.
DVD_RESTORE_TARGET_URL="$local_url" run_private 'Restore accounting' node "$REPO/scripts/restore-accounting.mjs" verify accounting.json
# A fresh restore target may already own this schema. Replace its
# empty local ledger inside the isolated target before restoring the source.
run_private 'Migration history restore' psql -X --single-transaction -v ON_ERROR_STOP=1 \
  -c 'drop schema if exists supabase_migrations cascade' \
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
# The URL is assigned on the node command itself: an assignment in front of a
# shell function is exported to everything it runs, including run_private's age.
capture_p4() { DVD_READONLY_DATABASE_URL="$production_url" node scripts/p4-capture-production.mjs "$1"; }
run_private 'Production read-only equivalence capture' capture_p4 "$capture"
unset production_url
export DVD_TEST_DATABASE_URL="$local_url"
run_private 'Production-copy migration equivalence gate' npm run gate:p4 -- "$capture" --report "$work/gate-report.json"
[[ -s "$work/gate-report.json" ]] || fail 'The gate produced no report.'
report="$archive.gate-report.age"
run_private 'Gate report encryption' age -r "$DVD_BACKUP_RECIPIENT" -o "$report" "$work/gate-report.json"
accounting_report="$archive.restore-accounting.age"
run_private 'Restore accounting encryption' age -r "$DVD_BACKUP_RECIPIENT" -o "$accounting_report" "$work/dump/accounting.json"
printf 'Production-copy equivalence gate passed for %s.\nEncrypted database backup (secrets not included): %s\nEncrypted gate report: %s\nEncrypted restore accounting: %s\n' \
  "$candidate_sha" "$archive" "$report" "$accounting_report"
