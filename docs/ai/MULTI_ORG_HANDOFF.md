# Multi-organization handoff — 2026-09-24

This is the current checkpoint for the DVD Tivat / Sluzba zastite i spasavanja Tivat (SZS) rewrite. Update it when a phase is reviewed or merged. The full design, open product questions and phase acceptance criteria live in [MULTI_ORG_PLAN.md](../MULTI_ORG_PLAN.md); this file records the *current state*, not a replacement for that plan.

## Delivery state

| Phase | State |
| --- | --- |
| P0–P3 | Merged into `main`; the P3 equivalence gate against production-derived data passed. |
| P4a (registry) | PR [#56](https://github.com/Dado211207/dvd-tivat-app/pull/56) merged as `f149c7ff7a00ac126ca4dd872ad0b73b03fb3c1b`. It includes migrations `202609240024`–`202609240026`, service-scoped registry writers and audit reads, and an append-only registry audit. |
| P4b (interventions and outputs) | PR [#57](https://github.com/Dado211207/dvd-tivat-app/pull/57) merged as `44314ebd3b4a8b5684e096c0a22a7d2ecd5a3035` after independent review of head `1ced6565611a6273b485e6fa42727c42175e1ae2`. CI run `36044525290` passed, including database and browser tests. Migrations `202609250027`–`202609250029` remain unapplied to production. |
| P4c–P4f, P5–P8 | Not completed. Follow the phase and decision gates in the plan. |

**Production gate:** None of the organization rewrite migrations `202609240022` through `202609250029` has been applied to the hosted project. A green local or PR test does not imply production deployment. Do not apply these migrations as a side effect of merging a PR. The plan requires separate approval per production phase. Do not invent or delete member accounts or demo records.

## P4b review resolved; next boundary

At head `ccc59a8`, DVD-only command/staff policies exposed SZS rows created by publication, journey, attendance and vehicle departure. The final `202609250029` migration closed reads on ten output tables, scoped the attendance and vehicle lifecycle commands, fixed a definer-read leak in `intervention_audit()`, restored the caller check in `is_eligible_recipient_in()`, and labelled parentless vehicle audit events with the vehicle's service. It also refuses an attendance check-in naming a vehicle from the other service. The database suite reported **700 passed, 12 skipped**; disabling that last migration fails 26 new tests. Independent review found no remaining P4b blocker, and CI passed on its exact SHA.

**Next phase: P4c.** `submit_response()` still resolves its member via the DVD shim. It refuses an SZS-only recipient without writing a response, so an SZS recipient cannot yet answer their call-out. Make responses and their revisions work in the intervention's service while preserving DVD behavior and the same-member check that currently prevents cross-service writes. Audit the read policies, security-definer commands and all newly reachable history/audit/notification paths. P4d must enable SZS correction requests; P4e must scope the push worker's service-role queries and support SZS device registration. Those workflows remain incomplete.

## Account and service model

One account starts as a limited citizen. The installation owner assigns DVD, SZS or both; membership in one service must not grant access to the other's operations. A person serving in both has **two service-specific member records** (D13), with separate availability, group membership and attendance. The owner administers both services and can have no membership row; firefighting participation still requires a linked member record in the relevant service. No fictional members are to be added for testing the live installation.

Unanswered product questions Q1–Q8 in the plan block the SZS user interface (P6) and/or joint call-outs (P7), especially dual-service response behavior, command, archives and attendance credit. P4b deliberately excludes joint call-outs. Do not silently turn a security fix into an answer to those product questions.

## How to resume

1. Read this file, `docs/MULTI_ORG_PLAN.md`, and the current GitHub PR head before acting; this checkpoint can become stale.
2. Start P4c from the current `main` (P4b is merged). Require failing-before/passing-after database evidence, preserved DVD behavior and CI success on the exact final SHA.
3. Keep the next phase's own boundary closed. Audit all security-definer commands and every table they populate, including history, audit, notifications and service-role workers. Keep one reviewable phase per PR.
4. Record the reviewed SHA, CI run, production migration state, open decisions and next blocker here after each phase. Production deployment and user acceptance testing are separate milestones.
