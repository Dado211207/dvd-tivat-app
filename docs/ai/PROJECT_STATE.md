# Project state

Single source of truth for resuming this work without reading the conversation
that produced it. **Update this file in the same commit as the change it
describes.**

Last updated: 2026-09-11

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
- `main`: `3133d004c6615704278f999384e942b615b96f29` — the merge commit of PR #13.
- Working branch: `claude/dvd-tivat-app-dev-n8wctb`, restarted from that `main`.
- No `LICENSE` file. The owner has not chosen a licence; do not add one.

### Pull requests — live state at 2026-09-11

PR #13 was merged on 2026-09-11 with a **normal merge, not a squash**, so the
fifteen individual commits keep their own history and authorship — including the
work that arrived through the `codex/*` stack. `main`'s tree is byte-identical to
PR #13's head `110e57b`, confirmed by `git diff`.

That merge also closed out the whole earlier stack: #9–#12 and
`codex/access-map-research` were linear ancestors of #13, so all of it landed at
once and none of those branches has unmerged work left.

| PR | State |
|---|---|
| #1 | **Merged** 2026-09-08 |
| #2 | **Closed, unmerged** (superseded) |
| #3–#8 | **Merged** 2026-09-08 |
| #9–#12 | Contained in #13; merged with it |
| #13 | **Merged** 2026-09-11 into `3133d00` |

## Status of this slice

**Slice 2 - real accounts, authentication and access.** Complete.

- PR #13 merged (normal merge); `main` = `3133d00`.
- All four migrations applied to the live project and verified against the
  locally-tested schema, byte for byte.
- The client-role privilege defect that only a real project could reveal: found,
  fixed in two new migrations, and covered by tests that detect it.
- The simulated actor no longer moves any access. Identity, role and status are
  loaded from the server before anything protected renders.
- The owner's account directory is real, and the bootstrap runbook is executed
  by the test suite rather than merely written.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` (unit) | **116 passed** |
| `npm run test:db` (PostgreSQL 16 + RLS) | **100 passed** |
| `npx vite build` | Pass |
| `npm run verify:bundle` | Pass - no secret in the built output |
| `npm run e2e` (browser + axe) | **70 passed** |

## Where things are

```
src/domain/        pure prototype rules (local, simulated actor)
src/access/        the permission matrix, DISPLAY ONLY - authority is the server
src/auth/access.ts         pure access-snapshot loader (injected gateway, unit-tested)
src/auth/AccessProvider.tsx  global state: LOADING until the server answers
src/auth/supabaseClient.ts   the only module that talks to Supabase
src/auth/directory.ts        owner-only account reads and the two owner commands
src/ui/components/RequireRole.tsx  the role guard used by the owner directory
supabase/migrations/
  202609090001_accounts_reports.sql       accounts, roles, abandoned citizen reports
  202609090002_internal_operations.sql    THE INTERNAL OPERATIONS SCHEMA
  202609110003_client_role_privileges.sql least privilege for anon/authenticated
  202609110004_function_execute_privileges.sql  removes the PUBLIC execute grant
supabase/tests/    TEST-ONLY Supabase platform stub - never apply to a real project
db-tests/          integration tests: role matrix, lifecycle, attendance, privileges
docs/ACCESS_MODEL.md   the role and RLS contract, and what is not enforced yet
docs/DATABASE.md       schema semantics, the live project, how to run the DB tests
docs/OWNER_BOOTSTRAP.md the one-time owner procedure - EXECUTED by db-tests/bootstrap.test.ts
scripts/check-bundle-secrets.mjs  reads the built artifact; no secret may ship
```

### Which screens are real

| Screen | Backed by |
|---|---|
| `nalozi` (Nalozi i pristup) | **The server.** Sign-in, registration, profile, role, status, the owner directory and its two commands |
| `dezurni`, `clan`, `vozila`, `prikaz`, `clanovi`, `istorija` | Device-local fictional state and the actor selector. Each carries a banner saying so |
| `dojava` | Abandoned research, local only |

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
5. **The actor selector is a simulation, not authentication.** It must never
   move any access, must stay visibly unlike the real identity control, and
   every screen it drives must say on itself that it is simulated.
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

## The live Supabase project

A project exists and all four migrations are applied to it. Recorded here so
nobody has to rediscover it:

| Fact | Value |
|---|---|
| Project | `dvd-tivat-app`, ref `yskhdzrdbywrpfowckpn`, `eu-central-1` |
| PostgreSQL | 17 (the tests run against 16 locally and in CI) |
| State before | `public` schema completely empty — no migration had ever run |
| Applied | `202609090001`, `202609090002`, `202609110003`, `202609110004`, in order |
| Verified | Structural fingerprint matches the locally-tested schema byte for byte — see [DATABASE.md §3](../DATABASE.md#3-the-real-supabase-project) |
| Publishable key | Safe in the client bundle by design; it is **not** a secret |
| Secret key | Must exist only as a GitHub Actions secret or a git-ignored `.env.local`. Never in a tracked file, never in the bundle, never in a transcript |

**CI does not and must not reach this project.** That would need a secret in CI.
The local PostgreSQL suite is the authoritative automated evidence; no claim here
says the hosted project itself was tested by CI.

## Known limitations (accurate, not aspirational)

- **Only identity and access use the schema.** Interventions, responses, vehicle
  movements and attendance are still device-local fictional state.
- **No password reset**, and email confirmation is expected to be off. Both need
  a configured mail provider (B2).
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

| # | Blocker | State |
|---|---|---|
| B1 | Supabase project | **Resolved.** The owner created one and approved its use; migrations applied and verified |
| B2 | Email verification | **Decided:** "Confirm email" is to be turned **off** in the Supabase dashboard for now, so an account is usable immediately. An SMTP provider is still needed before real registration at scale — Supabase's default sender only reaches project-team addresses and is rate-limited |
| B3 | Notification transport | Open. PWA Web Push vs native must be investigated per platform before anything is promised. Apple Critical Alerts need an entitlement; Google Play restricts SMS permissions |
| B4 | Emergency number to display | **Resolved: 112.** The non-emergency notice names it rather than inventing one |
| B5 | Response visibility | **Resolved:** every member called to an intervention may see the others' responses. That is how a crew coordinates |
| B6 | Second break-glass owner | **Resolved:** one owner only, enforced by the unique index. No second owner for now |
| B7 | Real roster and vehicle data | Open, and a hard rule: real member and vehicle data **never** enters this repository — not in code, fixtures, seed data, tests or documentation |
| B8 | Merging the PR stack | **Resolved.** PR #13 merged 2026-09-11 as a normal merge; the whole stack landed with it |

### Owner action items

Things only the owner can do, recorded so they are not silently assumed done:

1. **Rotate the Supabase secret key.** It may have been exposed earlier. Nothing
   built here needs it at runtime, so rotating it breaks nothing in this app.
2. **Turn off "Confirm email"** in the Supabase dashboard (Authentication →
   Sign In / Providers). There is no API or MCP access to auth configuration
   from here, so this cannot be done for them.

## Next concrete action

Identity and access are done. The operational screens are not. Next slice, in
this order:

1. Members and vehicles as **server** records: owner/admin write commands for
   `members`, `groups` and `vehicles`, which the schema has read policies for but
   no write path to. The roster screen then stops being fictional local state.
2. Link an account to a member record (`members.user_id`), without which a
   signed-in firefighter cannot be a recipient, respond, or check in.
3. The commander draft → review → publish flow against `publish_intervention`,
   including the frozen recipient list and the `QUEUED`-only outbox.
4. Member response against `submit_response`, then check-in / check-out and the
   attendance board against the attendance commands.
5. Only then consider notification transport (**B3**), which is a separate
   investigation and must not be promised before it is done.

Do not start (3) before (1) and (2): an intervention cannot be published to
recipients who do not exist as server-side members.

## Manual owner checklist

Automated tests cannot cover the dashboard or a real browser session. Run this
once, by hand, and record the result here.

Follow [OWNER_BOOTSTRAP.md](../OWNER_BOOTSTRAP.md) first.

| # | Check | Expected | Done |
|---|---|---|---|
| 1 | "Confirm email" is off in the dashboard | Registration produces a usable account immediately | ☐ |
| 2 | Register a brand-new address in the application | Asked for a name, then told the account is waiting for approval | ☐ |
| 3 | While waiting for approval, look at every screen | Nothing operational is offered; the accounts screen says "no rights yet" | ☐ |
| 4 | Run the bootstrap SQL for your own account | `1 row affected`; the verification query returns exactly your address | ☐ |
| 5 | Press **Provjeri pristup ponovo** | The account directory appears, listing the real accounts | ☐ |
| 6 | Try the bootstrap SQL again for a second account | Refused: `access_grants_single_owner` | ☐ |
| 7 | Give the test account `Vatrogasac`, then reload its session | It sees what a firefighter sees, and no more | ☐ |
| 8 | Withdraw its access with a reason, then reload **its** session | Refused on the next request; the reason appears in the audit list | ☐ |
| 9 | Try to change your own role or access in the directory | No control is offered; the row says the owner's account is not changed from here | ☐ |
| 10 | Sign out, then reopen the application | Signed out, and no screen claims a role | ☐ |
| 11 | Open the browser's developer tools, Network tab, and sign in | No `sb_secret_` value anywhere in any request or response | ☐ |

If any of these behaves differently from the expected column, that is a defect —
record it here rather than working around it.

**B1 is resolved** — the project exists, the schema is on it, and identity and
access run against it.
