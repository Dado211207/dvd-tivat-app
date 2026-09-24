# Multi-organization handoff — 2026-09-24

This is the current checkpoint for the DVD Tivat / Sluzba zastite i spasavanja Tivat (SZS) rewrite. Update it when a phase is reviewed or merged. The full design, open product questions and phase acceptance criteria live in [MULTI_ORG_PLAN.md](../MULTI_ORG_PLAN.md); this file records the *current state*, not a replacement for that plan.

## Delivery state

| Phase | State |
| --- | --- |
| P0–P3 | Merged into `main`; the P3 equivalence gate against production-derived data passed. |
| P4a (registry) | PR [#56](https://github.com/Dado211207/dvd-tivat-app/pull/56) merged as `f149c7ff7a00ac126ca4dd872ad0b73b03fb3c1b`. It includes migrations `202609240024`–`202609240026`, service-scoped registry writers and audit reads, and an append-only registry audit. |
| P4b (interventions) | PR [#57](https://github.com/Dado211207/dvd-tivat-app/pull/57) is **draft and unmerged**. Reviewed head `ccc59a8bcc8a0dbfb85b39d3a67d5788000422cf`; CI run `36036798329` passed, but the independent review found blocking gaps below. Migrations `202609250027`–`202609250028` are proposed only. |
| P4c–P4f, P5–P8 | Not completed. Follow the phase and decision gates in the plan. |

**Production gate:** None of the organization rewrite migrations `202609240022` through `202609250028` has been applied to the hosted project. A green local or PR test does not imply production deployment. Do not apply these migrations as a side effect of merging a PR. The plan requires separate approval per production phase. Do not invent or delete member accounts or demo records.

## Blocking review of PR #57

P4b can create SZS interventions and related records. At `ccc59a8`, its new command guards fix three wrong-service writes (attendance, journey member resolution and vehicle departure), but the newly reachable output tables still have DVD-wide SELECT policies:

- `notification_outbox`: SZS publication queues SZS rows; `outbox_command_read` uses `is_dvd_command()`, so a DVD-only commander can see them.
- `intervention_journey` and `intervention_journey_history`: SZS journey writes are now possible; their command policies still use `is_dvd_command()`.
- `attendance_intervals`: SZS check-ins are now possible; `attendance_command_read` still uses `is_dvd_command()`.
- `vehicle_movements`: SZS vehicle departures are now possible; `vehicle_movements_staff_read` still uses `is_dvd_staff()`.
- Inventory `notification_delivery_attempts` and every related audit/history table and security-definer reader/writer. The `requested_vehicle` argument of `attendance_check_in()` needs a service consistency check; a member-service check does not validate a vehicle.

The owner sent Claude a focused prompt: reproduce these cases against the current PR head, close every read/write boundary made reachable by P4b, run the full database suite and CI, push a new SHA and leave PR #57 draft. **Do not merge #57 on the currently reviewed SHA.** Re-review the new head and exact CI run.

`submit_response()` currently resolves a DVD member inline for both its check and write, so a cross-service response is refused; an SZS-only recipient cannot answer yet. P4c must provide the SZS response path before an operational SZS pilot.

## Account and service model

One account starts as a limited citizen. The installation owner assigns DVD, SZS or both; membership in one service must not grant access to the other's operations. A person serving in both has **two service-specific member records** (D13), with separate availability, group membership and attendance. The owner administers both services and can have no membership row; firefighting participation still requires a linked member record in the relevant service. No fictional members are to be added for testing the live installation.

Unanswered product questions Q1–Q8 in the plan block the SZS user interface (P6) and/or joint call-outs (P7), especially dual-service response behavior, command, archives and attendance credit. P4b deliberately excludes joint call-outs. Do not silently turn a security fix into an answer to those product questions.

## How to resume

1. Read this file, `docs/MULTI_ORG_PLAN.md`, and the current GitHub PR head before acting; this checkpoint can become stale.
2. Finish and independently review PR #57's output-table isolation; require failing-before/passing-after database evidence, preservation of DVD behavior, and CI success on the exact final SHA.
3. Move to P4c only after P4b's boundary is closed. Audit all security-definer commands and every table they populate, including history, audit, notifications and service-role workers. Keep one reviewable phase per PR.
4. Record the reviewed SHA, CI run, production migration state, open decisions and next blocker here after each phase. Production deployment and user acceptance testing are separate milestones.
