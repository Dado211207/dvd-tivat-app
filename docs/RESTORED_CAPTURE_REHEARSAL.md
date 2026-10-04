# Restored-copy P4 capture — cloud rehearsal path and production sequence

Prepared 2026-10-04. This is the operator runbook for method B (capture on a
restored copy) from the release prep. It records what was verified without
touching production, the exact cloud runner, the ordered production sequence,
and the smallest owner action. **No production role was created and no
production credential was requested to produce this document.** All probes
against the live projects were read-only or rolled back.

## Why a separate cloud runner

- The Claude cloud session that built this **cannot open a raw PostgreSQL
  connection**: its egress proxy carries HTTPS only (verified — the pooler
  ports are unreachable from it by design). So the dump cannot run there.
- This account's GitHub token **cannot create or drive a Codespace**: every
  `/repos/.../codespaces` endpoint returns `403 Resource not accessible by
  integration`, and the Actions-management API is blocked through the proxy.
  A Codespace remains a valid **manual** option the owner opens themselves.

### Exact runner

**GitHub Actions `ubuntu-latest`, via the manual workflow
`.github/workflows/supabase-dump-rehearsal.yml` (`workflow_dispatch`).** It
never runs on push/PR and uploads nothing. Standard Actions runners have IPv4
egress and reach Supabase's session pooler. Equivalent alternative: a Codespace
the owner opens on this repo and runs the same commands in. Both keep the dump
and capture on the ephemeral runner only.

### Endpoint (project region `eu-west-1`)

- Session pooler (use this): `aws-0-eu-west-1.pooler.supabase.com:5432`, user
  `dvd_release_dump.yskhdzrdbywrpfowckpn`. Session mode is required — `pg_dump`
  and the capture's `set local role` need a full session; the transaction
  pooler (`:6543`) does not provide one.
- The direct host `db.yskhdzrdbywrpfowckpn.supabase.co:5432` is IPv6-only
  without the paid IPv4 add-on, so Actions/Codespace (IPv4) use the pooler.
- Reachability is checked, with no credentials or data, by
  `scripts/restored-capture/reachability.mjs` (the workflow's `reachability`
  mode). This session could not run it (HTTPS-only egress); the owner-triggered
  runner does.

## Blocking finding: pg_net hardening needs Supabase, not the owner

`scripts/restored-capture/harden-pg-net.sql` revokes PUBLIC's privileges on
`net.http_request_queue` / `net._http_response`. **The project owner cannot run
it.** Those objects are owned by `supabase_admin`; the owner login `postgres`
is not a superuser and cannot `SET ROLE supabase_admin`, so its
`REVOKE ... FROM PUBLIC` raises a warning and changes nothing (verified on the
isolated project 2026-10-04: PUBLIC retained all eight privileges afterward).

A rolled-back probe of the dump role on the real isolated project
(`scripts/restored-capture/privileges.sql`, across every schema) confirms the
dump role's **only** residual write path is that pg_net queue — no role
membership, no `SECURITY DEFINER` functions, no `public`/`auth`/`vault`/
`pgsodium` writes. `verify-role` therefore refuses the dump while PUBLIC holds
pg_net. Two ways forward:

- **Clean (recommended): Supabase support** revokes PUBLIC on `net.*` (the body
  of `harden-pg-net.sql`, run as `supabase_admin`). Then the dump role has no
  write path and `verify-role` passes. The push cron keeps working — it runs as
  `postgres`, which `harden-pg-net.sql` re-grants `INSERT` + sequence `USAGE`;
  `net.http_post` is `SECURITY INVOKER` and its helper functions keep PUBLIC
  `EXECUTE` (verified on production, read-only).
- **Residual-accepted fallback:** keep pg_net as is and accept that the
  short-lived dump role *could*, if its holder were malicious, escalate via the
  documented cron-trigger trick. This is bounded by: the role lives ~1 hour and
  is dropped immediately; the runner and operator are trusted; and a malicious
  operator could instead use method A's `postgres`, which is strictly more
  powerful. If accepted, `verify-role` must be given an explicit opt-in (not yet
  implemented — add a reviewed `--accept-pgnet-residual` flag; do not weaken the
  default).

## Production sequence (ordered; review before any step)

Each step is an owner action unless marked. Nothing here has been executed
against production.

1. **pg_net:** Supabase support revokes PUBLIC on `net.*` (clean path), or the
   owner records acceptance of the residual (fallback). Confirm with a
   read-only check that PUBLIC no longer holds the queue (clean path).
2. **Create the dump role** from `scripts/restored-capture/dump-role.sql`, run
   in the dashboard SQL editor. Generate the password + SCRAM verifier with
   `node scripts/p4-restored-capture.mjs verifier`; paste only the verifier into
   the SQL; put the password only into the GitHub Actions **secret**
   `DVD_DUMP_DATABASE_URL` as the full session-pooler URL. The role expires in 4
   hours.
3. **Negative privilege check:** trigger the workflow in `full` mode; its first
   action is `verify-role`, which reads the role's effective privileges on the
   real project across every schema and refuses if any write path remains. (The
   same check can be run as the rolled-back probe before creating the role.)
4. **Dump + restore + capture + gate**, all on the runner, nothing uploaded:
   the workflow dumps `public` read-only through the pooler in one snapshot with
   a source attestation, restores into a throwaway `postgres:17` service,
   captures on that copy, requires it to reproduce the attestation, and runs
   `npm run gate:p4`. Pooler note: `pg_export_snapshot()` and `pg_dump
   --snapshot` are separate pooled sessions and may not share a snapshot; keep
   production quiet during the dump and treat the attestation's own
   re-measurement as the consistency check (as `release-preflight.sh` does with
   before/after counts).
5. **Encrypted backup + separate restore** (the existing
   `scripts/release-preflight.sh` covers this with `age` encryption and an
   independent restore target) — still required, still not passed.
6. **Drop the dump role** (`scripts/restored-capture/drop-dump-role.sql`) and
   delete the `DVD_DUMP_DATABASE_URL` secret.

## Keeping dumps and secrets out of Git, PRs, logs and CI artifacts

- The dump role URL lives only in a GitHub Actions secret; Actions masks it and
  every script prints no URL, row, or password.
- `scripts/p4-restored-capture.mjs` refuses any `--work`/`--out` path inside the
  repository; the workflow writes them under `$RUNNER_TEMP` and uploads no
  artifact. `.gitignore` already covers `*.production-export.json`.
- The encrypted backup from `release-preflight.sh` is written outside the repo
  and is never attached to a PR or CI run.

## Smallest owner action

One of:
- **Clean:** file a Supabase support request to revoke PUBLIC's privileges on
  `net.http_request_queue`, `net._http_response` and
  `net.http_request_queue_id_seq` (the exact statements are in
  `harden-pg-net.sql`). Then steps 2–6 are a dashboard paste plus one
  `workflow_dispatch` click with the secret set.
- **Fallback:** record acceptance of the pg_net residual and add the reviewed
  `verify-role` opt-in; then steps 2–6 as above.

Either way, the production-derived P4 gate and the backup/restore gate remain
**not passed** until the sequence actually runs against production.
