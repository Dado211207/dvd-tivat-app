# Multi-organization handoff — 2026-09-25

This is the current checkpoint for the DVD Tivat / Sluzba zastite i spasavanja Tivat (SZS) rewrite. Update it when a phase is reviewed or merged. The full design, open product questions and phase acceptance criteria live in [MULTI_ORG_PLAN.md](../MULTI_ORG_PLAN.md); this file records the *current state*, not a replacement for that plan.

## Delivery state

| Phase | State |
| --- | --- |
| P0–P3 | Merged into `main`; the P3 equivalence gate against production-derived data passed. |
| P4a (registry) | PR [#56](https://github.com/Dado211207/dvd-tivat-app/pull/56) merged as `f149c7ff7a00ac126ca4dd872ad0b73b03fb3c1b`. It includes migrations `202609240024`–`202609240026`, service-scoped registry writers and audit reads, and an append-only registry audit. |
| P4b (interventions and outputs) | PR [#57](https://github.com/Dado211207/dvd-tivat-app/pull/57) merged as `44314ebd3b4a8b5684e096c0a22a7d2ecd5a3035` after independent review of head `1ced6565611a6273b485e6fa42727c42175e1ae2`. CI run `36044525290` passed, including database and browser tests. Migrations `202609250027`–`202609250029` remain unapplied to production. |
| P4a/P4b production gate | **Passed** 2026-09-25 on an isolated copy of production (plan section 13): copy proven identical to production first (schema 7/7 categories, rows 32/32 tables, 621/621 read facts over 9 accounts), then 0 divergences in reads, commands and a live call-out, with and without completed profiles, and with synthetic SZS-only and dual-service accounts added. Three expected differences, named in the gate (E1–E3). Re-run: `npm run gate:p4 -- <capture>`; the capture is taken read-only by `scripts/p4-equivalence-production.sql` and never committed. |
| P4c (responses and journey) | PR [#61](https://github.com/Dado211207/dvd-tivat-app/pull/61) merged into `main` as `471c5a969a150e75894ddee3531805c477405ddb` after independent review; CI passed on head `597f9726935ee733554a11c4a7efa6688b5f370b`. Migration `202609250030_response_service.sql` remains unapplied to production. |
| P4d (attendance) | PR [#62](https://github.com/Dado211207/dvd-tivat-app/pull/62) merged into `main` as `33d60d0230f01c88544d9bce4112df8910ce446f` after independent review and green CI run `36145332057` on `a2e932295b3bd5915416531336f8c3a16cfe71a4`. Migration `202609250031_attendance_service.sql` remains unapplied to production. |
| P4e (notifications and push) | PR [#63](https://github.com/Dado211207/dvd-tivat-app/pull/63) merged into `main` as `97f385337bea6c3928ce588fcfeeb31e1a32ba8a` after independent review and green CI run `36146640864` on `0c0a390dd32cf70d8c2c212d5cf1c553e528375e`. Migration `202609250032_push_service.sql` remains unapplied to production, and the `send-web-push` Edge Function in it is not deployed. |
| P4f (accounts and audit) | **Draft PR [#64](https://github.com/Dado211207/dvd-tivat-app/pull/64)** from `claude/dvd-tivat-app-dev-n8wctb-p4f`, retargeted to `main` after #63 merged, which it has taken in by merge commit `61adab4` (a clean merge; no reviewed commit rewritten); not merged. Three migrations, each in its own commit: `202609250033_audit_history.sql` (the phase, `67d15b7`); `202609250034_history_retention.sql` (the owner's retention rule, `5743443`); `202609250035_current_row_identity.sql` (found in review of 034, `1011e32`). 034 and 035 are not to be deployed yet. CI run `36147627306` passed on `17ed78e`, before 035; the head carrying 035 needs its own green CI - see the PR. |
| P5–P8 | Not started. P5 (retire the mirror) is next once the P4 stack is reviewed; P6 and P7 wait on Q1–Q8. |

**Production gate:** None of the organization rewrite migrations `202609240022` through `202609250035` has been applied to the hosted project (rechecked read-only on 2026-09-25: 22 migrations, through `202609230021`), and the `send-web-push` function in these branches has not been deployed — the deployed worker is the one on `main`. A green local or PR test does not imply production deployment. Do not apply these migrations as a side effect of merging a PR. The plan requires separate approval per production phase. **Deploy order for P4e, when approved:** migration `202609250032` first, then the function — the new worker sweeps `push_delivery_queue()` and asks `push_delivery_verdict()`; without them its first read fails, it answers 503 and sends nothing. P4e changes one DVD behaviour on purpose (gate E5): an alert still queued when its call-out is closed or cancelled is no longer sent. Do not invent or delete member accounts or demo records.

## P4c: what changed and what it proves

`submit_response()` used the DVD shim, so an SZS recipient was refused their own call-out (`MEMBER_RECORD_REQUIRED`) and a dual-service recipient was checked as their DVD record (`NOT_A_RECIPIENT`) — measured on fixtures and on the production copy. `202609250030` reads the service from the stored call-out (an unknown id is judged as DVD's, as before), resolves the caller's member there with `current_member_id_in()`, and keeps the inline recipient lookup against the member it writes. Signature, grants, validation order, the unchanged-answer no-op and the revision sequence are unchanged; for DVD the member resolved is the shim's, so DVD behaviour is identical by construction and re-measured by the gate.

Evidence: `db-tests/response_service.test.ts` — 13 of its 18 tests fail on the pre-P4c schema and all pass after; the full database suite passes; a replay check shows re-applying `202609250030` is a no-op and replaying the restore-exact-text migrations leaves `submit_response` untouched; the production-copy gate passes with P4c included. An answer writes only `intervention_responses` and `intervention_response_revisions` (no audit, outbox or delivery row), and those two tables' policies (029) give SZS rows to SZS command, the owner and that call-out's recipients only. The four P4c tables are written by no other definer function than `submit_response` and `set_journey_progress`, so no further table became reachable.

**Reviewed existence question (Stage 0 of the 2026-09-25 continuation).** A caller holding a DVD record can tell an SZS call-out's id from an unknown id through `submit_response` (`MEMBER_RECORD_REQUIRED` vs `INTERVENTION_NOT_FOUND`). Measured, not assumed: the same bit is given by five P4b commands to the same caller and by `ORGANIZATION_MISMATCH` to commanders (P4a's documented convention); no-standing callers learn nothing; P4c reduced the disclosure (before, it also revealed open/closed/draft). Pinned by tests, not changed. Whether another service's call-out should be indistinguishable from none is an open cross-cutting decision (plan, P4 section), to be made for every command at once.

**Not reached by P4c:** the interface. The client resolves "my member" through `current_member_id()` (DVD), so an SZS-only account is held at the operational gate and a dual-service account is not shown as a recipient of an SZS call-out. That is P6.

## P4d: what changed and what it proves

The correction-request INSERT policy asked the DVD shim, so an SZS member could not ask for a correction to their own attendance (fails closed). `202609250031` asks for the caller's member in the stored interval's service and requires an OPEN, undecided, server-dated request (a DVD member could previously pre-fill the decision — gate difference E4). It settles identity at insert: interval call-out/member/credit (`ATTENDANCE_IDENTITY_FIXED`), corrections append-only (`CORRECTION_HISTORY_APPEND_ONLY`), request interval/author/time/message (`CORRECTION_REQUEST_IDENTITY_FIXED`); vehicle movements keep P2's rules. `db-tests/attendance_service.test.ts`: 9 of 24 fail without it, all pass with it; the production-copy gate passes with it (DVD unchanged except E4). Crediting across services, and any command that resolves a request, are not implemented: the first is Q5's, the second never existed and no client uses the table.

## P4e: what changed and what it proves

Measured before the change, on a schema at `202609250031` and the worker at `58e2776`: an SZS-only member who may be called out could not register a device (`OPERATIONAL_ACCESS_REQUIRED`) or read their own device list; the worker decided eligibility from the account's grant, which carries DVD's role, so an SZS-only member was refused every alert (`ACCESS_REVOKED`), a member withdrawn from SZS but still in DVD was still alerted for SZS, and a queued row naming a DVD member on an SZS call-out was sent; the immediate wake-up asked `current_dvd_role()`, so a DVD commander could wake an SZS call-out's delivery and an SZS commander could not wake their own.

`202609250032` and the worker now: register a device for a member record the account may be called out as in that record's own service (one device per account, used for whichever member each call-out was sent to); let an account with standing in any service read its own devices; answer the worker's per-alert question with `push_delivery_verdict()` (service role only, caller-rights), derived from the stored alert, call-out, recipient list and member — `SERVICE_MISMATCH` and `NOT_A_RECIPIENT` set the alert aside unsent, `OPENED` and `CALLOUT_NOT_OPEN` close it, `INELIGIBLE` refuses it, `DELIVER` names the account; authorise a wake-up by `is_command_in()` for the stored call-out's service; and fix what an alert is about at insert, with delivery attempts never updated. The worker's queries moved to `supabase/functions/send-web-push/deliver.ts`; `index.ts` only builds clients. One-repeat limit, 90-second hold, claim, deduplication, concurrency and the three-field payload are unchanged and tested.

Evidence for the phase as first submitted (`3ac2717`; the review follow-up below supersedes its gate result): `db-tests/push_service.test.ts` — 23 of its 32 tests fail on the P4d head with the pre-change worker logic, all 32 pass after; it runs `deliver.ts` as the service role against real rows through `db-tests/postgrest.ts`, with a recording fake push service (no real push sent, hosted worker never called). Six negative controls — verdict without the member-service check, verdict by grant role, wake-up asking DVD, unconditional claim, mismatch refused instead of set aside, member rebinding allowed — are each caught. Replay: re-applying `202609250032` is a no-op; replaying the restore-exact-text files re-creates the same 13 P4a/P4b functions as at P4d (the known ordering hazard) and none of P4e's. The production-copy gate passes with P4e under test: DVD reads and commands unchanged (E1, E2, E4 only), and a new step comparing the old worker rule with the verdict for every real alert and a new DVD alert per member finds 0 differences.

Found and handled while testing: a row whose stored service label contradicts its call-out (only writable with triggers off) cannot be updated at all under P2's trigger, so the worker cannot set it aside. P4d's own replay check hashed catalogue rows ordered by a constant and failed spuriously once 032 added triggers; its ordering is fixed in this PR.

**Review follow-up (independent review of `3ac2717`).** Three gaps, each shown first by a test that failed against `3ac2717` — the follow-up's `push_service.test.ts` on that head: 13 of 43 fail. Ten are the scenarios: a non-recipient was DELIVERed and sent to its device in both services, and a recipient entry filed under the other service counted; four closed or cancelled call-outs were DELIVERed and sent on a commander's wake-up; the repeat went out after closing; three scheduler runs and an SZS wake-up sent nothing behind 50 corrupted rows, each run reporting 50 failed, and nothing counted them. Three are catalogue checks naming the two new functions and close reasons, which that head does not have. After the fix all 43 pass:

- **Recipient list.** The verdict now answers `NOT_A_RECIPIENT` unless `intervention_recipients` has the alert's member for its call-out, in its service; the alert is closed unsent with that reason.
- **Call-out status.** `CALLOUT_NOT_OPEN` unless the stored call-out is `PUBLISHED`, `ASSEMBLING`, `DEPLOYED` or `CONTAINED` (an allowlist — the client's `isOpenStatus`); closed unsent with that reason, repeat included. `close_intervention()` itself is unchanged: it leaves queued rows as they are, and the worker closes them when it reaches them. An alert the member already opened stays `MEMBER_OPENED`. Order: `SERVICE_MISMATCH`, `NOT_A_RECIPIENT`, `OPENED`, `CALLOUT_NOT_OPEN`, then eligibility.
- **Close reasons.** `delivery_close_reason` now allows `MEMBER_OPENED`, `SERVICE_MISMATCH`, `NOT_A_RECIPIENT`, `CALLOUT_NOT_OPEN`. No attempt is recorded for any of them; a close the database refuses counts as failed for the two integrity reasons and as skipped (a lost race) for the other two.
- **Starvation.** The worker sweeps `push_delivery_queue()` (service role only): the open Web Push alerts less those whose stored service contradicts their call-out's — exactly the rows P2's trigger refuses to update. The worker keeps its own filters, order and `limit(50)`. Those rows are left untouched and unsent; `push_delivery_mislabelled(call-out)` counts them, and the worker reports the count on every run (`mislabelled` in the reply, scoped to the woken call-out on a wake-up; a `PUSH_ALERTS_MISLABELLED` warning in the function log). P2's rule is unchanged — the test shows the rows still refuse every update.

**Second review follow-up (review of `9bd7fac`): the sweep takes only alerts that are due.** The note this replaces called the problem bounded at about 90 seconds and left it; that was an under-estimate. Reproduced on the local database through the service-role stand-in and the recording fake: with 50 older `PROVIDER_ACCEPTED` alerts inside their repeat hold, the sweep (oldest 50 open alerts, `holdForNow` asked only afterwards) sent a newly queued call-out nothing on the first scheduler run, nothing on the second (the 50 repeats took every place) and only on the third — two minutes late on a one-minute schedule; a commander's wake-up of a call-out with 50 of its own waiting sent nothing. Now `push_delivery_queue(accepted_before, claimed_before)` returns only alerts that are due — queued or refused, accepted at or before `now − 90 s`, claimed at or before `now − 30 s` — so the worker's limit of 50 applies to due alerts only. Both instants come from the worker's own clock (`dueCutoffs` in `policy.ts`, the same waits as `holdForNow`, which the worker still asks of each row), and the database compares the stored time truncated to the millisecond, as `Date.parse` reads it: a test that sets the worker's clock sets the cutoff, and the two agree to the millisecond. Repeat wait, stale-claim wait, two-attempt ceiling, oldest-first order, authorisation and service checks unchanged; the limit was not raised. Tests: on `9bd7fac` the two new sweep tests fail (scheduler: nothing sent, tally `skipped: 50`; wake-up: nothing sent), the edge test passes (the waits were right, only their place was wrong); after the fix all 46 push tests pass. Five negative controls, each caught: the due filter removed (both sweep tests fail again), the millisecond truncation removed, a strict `<` at the edge, the database's clock instead of the worker's, and the two cutoffs swapped.

Ten negative controls on the follow-up are each caught (verdict without the recipient check, with CLOSED/CANCELLED allowed, with only CLOSED ending a call-out, recipient in any service; sweep handing out mislabelled rows; count ignoring the call-out; worker quarantining only `SERVICE_MISMATCH`, counting everything on a wake-up, leaving ended call-outs open, refusing a non-recipient as an attempt). Production-copy gate with the new 032: **passed**, but not "0 differences" — **E5** names the intended DVD change: 1 of the 2 real Web Push alerts on the copy (on a `CLOSED` call-out, already finished, so no pending alarm) goes `DELIVER` → `CALLOUT_NOT_OPEN`; a new alert for every DVD member on a running call-out differs 0 times, on a call-out closed first 7 of 7 are set aside; no `NOT_A_RECIPIENT` on any real row; a new negative control (a verdict ending running call-outs) is reported and not excused.

Not done by P4e (plan, P4e section): joint call-outs and one alert per person across services (Q1–Q5, P7) — a member of another service on a call-out is treated as a mismatch until P7 replaces that rule; the `dvd-` topic prefix (P8); the screen that offers SZS-only registration (P6 — the client still gates operational screens on `current_dvd_role()`).

## P4f: what changed and what it proves

Catalogued at `202609250032` first: every policy, privilege, writer and trigger on P4f's tables and `operational_audit`. Reads needed no change — every non-self account-table policy asks `is_dvd_owner()` or `current_dvd_role() = 'OWNER'`, which are the installation owner by definition (asserted in every owner state), and an ADMIN of either service reads only its own grant, profile and memberships, before and after (D9's ADMIN powers are the registry's, scoped in P4a).

`202609250033` makes audit history append-only as a rule: `role_audit`, `account_status_audit`, `organization_membership_audit`, `report_status_audit` and `operational_audit` refuse UPDATE and DELETE (`AUDIT_APPEND_ONLY`); those and `registry_audit` and `attendance_corrections` refuse TRUNCATE (which P4a's and P4d's row rules never covered); the service role keeps SELECT and loses every write on all seven. `operational_audit` still accepts its own foreign keys' `ON DELETE SET NULL` — recognised as nested inside the referential action and only clearing links — so a deleted call-out or account detaches the rows that named it without changing their service, wording or time. Parentless rows can no longer be re-parented, relabelled, or written by the service role claiming a service (the gap P2's tests pinned for P4).

Evidence: `db-tests/audit_history.test.ts` — 6 of its 18 tests fail without the migration, all pass with it; the 12 that pass throughout are the preservation checks (every account reads exactly what it read before, the owner equivalence, citizen reports unchanged, the SET NULL paths, every audit row still written by its command and attributed to the actor, the remaining DVD-only references pinned). Five negative controls (detach-by-hand allowed, no SET NULL exception, a truncate trigger removed, service-role insert kept, a row rule removed) each caught. Replay: re-applying `202609250033` is a no-op; the restore files re-create the same 13 functions as before and none of P4f's objects. P4d's grant test compared the service role's full ACL; it now compares client roles only, as its title says.

After merging the P4e review follow-up (merge commit `a50cfe7`, #63 at `9bd7fac`): the database suite on the committed tree reports 810 passed, 12 skipped (P4f's 799 plus the 11 new push tests). *Correction:* this line used to add that those push tests also exercise P4f's `operational_audit` SET NULL exception, because they delete their call-outs afterwards. They do not: `push_service.test.ts` builds its schema only up to `202609250032` and never applies 033. The exception is exercised by `audit_history.test.ts`, and since `202609250034` also by `history_retention.test.ts`. The production-copy gate with 032 and 033 under test passes and is identical to P4e's own run: E1, E2 and E4 in reads and commands, E5 in the push comparison, every SZS step as before. #64's diff against #63 is unchanged by the merge: the same 7 files.

After merging P4e's second review follow-up (merge commit `0049bd5`, #63 at `ac3ee0a`, the sweep that takes only alerts that are due): 813 passed, 12 skipped (810 plus the three due-sweep tests); re-applying 032 and 033 is still a no-op; the gate's output is identical, line for line, to the run after `a50cfe7` — the sweep is not something the gate compares. #64's diff against #63 is still the same 7 files.

**Plan acceptance criterion 5 (no `is_dvd_staff`/`_command` left): met, with one explicit exception decided by the owner on 2026-09-25.** Citizen reports remain the abandoned DVD-only research feature described in the plan (section 10). The citizen-report subsystem keeps its DVD checks: `reports_staff_read`, `media_owner_or_staff_read`, `report_audit_leader_read` and `review_report()`. SZS is given no access, and the feature is not activated. No cross-service exposure follows: SZS-only accounts read none of it, and it holds no SZS data. The four are pinned by name in `audit_history.test.ts`'s catalogue check, which fails on any other DVD-only check at `202609250033`; `202609250034` adds none. Whether DVD Tivat wants citizen intake at all (`docs/PRODUCTION_ARCHITECTURE.md` §1 item 3) is a separate product question this does not answer; reviving the feature would be a new, approved decision. Criterion 7 (the browser suite) awaits CI on the retargeted PR; P4f changes no client code.

## Follow-up `202609250034`: a published call-out and its history stay

**The owner's rule (2026-09-25), which settles the deletion question left open above:** a published intervention and its response history remain in the database. A published call-out is closed or cancelled, never hard-deleted through ordinary database operations; a draft that was never published may still be deleted. **Not to be deployed yet.** A separate commit on #64, after the P4f commits, which it does not change.

Measured on the tree before it (`ff76dde`): `member_availability_history`, `intervention_journey_history` and `intervention_response_revisions` are each written only by INSERT, by one `security definer` command (`set_own_availability_in`, `set_journey_progress`, `submit_response`), but the service role held every privilege on all three — it could rewrite, delete, truncate and forge them — a row could be moved onto another service's call-out if its label moved with it, deleting an answer erased its revisions (`ON DELETE CASCADE`), and a published call-out with nothing under it that RESTRICTs (no journey progress yet) could be deleted, answers and all.

`202609250034_history_retention.sql`:

- **The three history tables are append-only.** UPDATE and DELETE are refused (`AUDIT_APPEND_ONLY`, P4f's strict `refuse_audit_change()`), and so is TRUNCATE (`refuse_audit_truncate()`), in a superuser session too. P2's `enforce_organization` trigger on each is unchanged and still answers a contradicting label first (`ORGANIZATION_MISMATCH`, on insert and update); a row moved to another service's call-out with its label moved too, which P2 accepts as consistent, is now refused as a rewrite. The service role keeps SELECT and loses INSERT, UPDATE, DELETE and TRUNCATE: a forged journey step, availability change or revision is `permission denied`. The three commands still write one row each, in the right service, attributed to whoever acted.
- **An answer's revisions are never erased with it.** `intervention_response_revisions.response_id` is `ON DELETE RESTRICT` (was CASCADE). Every answer has at least one revision, so no answer can be deleted, whoever asks. The current answer still changes: it is state, and its history is the revisions.
- **A published call-out cannot be deleted** (`PUBLISHED_INTERVENTION_RETAINED`: a BEFORE DELETE trigger on `interventions`, and a BEFORE TRUNCATE one). "Published" is decided from every trace publication leaves, and any one of them keeps the call-out: a status other than DRAFT or CANCELLED, a publisher, a recipient list, or the `INTERVENTION_PUBLISHED` row in the append-only `operational_audit`. The publisher alone would not do: `202609150008`'s `publish_intervention` never recorded one, and two of production's five call-outs have none. The audit trace is what stops the service role, which can reset a status, clear a publisher and delete a recipient list, from making a published call-out look like a discarded draft. A DRAFT may still be deleted, and so may a draft discarded before publication (`discard_intervention_draft` leaves it CANCELLED with no publisher, no recipients and no publication). Their audit rows stay, detached by P4f's SET NULL.
- **Exceptional purges stay outside the application.** No function deletes a call-out, an answer or any history (asserted from the catalogue). A superuser can still disable named triggers; that is the deliberate, separately decided act that a purge of demo data would be.

Evidence: `db-tests/history_retention.test.ts`, 17 tests. On `ff76dde`, without 034: 10 fail and 7 pass. The 7 are the four measurements above plus three preservation checks: the commands still write, drafts still delete, and a member or account named by history is still refused deletion. With 034 all 17 pass.

Each history table is tested the same way:

- a direct UPDATE, DELETE and TRUNCATE by a client, the service role and a superuser session;
- a relabel, and an insert claiming the other service, by the superuser (still `ORGANIZATION_MISMATCH`) and by the service role (now `permission denied`);
- a row nobody wrote that is consistent with its parent's service. Before 034 the service role could write one in every table, including a DVD member recorded arriving at an SZS call-out.
- a row moved onto another service's parent with its label moved too;
- the command that writes it, and who it attributes the row to;
- every foreign key by name, with its delete action.

Twelve negative controls on 034 are each caught by the test aimed at it:

- the revisions foreign key back to CASCADE;
- no row rule;
- no truncate rule;
- the service-role writes kept;
- each of the four publication traces removed on its own (four controls);
- no delete trigger;
- no truncate trigger on `interventions`;
- a trigger that refuses every delete (drafts stop deleting);
- P2's organisation trigger dropped from revisions. The organisation test catches it, and so does the command test, since `submit_response` relies on that trigger to fill in the service.

Two controls show what the new rule adds, not only what it alone protects:

- With the foreign key left as CASCADE, deleting an answer is still refused, but by the strict row rule on the cascaded revision delete (`AUDIT_APPEND_ONLY`). RESTRICT states the rule in the schema and does not depend on the row rule staying strict.
- Without the truncate trigger on `interventions`, `TRUNCATE … CASCADE` is still refused, by P4f's rule on `operational_audit`.

**Existing tests and fixtures.** The full suite passes with no existing test changed: 830 passed, 12 skipped (813 plus the 17 new tests). Every existing test that deletes a published call-out builds its schema up to a migration before 034 and never applies it:

- `organisation_columns.test.ts` (022).
- `push_service.test.ts` (032). Its check "removing a call-out still takes its alerts and their history with it" is true at 032. From 034, no call-out that can have alerts can be deleted.
- `audit_history.test.ts` (033). It exercises the SET NULL exception by deleting a published call-out. From 034, the exception is reached through a call-out only by deleting a draft, which `history_retention.test.ts` asserts row by row.

The 19 files that build the whole chain (`resetSchema`), and the three that apply everything from their own migration onward, never delete or truncate a call-out, an answer or history. No fixture needed changing, and no assertion was weakened. P2's backfill (`202609240022`) UPDATEs all three tables. It runs long before 034 and is never re-run; re-running it after 034 would now be refused.

**Production copy** (offline, built from the earlier capture; nothing was read from production):

- 034 applies after 033 on real data.
- Deletion is refused for all 5 real call-outs. All are CLOSED, 2 have no publisher, and all have recipients and a publication in the audit.
- Deletion is refused for all 4 real answers; each has a revision.
- The gate with 034 under test passes and is identical to the `0049bd5` run, apart from the line naming 034. It shows E1, E2, E4 and E5 only, and the commands that write history do exactly what they did for every real account.
- Replay: re-applying 034 is a no-op. The restore-exact-text files re-create the same 13 functions as before and none of 034's objects.

**Conflicts to decide before deployment.** None of these is with the application; each concerns data handling.

- `docs/DEMO_DATA_INVENTORY.md` is a proposal and was never run. Its Step 3 deletes the five production call-outs with their answers, revisions and journey history. All five were published, so that is no longer an ordinary operation. Step 3 as written also deletes the 47 `operational_audit` rows tied to them, which P4f already refuses. Steps 4–5 (members, accounts) depend on Step 3. If the owner wants that data gone, it is an exceptional purge, with its own approval. It can be done either before 033/034 reach production, or afterwards by a superuser disabling named triggers.
- `db-tests/hosted_operations.test.ts`, when someone runs it by hand with credentials, publishes and closes one fictional call-out in production. It never deleted them, and from 034 nothing ordinary can: each run leaves a permanent record.

## Follow-up `202609250035`: an answer, the current journey step and the current availability stay whose they are

Found in review of #64 at 034. It is a separate commit (`1011e32`), leaves 034 untouched, and is **not to be deployed yet**.

**Reproduced first**, on the 034 schema (`db-tests/current_row_identity.test.ts`, first describe). Each case asserts the stored rows and what each account reads:

- An answer and its two revisions were re-attributed to another DVD member who was never sent the call-out. DVD command then read that member as coming, with the first member's history behind it. The first member, still a recipient, read the other member's answer and none of their own.
- An answer was moved onto an SZS call-out and member with its label moved too, which P2 accepts as consistent. Its revisions kept the DVD label. SZS command read the answer and none of its history; DVD command read the history of an answer it could not see; the SZS recipient read an answer they never gave.
- The service role wrote an answer with no revision; nothing requires one. That answer was then deleted from a published call-out, by the service role and by a superuser session.
- The current journey step and the current availability were re-attributed, within the service and across services. The board then showed a member on the way whose history says somebody else set out.

**What 035 does:**

- **Answer identity is fixed.** An answer's id, call-out, member, service and first-answered time can no longer change (`RESPONSE_IDENTITY_FIXED`). This holds for the service role and a superuser session alike. `submit_response()` still revises the answer, ETA, direct-travel flag, `updated_at` and revision number, including a first answer in SZS. An answer and its revisions can no longer carry different services; the tests check this across every row.
- **Answers are retained.** An answer is removed only together with its call-out (`RESPONSE_RETAINED`), and the table cannot be truncated.
  - A published call-out is never removed (034), so it keeps every answer, with or without a revision.
  - A never-published draft can still be deleted, and it takes with it any answer written to it outside the commands. `submit_response()` refuses drafts, so such an answer only arrives that way.
  - Deleting such a draft's answer on its own is refused. That way the rule needs no second definition of "published".
- **Current rows keep their identity.** The current journey step keeps its call-out, member and service (`JOURNEY_IDENTITY_FIXED`). The current availability keeps its member and service (`AVAILABILITY_IDENTITY_FIXED`). `set_journey_progress()` and `set_own_availability_in()` still work in each service.
- **P2 still answers first.** Each rule's trigger sorts after P2's `enforce_organization`, so a contradicting label is still refused as `ORGANIZATION_MISMATCH` first.

**Evidence.** On `61adab4` (the 034 schema), 6 of the 12 tests fail and 6 pass. The 6 that pass are the four reproductions and two checks that the commands still revise and move their rows. With 035, all 12 pass. The full suite gives 842 passed, 12 skipped (830 plus the 12 new tests), with no existing test changed.

Thirteen negative controls are each caught:

- the answer's freeze dropped;
- its call-out left free;
- its first-answered time left free;
- no delete rule;
- no truncate rule (`TRUNCATE … CASCADE` is then still refused, by 034's rule on the revisions);
- the delete rule refusing a draft's cascade;
- the delete rule letting every delete through;
- no journey freeze;
- no availability freeze;
- an answer's `answer` frozen too;
- a journey step's progress frozen too;
- an availability's `available` frozen too;
- the answer rule sorted before P2's.

The three over-freezing controls are caught by the commands failing.

One sabotage is not caught, and that result is accurate. Dropping the answer's service from its fixed columns changes nothing observable, because its call-out is fixed and P2 requires the label to match the call-out. The same holds for the journey step's service (its call-out is fixed) and the availability's (its member is fixed). Those clauses are defence in depth; no test covers them on its own.

**Production copy** (offline; nothing read from production):

- 035 applies after 034.
- The 4 real answers all have revisions, and none carries another service than its revisions.
- Deleting any of them gives `RESPONSE_RETAINED`; re-attributing one gives `RESPONSE_IDENTITY_FIXED`.
- The 3 real journey steps and the 1 availability give their `*_IDENTITY_FIXED` code.
- The 5 call-outs are still refused deletion.

**Gate:** passed, identical to the 034 run apart from the line naming 035. **Replay:** re-applying 035 (and 034, 033, 032) is a no-op. The restore-exact-text files re-create the same 13 functions and none of 035's objects.

**DVD behaviour.** Nothing changes through the application: every command writes exactly what it did, as the gate shows. The only thing refused is a direct write outside the commands: re-attributing an answer, journey step or availability, or deleting an answer.

**Not changed by 035:**

- The service role keeps its privileges on the three tables (the open decision above).
- The current journey step and availability can still be deleted. They are state, and their history is kept.

## P4b review resolved; next boundary

At head `ccc59a8`, DVD-only command/staff policies exposed SZS rows created by publication, journey, attendance and vehicle departure. The final `202609250029` migration closed reads on ten output tables, scoped the attendance and vehicle lifecycle commands, fixed a definer-read leak in `intervention_audit()`, restored the caller check in `is_eligible_recipient_in()`, and labelled parentless vehicle audit events with the vehicle's service. It also refuses an attendance check-in naming a vehicle from the other service. The database suite reported **700 passed, 12 skipped**; disabling that last migration fails 26 new tests. Independent review found no remaining P4b blocker, and CI passed on its exact SHA.

**P4f is done for its own tables; the P4 group is not complete.** #61, #62 and #63 are merged; #64 is in review. Open, in order of consequence: the cross-cutting existence question (whether another service's call-out id should be indistinguishable from an unknown one, plan P4 section); before `202609250034` is deployed, what happens to the published demo call-outs (the conflict with `docs/DEMO_DATA_INVENTORY.md` above). Settled since: the three history tables are append-only, and a published call-out and its answer history stay (`202609250034`, the owner's rule, in review on #64 and not deployed). Citizen reports stay DVD-only as the abandoned feature, an explicit exception to criterion 5 (owner, 2026-09-25). An answer, the current journey step and the current availability can no longer be re-attributed, and a published call-out keeps every answer (`202609250035`, in review on #64). Not decided, and not changed by 035: whether the service role should keep INSERT, UPDATE and DELETE on those three tables. Nothing it runs writes them; while it keeps them, it can write such a row outside the commands and change an answer's content without a revision, though no longer move or delete one. P5 (retire the mirror) must not start before the stack is reviewed.

**Who is watching:** the working session that opened these PRs was subscribed to all four; the three merged ones unsubscribed themselves, and it stays subscribed to #64. It receives CI failures and review comments while it lives. It could not schedule a timed check-in (the call asked for an approval nobody was present to give), so events webhooks miss must be noticed by whoever acts on the PR.

## Account and service model

One account starts as a limited citizen. The installation owner assigns DVD, SZS or both; membership in one service must not grant access to the other's operations. A person serving in both has **two service-specific member records** (D13), with separate availability, group membership and attendance. The owner administers both services and can have no membership row; firefighting participation still requires a linked member record in the relevant service. No fictional members are to be added for testing the live installation.

Unanswered product questions Q1–Q8 in the plan block the SZS user interface (P6) and/or joint call-outs (P7), especially dual-service response behavior, command, archives and attendance credit. P4b deliberately excludes joint call-outs. Do not silently turn a security fix into an answer to those product questions.

## How to resume

1. Read this file, `docs/MULTI_ORG_PLAN.md`, and the current GitHub PR head before acting; this checkpoint can become stale.
2. Review P4f at PR #64's current head - migrations 033, 034 and 035 - and require full CI on that exact SHA before merging. Production migration and push-worker deployment have separate gates. Each later phase requires failing-before/passing-after database evidence, preserved DVD behavior (re-run `npm run gate:p4` against a fresh read-only capture) and CI success on the exact final SHA.
3. Run the unit suite on COMMITTED files: `src/config/accountReadiness.test.ts` scans `git ls-files` only, so a new file passes it until it is tracked. Build service-role claims in tests with `JSON.stringify`, never as a literal.
4. Keep the next phase's own boundary closed. Audit all security-definer commands and every table they populate, including history, audit, notifications and service-role workers. Keep one reviewable phase per PR.
5. Record the reviewed SHA, CI run, production migration state, open decisions and next blocker here after each phase. Production deployment and user acceptance testing are separate milestones.
