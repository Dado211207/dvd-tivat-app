# P7 + P8 release candidate: execution record

Prepared 2026-09-29 for DVD Tivat / SZS Tivat. This document is an execution record, not evidence that the release gates passed. Do not turn on the Pages latch, merge the candidate into a publishing branch, or apply production migrations by treating fixture CI as production-copy evidence.

## Exact candidate

- P7: draft [#79](https://github.com/Dado211207/dvd-tivat-app/pull/79), head `aefbb22d9bbffbd3add274348275c0c1230a40ec`; CI `36593132662` succeeded.
- P8: draft [#80](https://github.com/Dado211207/dvd-tivat-app/pull/80), head `f38000932f8f1bd434357ac7d715313d6d0dae9e`; CI `36587236536` succeeded.
- Combined tree: draft [#81](https://github.com/Dado211207/dvd-tivat-app/pull/81), validated at `4dfd7f04da89b5c13db251be0fc834ec29759503`; CI `36593177745` succeeded before this documentation update. Re-run CI on the final head and record that exact SHA before merging.
- D18–D21 are the product contract: symmetric whole-service call-outs; publishing service commands the incident; each service confirms its own attendance; both archives contain the shared incident, with only their own participants.

## Read-only hosted preflight (2026-09-29, 16:03 UTC)

Supabase project `yskhdzrdbywrpfowckpn` was ACTIVE_HEALTHY on PostgreSQL 17. The hosted migration ledger has 22 entries and ends with `restore_intervention_audit_exact_text` (version `20260923180117`, repository migration `202609230021`). Repository migration files `202609240022` through `202609290043` are **not applied** there. The repository has 44 migration files in the combined tree; 22 are pending by filename sequence. Check the ledger and actual schema again immediately before the release; version timestamps in the hosted ledger do not always equal repository filenames.

Counts at that snapshot: 9 accounts, 7 members, 5 interventions, 0 open interventions, 0 active SZS memberships, 8 QUEUED notification rows (all IN_APP on CLOSED interventions; 0 queued WEB_PUSH rows) and 1 active Web Push subscription. These are counts only, not a row-level inventory. The installation OWNER account's required profile is complete but it has no active member record and no active DVD membership. Do not fabricate a roster row or use an unrelated existing member to make a test pass. Link the owner's real DVD member record through the authorised registry workflow when its identity is verified.

The hosted `send-web-push` function is ACTIVE version 2, using the old `policy.ts` worker; the repository's P4e/P7 worker has not been deployed. Recent Pages runs on `main` were skipped by the P6 latch, last observed run `36510948652` on `4403fcad`. On 2026-09-30, the signed-in GitHub repository variables page showed no `P6_PAGES_RELEASE_READY` variable; the other required public build variables were present. Recheck immediately before any merge or release.

On 2026-09-30, the signed-in Supabase **Database > Backups** page stated that the Free plan has no project backups. The existing database password is not viewable in its settings. A logical dump therefore still needs an authorised direct database connection, and a separate-target restore remains unproved. Do not reset the production password just to make a release test possible.

## Preconditions: record evidence, then release

- [ ] On a **fresh production-derived, read-only, pseudonymised capture** outside the repository, run `scripts/p4-equivalence-production.sql` as one read-only batch; run `npm run gate:p4 -- <capture>` against isolated PostgreSQL using the final candidate. It must first reproduce the hosted schema, rows and account behaviour, then show zero unexplained read/command/push divergences with migrations 022–043. Fixtures and the green CI database suite do not substitute for this gate. Do not commit or upload the capture.
- [ ] This Supabase organisation is on the **Free** plan (verified 2026-09-29). Supabase's daily hosted backups cover Pro/Team/Enterprise, not Free: make a **manual logical backup** with the supported CLI/pg_dump workflow, keep it outside the repository, and **exercise a restore on a separate target**. Record where the encrypted recovery artifact lives, who can restore it, its timestamp and scope. Do not use the live project itself as the restore rehearsal. See [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups).
- [ ] Review the final combined diff and resolve all review findings; re-run the full CI on the exact final head. Record the head SHA and CI run.
- [ ] Confirm the current Pages latch is false; confirm the intended Supabase project URL and **publishable** key in Actions variables, `VITE_MULTI_SERVICE_ADMIN_ENABLED=true` for SZS assignment, and the optional public Web Push key. Never pass a service-role/secret key into a browser build.
- [ ] Decide the migration/worker maintenance window and check whether the old worker is scheduled externally. The 8 old queued rows are IN_APP on closed interventions, not Web Push. Check scheduler/worker configuration and verify no unexpected Web Push dispatch on the isolated target before relying on the new worker. A stale alert must not page a real phone during a test.

## Controlled rollout

1. Keep the Pages latch false. Apply repository migrations `202609240022` through `202609290043` in **filename order**, one at a time, checking each applied ledger entry and schema outcome. Stop on the first error; do not run a partly migrated client. The P4 gate and recovery rehearsal above are prerequisites.
2. Deploy the reviewed `send-web-push` worker from the candidate only after its database requirements are installed; verify its configuration and a fictional opted-in device on an isolated project, then read-only production health. Do not send a fictional production alert or expose secrets.
3. Merge the reviewed combined candidate when it is safe for `main` to contain P7+P8. Check the successful `main` CI and that Pages is still skipped while latched. Confirm the final release SHA and build variables, then set `P6_PAGES_RELEASE_READY=true` and manually dispatch **Deploy demonstration build** on `main`. The Pages workflow now checks that the exact current `main` commit passed push CI and checks out that SHA; a stale CI completion or dispatch from another branch cannot deploy. Verify the published URL and schema version before asking the owner to sign in.
4. Read-only production smoke check: DVD and SZS isolation, account access, scoped archive, worker health, no unexpected push and no new queued Web Push rows for closed interventions. Leave the human alert fallback in place.

## Owner acceptance on the deployed URL

Use `docs/P6_RELEASE_PREP.md` §1 and `docs/RELEASE_ACCEPTANCE.md` for the device/evidence matrix. On the owner's iPhone and an Android phone where available, test DVD-only, SZS-only, dual-service and OWNER account shapes; explicit service switching; cross-service notification deep links; response, journey, attendance credit and per-service confirmation; scoped archives; foreground sound and background system notification sound. Publishing a production call-out pages real people and leaves a permanent record: coordinate any such exercise with them; do not create fictional production members or incidents. The owner's own push/“Moj poziv” path requires a verified DVD membership and member link. Operational reliance starts only after the recorded acceptance and human fallback rehearsal, not after a successful deploy.

## Current boundary

The production-copy equivalence and manual-backup separate-target restore were not possible in the workspace that prepared this record: no production capture, local PostgreSQL server or backup access was available. Neither has been marked passed. No production database change, worker deployment, Pages publication, roster write or PR merge occurred while preparing this candidate.
