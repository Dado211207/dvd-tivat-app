Warning: truncated output (original token count: 10421)
Total output lines: 177

# P7 + P8 release candidate: execution record

## Current publication safety note — 2026-10-10

- The production application remains at <https://dado211207.github.io/dvd-tivat-app/>. The app release evidence and hosted-service checks below are dated checkpoints; the public guide is now separately published.
- The public guide <https://firenexa.netlify.app/> is on production deploy `6ac9de70b321ea9896777e0f`, ready and published on 10 October 2026 at 06:45 UTC.
- The deployed guide package was built with the production Pages app URL as its app and QR target; its preview was visually checked before publication. The separate <https://firenexa-app.netlify.app/> remains isolated test infrastructure and is not the guide target.
- The 9 October safety note below describes the preceding guide deployment and is superseded by this verified publication.
- Application acceptance remains separate: password-recovery email flow, physical Android acceptance, a fresh encrypted post-rollout backup and restore rehearsal, and three supervised fictional pilot exercises. Do not treat guide publication or CI as operational acceptance.

## Previous production checkpoint — 2026-10-08

- **Production:** the public Pages application is
  <https://dado211207.github.io/dvd-tivat-app/>. Before this finishing branch,
  `main` was `2c1f13e`; CI and the Pages deployment passed on that head.
- **Database and worker:** 49 migrations are applied through
  `20261006130000_response_aware_push_reminders.sql`; `send-web-push` v7 and the
  one-minute scheduler are active. There was no open intervention or queued,
  retrying or pending Web Push row in the latest read-only check.
- **Real-device evidence:** the owner completed signup/confirmation/sign-in,
  installed the iPhone PWA, received the initial alert and the single
  response-aware reminder after 30+ seconds, saved a response and closed the
  fictional TEST call-out. A second prepared test account also received both
  pushes. Test accounts were disabled and trial roster data was removed.
- **Guide at that checkpoint:** the guide URL was <https://firenexa.netlify.app/>.
  Its target was not correctly rechecked in that checkpoint; the 9 October
  verification above is authoritative for link and QR safety.
- **Recovery:** custom SMTP and email confirmation are accepted. Password
  recovery remains hidden until the recovery template and complete reset flow
  pass their own real-mail acceptance.
- **Recovery evidence still open:** the successful encrypted rehearsal and
  equivalence gate at `471bd7f` predate the final hosted migrations. Create and
  independently decrypt/restore a fresh encrypted post-rollout backup before
  relying on it for recovery.
- **This finishing branch:** adds one security-advisor migration, professional
  invite/recovery templates and current onboarding/release evidence. Record its
  exact CI head before applying the migration or publishing a new build.

The dated sections below are retained as historical evidence and do not
override this checkpoint.


## Current release checkpoint — 2026-10-06 after production deployment (supersedes historical checkpoints below)

- **Main release:** PR [#83](https://github.com/Dado211207/dvd-tivat-app/pull/83) was merged to `main` at `5ee2583a0252d35f8b5a724c4fd288c144b753af`. Main push CI run [37465050257](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37465050257) passed on that exact SHA.
- **Production-derived rehearsal:** the owner ran method A on 2026-10-06 at candidate ancestor `471bd7f2730fdd75dc4329bd6baabd40a0579302`. The encrypted database archive was created, an independent PostgreSQL 17 restore count check matched, and `gate:p4` passed. **Timing limitation:** that archive predates the production migration rollout, so it is a pre-rollout snapshot, not a recovery point for the current 48-migration production database. Before relying on a database rollback/recovery, create and independently restore a fresh encrypted backup of the current production state. A decrypt check of the retained archive using an offline recovery-key copy on a second device, the owner-held secret inventory, Storage object recovery, and an application rollback rehearsal are not evidenced as complete. The archive is database-only and excludes Edge Function/Vault secrets and project configuration.
- **Production database:** all 48 migration names in the merged candidate are applied. The latest ledger entry is `owner_prepare_service_member` (hosted version `20261006122939`). No open intervention or pending/retry Web Push outbox row was present during the 2026-10-06 read-only check. No test call or alert was sent.
- **Push service:** production `send-web-push` is ACTIVE v6 and the one-minute scheduler is active. These facts do not prove a notification reached a phone. The Actions variable contains a syntactically valid public VAPID key, but its match to the currently configured private key has not been verified on a device.
- **Application:** GitHub Pages deploy [37466894648](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37466894648) succeeded on the merged main SHA. The published URL is <https://dado211207.github.io/dvd-tivat-app/>; it loads the FireNexa logged-out screen. Its Pages build is configured for the production Supabase URL. Repository variables also enable multi-service administration and the Pages release latch.
- **Membership and access gaps:** production aggregates show DVD 6 active memberships and SZS 0. There is one active global OWNER; its profile is complete, but it has no active DVD service-member link. Do not invent or attach a member record by name. Complete the owner’s real member link through the application’s owner workflow and add only verified SZS people/roles.
- **Guide and QR:** the live guide <https://firenexa.netlify.app/> still points its app links and QR to <https://firenexa-app.netlify.app/>, the isolated test app. A source-level fix and regression guard are proposed in PR #101; until a verified draft is published to Netlify, do not distribute the current guide/QR for member registration. The production app itself is available at the GitHub Pages URL above.
- **Operational acceptance is NOT complete:** no production-device login/push acceptance, no SZS/dual-service device matrix, no three supervised fictional exercises, and no recorded human-fallback/rollback rehearsal are present in [RELEASE_ACCEPTANCE.md](./RELEASE_ACCEPTANCE.md). Web Push is best-effort and the application is not a replacement for official emergency channels. Do not rely on it as the sole call-out channel until the acceptance record is complete and approved.

## Checkpoint — 2026-10-04 evening (supersedes the guide, gate-input and capture-role statements in the checkpoint below)

- **Candidate:** draft [#83](https://github.com/Dado211207/dvd-tivat-app/pull/83), `codex/callout-readiness`. The guide below was built and verified from head **`5d31f40caeedab78005f65cb41d113ce828358d3`**; CI run [`37217939609`](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37217939609) **succeeded** on that exact head. This record and the capture-role test merge on top of it; the #83 description carries the resulting head and its CI. `main` (`4403fcad…`) and [#79](https://github.com/Dado211207/dvd-tivat-app/pull/79) are untouched.
- **Guide published.** <https://firenexa.netlify.app/> now serves deploy **`6ac2a05f9fa3f188e860c23c`** (site `6dcc0123-3287-43a5-98a2-0ee25d33b5f2`), uploaded as a draft, verified, then published unchanged. Previous live deploy, for rollback: `6ac15ece1e8fab8653e75379`. Details: [FIRENEXA_PUBLICATION.md](./FIRENEXA_PUBLICATION.md).
- **⚠ The guide's QR is not for member sign-up yet.** Its QR and every link target `https://firenexa-app.netlify.app/`, which is connected to the **isolated test** Supabase project `zoipjcdtcfetqvcfmhxd`, not production `yskhdzrdbywrpfowckpn`. The guide was built without `--preview`, so the page no longer says so. Accounts created through it now are test-project accounts. **Do not print, post or distribute the QR or the guide for member sign-up until the production cutover below is complete** and the app at that address targets production.
- **Capture-role correction (security).** The role described below and in #85 — `SELECT` + `BYPASSRLS` + `GRANT authenticated TO <role>` — is **not read-only**, and no role that can run `capture:p4` against a live database can be. Tested on local PostgreSQL 17.11 at the production migration boundary (22 migrations, through `202609230021`) and on the full 48-migration candidate; the property is held by [`db-tests/capture_role_privileges.test.ts`](../db-tests/capture_role_privileges.test.ts) (passes on PG16 and PG17):
  - **Inherited writes skip RLS.** Through `authenticated` the role inherits `INSERT` on `attendance_correction_requests`, `citizen_reports` and `report_media`, and `EXECUTE` on 40 (boundary) / 46 (candidate) volatile `SECURITY DEFINER` functions. With `BYPASSRLS`, a session with no JWT committed a `citizen_reports` row in another user's name — a row the `reports_create_own` policy refuses to the app.
  - **Forged claims act as anyone.** `request.jwt.claims` is an ordinary setting. After `set local role authenticated` with the owner's id in the claims, the role committed `owner_set_role(<firefighter>, 'ADMIN')` at the boundary and `owner_set_organization_membership(<firefighter>, 'DVD', 'ADMIN')` on the candidate. The same route reaches every owner/commander function, including `publish_intervention`, whose outbox the one-minute production cron sends to real phones (that call was not executed in the probe).
  - **`INHERIT FALSE, SET TRUE` does not fix it.** It removes the direct writes and still captures identical digests, but the forged-claims promotion still commits: the capture's impersonation *is* the write path.
  - **`default_transaction_read_only` is not a control.** Set on the role, it is only a session default; the holder runs `set default_transaction_read_only = off`. The `set transaction read only` inside the capture batch protects that batch, not the credential.
  - **Only a role with no membership in `anon`/`authenticated`/`service_role` has no write path** (`SELECT` + `BYPASSRLS`: 0 table write privileges, 0 callable volatile definer functions, `set role authenticated` refused) — and for that reason it cannot run the capture. It is fit only to *dump* data.
  - **The code never used such a role anyway.** `sourceUrl()` in `scripts/p4-capture-production.mjs` accepts only the `postgres` user, and `release-preflight.sh` passes it the full production URL. `DVD_READONLY_DATABASE_URL` is therefore a **full-privilege** credential under a misleading name.
- **Withdrawn:** creating the documented capture role, and providing `DVD_READONLY_DATABASE_URL` as a cloud environment secret. Neither has been done; **do not do either.**
- **Capture method — current and proposed:**
  - **A. Available today:** the owner runs `bash scripts/release-preflight.sh run` on a trusted computer with their *existing* `postgres` URL in `DVD_PRODUCTION_DB_URL`. No new role. The scripted steps write nothing to production (dumps, counts and a `set transaction read only` capture), but the credential itself is unrestricted, so its safety is custody: never in chat, a repository, CI or a cloud environment secret. This conflicts with the owner's stated cloud-only preference; that trade-off is the owner's decision.
  - **B. Built 2026-10-04 evening — capture on a restored copy (no owner credential needed on the capture host).** Implemented in `scripts/p4-restored-capture.mjs` and `scripts/restored-capture/`. Production is only **dumped**, by a short-lived dedicated role; the capture (which impersonates every account) runs on a disposable restore where impersonation harms nothing. Flow: `verify-role` → one read-only repeatable-read snapshot on the source producing a **source attestation** (schema fingerprint, migration ledger, pseudonymised `export_digest`, environment) plus a `pg_dump` of `public`; restore on a **separate** lo…4421 tokens truncated…ssword without echo, backs up roles/schema/data and the separate migration ledger with Supabase CLI, includes the app-owned auth trigger and Storage policies omitted by the default schema dump, exports pg_cron/pg_net operational data for the archive only, encrypts the archive to an age recipient outside the repository, restores a copy without operational data into a fresh per-run PostgreSQL 17 published on 127.0.0.1 only (`scripts/restore-target.mjs`; Supabase CLI's `supabase start` binds all interfaces and is not used), checks every table's row count and those definitions, then runs the production read-only P4 capture and gate. No production write is performed. It has run end to end on **fictional** data only (PR #95), with the real `age` binary; it has **not** run against the production database. The archive is a database backup only — see "Secret material" below.
- [ ] Review the final combined diff and resolve all review findings; re-run the full CI on the exact final head. Record the head SHA and CI run.
- [ ] Confirm the current Pages latch is false; confirm the intended Supabase project URL and **publishable** key in Actions variables, `VITE_MULTI_SERVICE_ADMIN_ENABLED=true` for SZS assignment, and the optional public Web Push key. Never pass a service-role/secret key into a browser build.
- [ ] Decide the migration/worker maintenance window and recheck the active one-minute `pg_cron` worker job. The 8 old queued rows are IN_APP on closed interventions, not Web Push. Check scheduler/worker configuration and verify no unexpected Web Push dispatch on the isolated target before relying on the new worker. A stale alert must not page a real phone during a test.

## Private local rehearsal (existing password)

On a trusted Mac/Linux computer, install the free [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (used for the dumps only), Docker Desktop, PostgreSQL 17 client (`psql`), Node 22+ and [age](https://age-encryption.org/). Start Docker and make sure `docker` is on `PATH` (Docker Desktop's per-user install puts it in `~/.docker/bin`). Clone/check out the **exact candidate head**, run `npm ci`, then run:

```bash
bash scripts/release-preflight.sh check
mkdir -p "$HOME/Boka-Backups" "$HOME/.config/boka-operativa"
age-keygen -o "$HOME/.config/boka-operativa/recovery.key"
age-keygen -y "$HOME/.config/boka-operativa/recovery.key"
```

Save a separate, offline copy of `recovery.key` in a place only the owner can access. The last command prints a **public** `age1...` recipient; insert it below. From the Supabase dashboard's **Connect → Session pooler** panel, copy only the host (for example `aws-0-eu-west-1.pooler.supabase.com`), **not** the full URL or password. Then:

```bash
npm run release:preflight -- "$HOME/Boka-Backups" age1YOUR_PUBLIC_RECIPIENT
```

The command asks for the host and then the existing database password without displaying it. No secret is entered in a shell command, repository file, PR or GitHub Actions. It stops on any dump, encryption, restore, count or equivalence error and leaves the encrypted backup intact. Any error diagnostic is encrypted to the same recipient; decrypt and redact it locally before sharing. The `*.tar.age` archive and the separate recovery key are both required for recovery. Check that the key can decrypt the archive on a separate machine before treating it as durable. Storage currently has zero object bytes (read-only check 2026-09-30); verify again before relying on a database-only recovery. Edge Functions, their secrets, Vault secrets and project settings are not in the database archive: complete "Secret material" below before relying on it.

The script deliberately has no production migration, worker deployment or Pages publish command. It produces evidence for the release gates; inspect that evidence before continuing with the rollout steps below.

The rehearsal requires a clean candidate checkout. Its separate local ledger restore replaces the restore target's `supabase_migrations` schema, then compares the restored migration count to production. This affects only the isolated local target. A successful run reports the candidate SHA and encrypted backup/report paths; retain those together with the offline recovery key.

## Secret material — not in the database backup (owner re-provisioning)

The rehearsal's encrypted archive is a **database backup, not a complete recovery**. Its manifest says so and lists, by **name only**, the Vault secrets it found and whether the scheduled push job reads Vault or carries its credential inline. No script in this repository reads a secret value. These items are required for operation and are **not** in the archive:

| Item | Where it lives | Needed for | If it is lost |
| --- | --- | --- | --- |
| `VAPID_PRIVATE_KEY` + `VAPID_PUBLIC_KEY` (one pair) | Edge Function secrets; the public half also in the `VITE_WEB_PUSH_PUBLIC_KEY` build variable | Web Push | A new pair invalidates every existing subscription: every member must re-enable notifications on every device |
| `VAPID_SUBJECT` | Edge Function secret | Web Push | Re-set (the public app URL) |
| `PUSH_WORKER_SECRET` | Edge Function secret, **and** the scheduler's copy for `x-push-worker-secret` (a Vault secret, or inline in the `send-web-push-every-minute` job) | The bounded repeat | Generate a new value and set both copies |
| `ALLOWED_ORIGIN` | Edge Function configuration | CORS for an extra origin | Re-set |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supplied to every Edge Function by Supabase, per project | The worker | A new project supplies its own; nothing to set |
| SMTP credentials | Auth settings (not configured yet) | Password recovery | Re-enter when recovery is enabled |

Vault values cannot be carried by a dump in any case: Supabase CLI excludes the `vault` schema, and Vault ciphertext is bound to the project's own key. If the scheduled job carries its credential inline, that command (credential included) is in `operational.sql` **inside the encrypted archive** only, and must still be in the owner's record. A request still queued in `net.http_request_queue` at dump time holds its headers as sent, so `operational.sql` can contain the worker secret even when the job reads it from Vault — another reason the archive stays encrypted and outside the repository.

**Owner step — required before the backup is relied on, and after every recovery:**

1. Keep the values above in the owner's offline password manager, never in Git, chat, a PR, CI, a log or a screenshot. Record each secret's name, source and date. Supabase's documented secrets list shows configured secret names; it does not provide a documented digest or a way to read back the value. If you want a fingerprint, calculate and save an owner-generated SHA-256 fingerprint locally when you create or rotate the value. Never put the value in chat, a repository, a command argument or a log.
2. After each rehearsal, decrypt the archive locally and read `manifest.txt`. Every Vault secret name it lists must have an entry in the record. If the scheduled-jobs line says `read Vault`, the worker secret's scheduler copy is one of those Vault secrets; if it says `carry a credential inline`, the copy is inside `operational.sql` — record it either way.
3. When re-provisioning a project: set the Edge Function secrets from the offline record, create the Vault secrets by the listed names, and recreate the scheduled job only after the worker is deployed (review the job command from `operational.sql` first; never restore it into a rehearsal or local target). Verify **without revealing values** that the Vault names (`select name from vault.secrets order by name`) match the manifest and that the required Edge Function secret names are configured. Supabase does not expose a documented digest for comparing the stored Edge Function values. If you recorded your own fingerprints when the values were created, compare those locally with the offline source values; otherwise rely on the password-manager record and a functional check on an isolated project. Finish with the device acceptance below.

**Status:** not done. No owner record has been checked against a real manifest; the production-copy rehearsal must not be called a complete backup/restore until steps 1–2 are recorded.

## Controlled rollout

1. Keep the Pages latch false. Apply **all 26 pending** repository migrations — `202609240022_organisation_columns.sql` through `20261002163200_owner_prepare_service_member.sql`, i.e. every migration after the hosted ledger's `202609230021`, in `db-tests/harness.ts` order (which equals filename order here) — one at a time, checking each applied ledger entry and schema outcome. This set includes `20260930190239_worker_joint_recipient_organization_read.sql`, `20261001134812_automatic_service_callouts_and_optional_report.sql`, `20261002134634_callout_readiness_counts.sql` and `20261002163200_owner_prepare_service_member.sql`; do not stop at `202609290043`. Stop on the first error; do not run a partly migrated client. The P4 gate and recovery rehearsal above are prerequisites.
2. In the agreed maintenance window, pause the known one-minute `pg_cron` push job before changing the worker, after checking for newly queued alerts. Deploy the reviewed `send-web-push` worker from the candidate only after its database requirements are installed; verify its configuration and a fictional opted-in device on an isolated project, then read-only production health. Resume the job after checking the deployed function and scheduler path. Do not send a fictional production alert or expose secrets.
3. Merge the reviewed combined candidate when it is safe for `main` to contain P7+P8. Check the successful `main` CI and that Pages is still skipped while latched. Confirm the final release SHA and build variables, then set `P6_PAGES_RELEASE_READY=true` and manually dispatch **Deploy demonstration build** on `main`. The Pages workflow now checks that the exact current `main` commit passed push CI and checks out that SHA; a stale CI completion or dispatch from another branch cannot deploy. Verify the published URL and schema version before asking the owner to sign in.
4. Read-only production smoke check: DVD and SZS isolation, account access, scoped archive, worker health, no unexpected push and no new queued Web Push rows for closed interventions. Leave the human alert fallback in place.

## Owner acceptance on the deployed URL

Use `docs/P6_RELEASE_PREP.md` §1 and `docs/RELEASE_ACCEPTANCE.md` for the device/evidence matrix. On the owner's iPhone and an Android phone where available, test DVD-only, SZS-only, dual-service and OWNER account shapes; explicit service switching; cross-service notification deep links; response, journey, attendance credit and per-service confirmation; scoped archives; foreground sound and background system notification sound. Publishing a production call-out pages real people and leaves a permanent record: coordinate any such exercise with them; do not create fictional production members or incidents. The owner's own push/“Moj poziv” path requires a verified DVD membership and member link. Operational reliance starts only after the recorded acceptance and human fallback rehearsal, not after a successful deploy.

## Current boundary

As of 2026-10-06, the owner-run production-derived equivalence gate and encrypted database backup with independent PostgreSQL 17 restore-count check have passed at candidate ancestor `471bd7f2730fdd75dc4329bd6baabd40a0579302`. The current candidate head is `4413b1f6807ae7e34688b7abea0b9041f6a1fb30`, with CI green. Production still has 22 applied migrations and 26 pending; the candidate worker is not deployed; SZS has no active members; and the app URL still targets the isolated test project. No production migration, worker deployment, frontend cutover, roster write, or real alert has occurred.
