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
| P4d (attendance) | **Draft PR [#62](https://github.com/Dado211207/dvd-tivat-app/pull/62)** from `claude/dvd-tivat-app-dev-n8wctb-p4d`, retargeted to `main`; not merged. Migration `202609250031_attendance_service.sql`. Full CI on its new head is required before merge. |
| P4e–P4f, P5–P8 | Not completed. Follow the phase and decision gates in the plan. |

**Production gate:** None of the organization rewrite migrations `202609240022` through `202609250031` has been applied to the hosted project (rechecked read-only on 2026-09-25: 22 migrations, through `202609230021`). A green local or PR test does not imply production deployment. Do not apply these migrations as a side effect of merging a PR. The plan requires separate approval per production phase. Do not invent or delete member accounts or demo records.

## P4c: what changed and what it proves

`submit_response()` used the DVD shim, so an SZS recipient was refused their own call-out (`MEMBER_RECORD_REQUIRED`) and a dual-service recipient was checked as their DVD record (`NOT_A_RECIPIENT`) — measured on fixtures and on the production copy. `202609250030` reads the service from the stored call-out (an unknown id is judged as DVD's, as before), resolves the caller's member there with `current_member_id_in()`, and keeps the inline recipient lookup against the member it writes. Signature, grants, validation order, the unchanged-answer no-op and the revision sequence are unchanged; for DVD the member resolved is the shim's, so DVD behaviour is identical by construction and re-measured by the gate.

Evidence: `db-tests/response_service.test.ts` — 13 of its 18 tests fail on the pre-P4c schema and all pass after; the full database suite passes; a replay check shows re-applying `202609250030` is a no-op and replaying the restore-exact-text migrations leaves `submit_response` untouched; the production-copy gate passes with P4c included. An answer writes only `intervention_responses` and `intervention_response_revisions` (no audit, outbox or delivery row), and those two tables' policies (029) give SZS rows to SZS command, the owner and that call-out's recipients only. The four P4c tables are written by no other definer function than `submit_response` and `set_journey_progress`, so no further table became reachable.

**Reviewed existence question (Stage 0 of the 2026-09-25 continuation).** A caller holding a DVD record can tell an SZS call-out's id from an unknown id through `submit_response` (`MEMBER_RECORD_REQUIRED` vs `INTERVENTION_NOT_FOUND`). Measured, not assumed: the same bit is given by five P4b commands to the same caller and by `ORGANIZATION_MISMATCH` to commanders (P4a's documented convention); no-standing callers learn nothing; P4c reduced the disclosure (before, it also revealed open/closed/draft). Pinned by tests, not changed. Whether another service's call-out should be indistinguishable from none is an open cross-cutting decision (plan, P4 section), to be made for every command at once.

**Not reached by P4c:** the interface. The client resolves "my member" through `current_member_id()` (DVD), so an SZS-only account is held at the operational gate and a dual-service account is not shown as a recipient of an SZS call-out. That is P6.

## P4d: what changed and what it proves

The correction-request INSERT policy asked the DVD shim, so an SZS member could not ask for a correction to their own attendance (fails closed). `202609250031` asks for the caller's member in the stored interval's service and requires an OPEN, undecided, server-dated request (a DVD member could previously pre-fill the decision — gate difference E4). It settles identity at insert: interval call-out/member/credit (`ATTENDANCE_IDENTITY_FIXED`), corrections append-only (`CORRECTION_HISTORY_APPEND_ONLY`), request interval/author/time/message (`CORRECTION_REQUEST_IDENTITY_FIXED`); vehicle movements keep P2's rules. `db-tests/attendance_service.test.ts`: 9 of 24 fail without it, all pass with it; the production-copy gate passes with it (DVD unchanged except E4). Crediting across services, and any command that resolves a request, are not implemented: the first is Q5's, the second never existed and no client uses the table.

## P4b review resolved; next boundary

At head `ccc59a8`, DVD-only command/staff policies exposed SZS rows created by publication, journey, attendance and vehicle departure. The final `202609250029` migration closed reads on ten output tables, scoped the attendance and vehicle lifecycle commands, fixed a definer-read leak in `intervention_audit()`, restored the caller check in `is_eligible_recipient_in()`, and labelled parentless vehicle audit events with the vehicle's service. It also refuses an attendance check-in naming a vehicle from the other service. The database suite reported **700 passed, 12 skipped**; disabling that last migration fails 26 new tests. Independent review found no remaining P4b blocker, and CI passed on its exact SHA.

**Next phase after P4d: P4e.** The push worker's service-role queries bypass RLS and must be scoped by hand, and `register_web_push_subscription` is DVD-only. Those workflows remain incomplete.

## Account and service model

One account starts as a limited citizen. The installation owner assigns DVD, SZS or both; membership in one service must not grant access to the other's operations. A person serving in both has **two service-specific member records** (D13), with separate availability, group membership and attendance. The owner administers both services and can have no membership row; firefighting participation still requires a linked member record in the relevant service. No fictional members are to be added for testing the live installation.

Unanswered product questions Q1–Q8 in the plan block the SZS user interface (P6) and/or joint call-outs (P7), especially dual-service response behavior, command, archives and attendance credit. P4b deliberately excludes joint call-outs. Do not silently turn a security fix into an answer to those product questions.

## How to resume

1. Read this file, `docs/MULTI_ORG_PLAN.md`, and the current GitHub PR head before acting; this checkpoint can become stale.
2. Review P4d at PR #62's current head and require full CI on that exact SHA before merging. Then retarget #63 to `main`, verify its exact-head CI, and repeat for #64. Production migration and push-worker deployment have separate gates.
3. Keep the next phase's own boundary closed. Audit all security-definer commands and every table they populate, including history, audit, notifications and service-role workers. Keep one reviewable phase per PR.
4. Record the reviewed SHA, CI run, production migration state, open decisions and next blocker here after each phase. Production deployment and user acceptance testing are separate milestones.
