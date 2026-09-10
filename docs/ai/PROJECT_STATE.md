# Project state

Single source of truth for resuming this work without reading the conversation
that produced it. **Update this file in the same commit as the change it
describes.**

Last updated: 2026-09-09

---

## Current product direction

**DVD Tivat is an INTERNAL mobilisation and intervention-record system.**

Owner decision, 9 September 2026: the application must **not** be developed as a
replacement for reporting a fire by calling the official fire service. Public
citizen reporting is no longer the product focus.

The core workflow:

1. An authorised commander publishes an intervention with verified details and
   an exact location.
2. Approved firefighters receive it internally; those available respond.
3. Response intent stays separate from attendance, vehicle movement and
   intervention status.
4. The system records who actually attended, where, when each person arrived and
   left, and how long each interval lasted.
5. Authorised users can later review reliable historical participation records.

The citizen-report code is **abandoned research**. It is out of the operational
navigation groups, behind an explicitly experimental heading, with a
non-emergency notice on the screen. Do not promote it back without a new
explicit owner decision.

## Repository and branch

- Repository: `Dado211207/dvd-tivat-app` — **public**, and must stay public.
- `main`: `9b4ba3fd22e83d30cb64c9718b673b5c19167a94`
- Working branch: `claude/dvd-tivat-app-dev-n8wctb`, based on
  `codex/access-map-research` (`f1111d56c0285c874534bfa356c9a4a411e1c89c`).
  `main` is an ancestor of that commit and the previous branch head
  (`35a6416`, merged as PR #1) is contained in it, so nothing was discarded and
  no force-push was needed.
- No `LICENSE` file. The owner has not chosen a licence; do not add one.

### Pull requests — live state at 2026-09-09

| PR | Branch | Head | State |
|---|---|---|---|
| #1 | `claude/dvd-tivat-app-dev-n8wctb` | `35a6416` | **Merged** 2026-09-08 |
| #2 | `codex/project-continuity` | `f0d11a6` | **Closed, unmerged** (superseded) |
| #3–#8 | various `codex/*` | — | **Merged** 2026-09-08 |
| #9 | `codex/modern-ui-ux` | `43d7f48` | Open / Draft |
| #10 | `codex/citizen-report-prototype` | `b2c8065` | Open / Draft |
| #11 | `codex/local-admin-prototype` | `034b77b` | Open / Draft |
| #12 | `codex/dvd-tivat-operational-profile` | `8096b1e` | Open / Draft |
| none | `codex/access-map-research` | `f1111d5` | Pushed, **no PR, never CI-verified** |

Verified ancestry: the stack is linear — `main` → #9 → #10 → #11 → #12 →
`f1111d5`. Each is 0 commits behind the next. `f1111d5` is 14 ahead of `main`.

**Merge order if authorised:** #9 → #10 → #11 → #12 → `f1111d5` → this branch.
Because the stack is linear and all of it is contained in this branch, merging
this branch alone would bring everything.

## Status of this slice

Complete and verified: the product-direction correction, the database schema for
internal operations, and its integration tests.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` (unit) | **91 passed** |
| `npm run test:db` (PostgreSQL 16 + RLS) | **81 passed** |
| `npx vite build` | Pass |
| `npm run e2e` (browser + axe) | **66 passed** |

## Where things are

```
src/domain/        pure prototype rules (local, simulated actor)
src/access/        pure account-role policy (not yet wired to the router)
src/auth/          Supabase client - dormant, no project configured
supabase/migrations/
  202609090001_accounts_reports.sql    accounts, roles, abandoned citizen reports
  202609090002_internal_operations.sql THE INTERNAL OPERATIONS SCHEMA
supabase/tests/    TEST-ONLY Supabase platform stub - never apply to a real project
db-tests/          integration tests: role matrix, lifecycle, attendance
docs/ACCESS_MODEL.md   the role and RLS contract, and what is not enforced yet
docs/DATABASE.md       schema semantics and how to run the DB tests
```

## Non-negotiable rules for anyone continuing this work

1. **The repository is public.** No real member names, phone numbers, addresses,
   incident records, credentials or private locations — not in code, fixtures,
   tests, screenshots, logs or CI artifacts.
2. **Never fabricate a delivery, a response or an attendance.** Publishing
   creates a `QUEUED` outbox row and nothing else. No row may say "delivered"
   while there is no transport. Guarded by tests; do not relax them.
3. **Nine facts stay separate** — see
   [ACCESS_MODEL.md §7](../ACCESS_MODEL.md#7-facts-that-are-never-inferred-from-each-other).
   `DOLAZIM` never creates attendance. A vehicle departure never checks anybody in.
4. **Authority is server-side.** RLS grants reads only; every operational write
   goes through a `security definer` command. Do not add a client-writable path.
5. **The role selector in the browser is a simulation, not authentication.** It
   must stay labelled as such and must never be demonstrated as a login.
6. **This is not a public emergency channel.** Never encourage anyone to use it
   instead of calling the official fire service.
7. **No official DVD Tivat logo or branding** unless the society supplies it.
8. **No public deployment**, no app-store submission, no real alerts, no
   contacting anyone, no service purchases.
9. Application labels: local language **without diacritics**. Repository
   documentation: English.
10. If a check fails, fix the cause. Do not weaken assertions or re-run until
    it passes.
11. **Do not apply `supabase/tests/00_supabase_stub.sql` to a real project.**

## Confirmed operating facts

From the owner, a DVD Tivat firefighter-rescuer. Do not ask again.

| Fact | Value |
|---|---|
| Organisation | DVD Tivat only, not multi-tenant |
| Members | 52 |
| Shifts | None |
| Assembly | From home to the base, collect equipment, then deploy |
| Vehicles | One MAN firefighting vehicle, one firefighting SUV |
| Existing alert channel | A Viber group — context only, no integration approved |
| Phones | Both iPhone and Android |
| Prototype data | All member rows and vehicle callsigns are fictional |

## Known limitations (accurate, not aspirational)

- **No application code uses the new schema.** The browser prototype still runs
  on device-local state with a simulated actor. The schema is verified; the
  client is not connected to it.
- **No Supabase project exists.** The migrations have never run against a hosted
  database — only PostgreSQL 16, locally and in CI.
- No notification transport of any kind. No push, SMS, email or call.
- No session invalidation for a suspended account: suspension removes the role
  immediately so every request is refused, but an already-issued JWT stays
  syntactically valid until expiry.
- No media upload pipeline, EXIF stripping or byte-signature validation.
- No CSV export yet.
- No owner/admin write commands for members, groups and vehicles yet.
- A browser prototype is **no evidence** that a locked Android or iPhone will
  raise an alarm.
- No native application, no PWA decision made, no deployment.

## Blockers needing an owner decision

| # | Blocker | What is needed |
|---|---|---|
| B1 | No Supabase project | Approval to create one, and who pays above the free tier. Holds personal data, so it is a privacy decision too |
| B2 | Email verification | A configurable SMTP provider. Supabase's default sender only reaches project-team addresses and is rate-limited; it cannot serve real registration |
| B3 | Notification transport | PWA Web Push vs native must be investigated per platform before anything is promised. Apple Critical Alerts need an entitlement; Google Play restricts SMS permissions |
| B4 | Emergency number to display | The non-emergency notice deliberately does not invent one. Confirm the exact number, or confirm that generic wording is preferred |
| B5 | Response visibility | Currently every member called to an intervention sees the others' responses. Confirm, or restrict to command |
| B6 | Second break-glass owner | Exactly one owner is enforced by a unique index. Decide whether a documented recovery owner is wanted |
| B7 | Real roster and vehicle data | Still fictional. Needs approved data, and a private place to put it |
| B8 | Merging the PR stack | #9–#12 and `f1111d5` are unmerged. Owner decides whether to merge the stack or this branch alone |

## Next concrete action

Connect the application to the verified schema, in this order:

1. A global authentication and access state that loads the profile, role and
   status **before** protected routes render, replacing
   `AccountAccessSetup`'s local `READY` step (which still switches on sign-in
   alone without loading the server profile).
2. Real protected routes driven by `current_dvd_role()`, replacing the
   simulated actor selector on operational screens.
3. The commander draft → review → publish flow against
   `publish_intervention`.
4. Check-in / check-out and the attendance board against the attendance
   commands.

Steps 1–2 need **B1** resolved first. Everything up to and including the schema
is done and tested; what remains is wiring, and it cannot be honestly verified
without a project.
