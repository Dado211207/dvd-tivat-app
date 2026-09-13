# Project state

Single source of truth for resuming this work without reading the conversation
that produced it. **Update this file in the same commit as the change it
describes.**

Last updated: 2026-09-13

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
- Latest merge checkpoint: `0f1cace73b2b0ef13f16b818ccfcd5273663b5e8` — the
  normal merge commit of PR #19 (documentation: the ADMIN owner decision).
  The latest product-code checkpoint before it is
  `45d53640568a75478c875cdc0aa64ca81911c2eb`, the normal merge of PR #18.
- Earlier checkpoints, still nameable because they are history: `55fdb093`
  (PR #16, slice 3a) and `7d00d9bb` (PR #17, documentation only).
  **Check GitHub for the moving live `main` rather than trusting any SHA here
  as current** (see the note under the PR table).
- Active implementation branch: **`claude/slice-3b-real-operations`**, cut from
  live `main` `0f1cace73b2b0ef13f16b818ccfcd5273663b5e8` (the merge of PR #19).
  `claude/slice-3b-attendance-truth` is merged and finished.
- No `LICENSE` file. The owner has not chosen a licence; do not add one.

### Pull requests — live state at 2026-09-12

Each of these is a **checkpoint statement, true at the moment of that merge**.
`main` has moved on since, so none of them describes `main` today.

PR #13 was merged on 2026-09-11 with a **normal merge, not a squash**, so the
fifteen individual commits keep their own history and authorship — including the
work that arrived through the `codex/*` stack. *At that merge*, `main` was
`3133d00` and its tree was byte-identical to PR #13's head `110e57b`, confirmed
by `git diff`.

That merge also closed out the whole earlier stack: #9–#12 and
`codex/access-map-research` were linear ancestors of #13, so all of it landed at
once and none of those branches has unmerged work left.

PR #14 was merged on 2026-09-11 the same way, on the owner's approval, keeping
its four commits. *At that merge*, `main` was `bd79f7f` and its tree was
byte-identical to PR #14's head `35383a5` (`479b732`), confirmed by `git diff`
and by comparing tree hashes.

PR #15 was merged the same day, again as a normal merge. PR #16 was then merged
normally on 2026-09-12 with explicit owner authorisation, producing product-code
checkpoint `55fdb093`. **That checkpoint contains #13–#16 and is therefore not
byte-identical to any head named above.**

PR #17 was merged normally on 2026-09-12 with explicit owner authorisation,
after its preconditions were checked one by one: head unchanged at `81e9bda`,
all five changed files `.md`, CI green on that exact head, `mergeable_state:
clean`, and no unresolved review threads. Its merge commit is
`7d00d9bb9240beb71ecc9ecd4a3676cd24652db0`, with parents `55fdb093` and
`81e9bda`, keeping all five of its commits. It changed documentation only.

PR #18 was merged normally on 2026-09-12 with explicit owner authorisation,
against a written nine-point checklist the owner supplied: PR open and Draft;
head still exactly `dc0134c5`; base still `7d00d9bb`; `mergeable_state: clean`;
CI run `34707230240` successful on that exact head (`run_attempt: 1`, not a
re-run); no review threads and no reviews; no new commit, file, secret,
personal data, deployment change or hosted migration since the report; the
changed-file set still exactly the reviewed ten; and the ADMIN authority matrix
matching the owner's decision. Its merge commit is
`45d53640568a75478c875cdc0aa64ca81911c2eb`, with parents `7d00d9bb` and
`dc0134c5`, keeping all three of its commits, and its tree is byte-identical to
`dc0134c5`. **That merge made `45d53640` the latest product-code checkpoint.**

| PR | State |
|---|---|
| #1 | **Merged** 2026-09-08 |
| #2 | **Closed, unmerged** (superseded) |
| #3–#8 | **Merged** 2026-09-08 |
| #9–#12 | Contained in #13; merged with it |
| #13 | **Merged** 2026-09-11 into `3133d00` |
| #14 | **Merged** 2026-09-11 into `bd79f7f` |
| #15 | **Merged** 2026-09-11 into `dc3aade` |
| #16 | **Merged normally** 2026-09-12 into `55fdb093`, by the owner. Slice 3a. Implementation checkpoint `cb074eb`; final reviewed head `a5821f4` |
| #17 | **Merged normally** 2026-09-12 into `7d00d9bb`, on the owner's authorisation. Documentation-only post-merge synchronisation, from `codex/post-merge-slice-3a-docs`. Not authored by this session. Merged head `81e9bda` |
| #18 | **Merged normally** 2026-09-12 into `45d53640`, on the owner's authorisation. Slice 3b-0: attendance truth and the withdrawn-account identity fix. Merged head `dc0134c5` |

> **Why this table names checkpoints and not "the current head".** A branch head
> moves; a line in a file does not. Writing one here is exactly how `main` came to
> be recorded as `bd79f7f` two merges after it stopped being true, and how this
> table came to call `cb074eb` the head after `e7df6fc` was pushed. Commits that
> are already history can be named safely; a moving reference cannot.

## Slice 3 — incident dispatch, availability and public visibility

Proposed and owner-approved sequencing, smallest reviewable PR first:

| # | Slice | State |
|---|---|---|
| 3a | Write paths and admin CRUD: intervention drafts, members, groups, vehicles, account linking | **Merged in PR #16. Migration `202609120005` applied to the hosted project 2026-09-12** |
| **3b-0** | **Attendance truth** — provenance, confirmation/rejection, the two write paths that were missing entirely (acknowledgement, vehicle movements), and the withdrawn-account identity fix | **Merged in PR #18. Migration `202609130006` applied to the hosted project 2026-09-12 and smoke-tested there** |
| 3b | General availability (C2), journey progress (C3) and the member-facing response flow on real data | Next |
| 3c | PWA shell: manifest, icons, service worker, install onboarding, offline state | Before push, not after |
| 3d | Push delivery: Edge Function, VAPID secrets, `notification_outbox` wired to a transport | |
| 3e | Public feed: aggregate-only, enforced in the database | |
| 3f | Field-use and accessibility pass, live verification, owner test checklist | |

**Why 3a exists at all, and why it is first.** `202609090002` built a complete
response system with no way to create anything: `publish_intervention` takes an
intervention that must already be a `DRAFT`, and nothing could produce one.
`members`, `groups` and `vehicles` had no write path either. A hundred passing
database tests never noticed, because the test helper inserted drafts as the
**superuser** — a privilege no commander has ever held.

**The defect slice 3b-0 exists to fix, found by inspecting the code rather than
the documentation.** `attendance_check_in()` let a `FIREFIGHTER` create their own
interval; the row landed `verified = false`, which looked like a safeguard; and
**`attendance_totals()` never filtered on `verified`**. So a self-declared claim
was already being summed as participation. Worse, `verified = true` was set in
exactly one place — as a *side effect* of `attendance_correct()` — so
confirmation was not a decision anybody made, and nothing read the column at all.

The owner's recorded rule ("`ON_SCENE` may create an **unverified** interval; it
must never write verified attendance") was therefore already violated before
journey progress existed. The design chosen, of the two the owner offered:
**intervals with an explicit `source` and a three-state confirmation**, not a
separate claims table — it keeps the cross-intervention overlap exclusion
constraint, which is the hard part and already correct, and leaves history and
CSV reading one table.

`source` (who asserted it) and confirmation (whether command decided) are
**independent**. A commander recording somebody else is `COMMAND_RECORDED` and
still unconfirmed, because "I wrote it down" and "I stand behind it" are
different claims.

**A second defect, found in the same slice by a test rather than by reading.**
`current_member_id()` checked only `members.active` — whether the society still
counts the person — and never whether the *account* still had a role. So a
`SUSPENDED`, `PENDING` or incomplete-profile account whose linked member was on
a recipient list kept its **member identity** after losing its authority: it
could read through seven policies, **answer a call-out** via `submit_response`,
and close its own attendance interval. Live on the hosted project, unreachable
through the application because no screen reads any of it from the server.
Fixed at the root in `202609130006` — identity now requires an effective role —
and pinned by `db-tests/authority_matrix.test.ts`, which runs **eleven commands
against ten account states** and declares an expectation for all 110 rather than
testing the states somebody thought of. Full account in
[ACCESS_MODEL.md §2](../ACCESS_MODEL.md#identity-is-not-separable-from-authority).

**And one thing left deliberately unchanged, then decided by the owner.**
`ADMIN` has held full command authority since `202609090002`
(`is_dvd_command()` returns true for `OWNER`, `ADMIN`, `COMMANDER`), while the
documented role table implied administrators only manage records. It was
surfaced rather than altered, and put to the owner.

**Owner decision, 12 September 2026: ADMIN retains full command authority.**
Not an accidental hierarchy — a deliberate choice for the current product
model, because the society is small, each account carries **one effective
role**, and the person who administers the roster may also need to act
operationally. Removing command authority from ADMIN would stop them serving
both functions without first introducing a multi-role or capability model, and
that model is explicitly out of scope for this slice. `OWNER` remains the only
role that may assign roles or suspend and restore access. The full decision,
its reasoning, the one-directional separation-of-duties table and the future
design note are in
[ACCESS_MODEL.md §3](../ACCESS_MODEL.md#3-roles).

### The conservative model is deliberate, and the UI must absorb its cost

The rule is kept: an unconfirmed interval contributes **nothing** to
participation. The owner's concern with that is real and is not being argued
away — after a real call-out a commander may face twenty or thirty intervals,
and a design that demands a separate decision per row will simply not be used,
which leaves the participation record empty instead of wrong. That is a worse
outcome, not a safer one.

The answer is in the interface, not in the data model. **Requirement for the
slice 3b attendance board, binding:**

- A commander must be able to **select many pending intervals and confirm them
  in one action** — "confirm all for this intervention", "confirm all for this
  crew", or a multi-select. One deliberate action may confirm many rows.
- **Confirmation must not require a note.** `attendance_confirm(uuid, text
  default null)` already takes an optional reason precisely so batch
  confirmation is possible without generating thirty identical meaningless
  strings. A forced note is not an audit trail; it is noise that makes the real
  notes unfindable.
- **Rejection and unconfirmation keep requiring a reason**, and that is not
  negotiable for batching convenience. Both override what somebody said about
  their own presence, so both must be explainable afterwards. If a batch
  rejection is ever built, it must collect **one reason that applies to the
  whole batch** and write it to every row — never an empty one.
- Every row still records who confirmed it and the server's time, batch or not.
  Batching changes how many rows one human decision covers; it does not make
  the decision anonymous.

So the cost of the conservative model lands on the number of taps, and the fix
is to reduce the taps. It never lands on the meaning of the record.

**Owner decisions recorded for the rest of the slice:**

1. **Response states** — add a progress column alongside the existing
   `DOLAZIM` / `DOLAZIM_KASNIJE` / `NE_MOGU` answer rather than replacing the
   vocabulary. "I said I would come" and "I am moving" are different facts.
   `ON_SCENE` may create an **unverified** `attendance_intervals` row for a
   commander to confirm; it must never write verified attendance, or self-declared
   presence becomes the participation record.
2. **Public location** — the public feed shows a coarse label (settlement or
   street), never the operational `incident_location` text or the map pin. That
   field is typed under pressure and will name private houses.
3. **Satellite basemap** — the tile source sits behind one config value so the
   provider is a one-line change; ships with Esri World Imagery. Esri's
   application-use licensing position is **unconfirmed** and is the owner's
   accepted risk, reversible at near-zero cost given the abstraction.

**Deferred idea, not a requirement (C9):** public notification opt-in, where a
citizen subscribes to be pushed when a new incident opens.

**Constraint to carry into 3c/3d, and to confirm before relying on it:** iOS Web
Push is understood to ignore application-controlled sound and `vibrate`, so an
incident push would be visually distinct on every platform and audibly distinct
only on Android. **This was asserted from general knowledge, not read from Apple
or W3C documentation, and has not been observed on a device.** Check it against
an official source and the owner's own iPhone before any claim about how an
alarm will be noticed, and get the owner's explicit acceptance of
system-controlled alerting if it holds. The owner's primary test device is an
iPhone, so getting this wrong is not a small matter: a call-out that does not
wake somebody is the failure mode this whole application exists to avoid — which
is also why C8's Viber and telephone fallback is not optional.

## Status of the latest slice

**Slice 3b - the real operational screens.** On branch
`claude/slice-3b-real-operations`, off live `main` `0f1cace7`. Not merged.

What changed, in one line each:

- Migration `202609140007` adds general availability, journey progress and
  `attendance_confirm_many`. Applied to the hosted project; the hosted schema
  fingerprint matches the locally-tested one across all seven sections.
- Three server-backed screens replace the simulation for the work the product
  exists to do: `poziv` (commander), `mobilizacija` (firefighter), `arhiva`
  (the record). Each sits behind one `OperationalGate` that answers from the
  server's snapshot only.
- The fictional actor selector is **not rendered at all** on a server-backed
  route. It cannot be tabbed to, announced or scripted there, and no screen
  there reads the simulation state. The application now opens on `poziv`.
- An installable shell: manifest, generated icons, a service worker that never
  caches a server answer, and honest offline and new-version notices.
- A GitHub Pages workflow that deploys only after CI passes and refuses to
  publish a bundle containing a secret.

Five defects this slice found and fixed, all of which had passed every
existing check:

1. `intervention_acknowledgements.acknowledged_at` and
   `intervention_responses.created_at` do not exist - the columns are
   `opened_at` and `responded_at`. Both were on the two most important screens
   and would have returned HTTP 400 the first time somebody opened them.
   `db-tests/client_schema_contract.test.ts` now checks every column and RPC
   argument the client names against the migrated schema.
2. A confirmed attendance interval shorter than half a second rounded to zero
   seconds, and rendered "0 min" - identical to somebody who never came. Found
   by running the journey against the hosted project.
3. The first service worker claims the open page moments after the very first
   visit; reloading on that discarded whatever the person had already typed.
4. The new fixture server answered every read with an array; PostgREST returns
   a single OBJECT when the client asks for one, so every `.maybeSingle()` read
   looked like a missing row.
5. The browser suite's meaning depended on ambient environment - unconfigured in
   CI only because CI happens to have no `.env.local`. The webServer now pins it.

Two of those were in the new tests rather than in the product. That is worth
recording rather than tidying away: a test whose fixture is wrong reports a
defect that does not exist, and a test whose meaning depends on the machine it
runs on reports nothing reliable at all.

### Verification on the branch head

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` (unit) | **189 passed** |
| `npm run test:db` (PostgreSQL 16 + RLS) | **330 passed**, 12 skipped |
| `npm run e2e` (browser + axe, 2 projects) | **116 passed** |
| `npx vite build` | Pass |
| `npm run verify:bundle` | Pass - no secret in the built output |
| Hosted journey (`hosted_operations.test.ts`) | **12 passed** against the live project |

The 12 skipped database tests are `hosted_operations.test.ts`, which needs
credentials CI deliberately does not have. **A skipped test is not evidence and
that file must never be offered as CI evidence.** Its 12 passes above were
measured locally against the hosted project on 2026-09-13.

## Where things are

```
src/domain/        pure prototype rules (local, simulated actor)
src/access/        the permission matrix, DISPLAY ONLY - authority is the server
src/auth/access.ts         pure access-snapshot loader (injected gateway, unit-tested)
src/auth/AccessProvider.tsx  global state: LOADING until the server answers
src/auth/supabaseClient.ts   the only module that talks to Supabase
src/auth/directory.ts        owner-only account reads and the two owner commands
src/auth/roster.ts           admin reads and commands for members, groups, vehicles
                             and the account-to-member link; pure helpers unit-tested
src/ui/views/OrganisationView.tsx  the Evidencija drustva screen (ADMIN/OWNER) where
                             the society's real records are entered
src/auth/operations.ts       the operational data layer: interventions, recipients,
                             responses, journey, attendance, vehicles, availability
                             and participation totals. Pure helpers unit-tested
src/pwa.ts                   service-worker registration and update handling
src/ui/components/RequireRole.tsx  the role guard used by the owner directory
src/ui/components/OperationalGate.tsx  the single gate every server-backed
                             operational screen sits behind
src/ui/components/ConnectionBar.tsx    offline and new-version notices
src/ui/views/CommandView.tsx       Poziv i intervencija (OWNER/ADMIN/COMMANDER)
src/ui/views/MobilisationView.tsx  Moj poziv, the firefighter's screen
src/ui/views/ArchiveView.tsx       Arhiva i ucesce, the record
public/sw.js                 service worker. NEVER caches a server answer
public/manifest.webmanifest  installable shell; icons from scripts/make-icons.mjs
supabase/migrations/
  202609090001_accounts_reports.sql       accounts, roles, abandoned citizen reports
  202609090002_internal_operations.sql    THE INTERNAL OPERATIONS SCHEMA
  202609110003_client_role_privileges.sql least privilege for anon/authenticated
  202609110004_function_execute_privileges.sql  removes the PUBLIC execute grant
  202609120005_organisational_writes.sql  the WRITE PATHS the schema never had:
                             intervention drafts (command), member/group/vehicle
                             CRUD and account linking (admin), is_dvd_admin(),
                             organisation_audit. Applied to the live project
  202609130006_attendance_truth.sql       ATTENDANCE PROVENANCE AND CONFIRMATION:
                             attendance_intervals.source, the reject/unconfirm
                             fields, attendance_confirm/reject/unconfirm,
                             acknowledge_intervention, the vehicle movement
                             commands, and a REPLACED attendance_totals contract.
                             Applied to the live project
  202609140007_availability_and_journey.sql  general availability (independent of
                             any call-out), journey progress that writes NO
                             attendance, and attendance_confirm_many for batch
                             confirmation. Applied to the live project
supabase/tests/    TEST-ONLY Supabase platform stub - never apply to a real project
db-tests/          integration tests: role matrix, lifecycle, attendance, privileges
  organisation.test.ts       admin-vs-command authority, linking, drafts, audit reads
  availability_journey.test.ts  availability, journey progress and batch confirmation
  client_schema_contract.test.ts  every column and RPC argument the client names,
                             checked against the migrated schema
  hosted_operations.test.ts  the data layer against the HOSTED project. Needs
                             credentials, skips without them, NOT CI evidence
e2e/fixture-server.ts        a fake Supabase project answered inside the browser
e2e/operational.spec.ts      the operational screens POPULATED: phone layout,
                             touch targets and axe on the real rendered state
src/ui/views/operational-views.test.tsx  the same screens rendered in jsdom
docs/ACCESS_MODEL.md   the role and RLS contract, and what is not enforced yet
docs/DATABASE.md       schema semantics, the live project, how to run the DB tests
docs/OWNER_BOOTSTRAP.md the one-time owner procedure - EXECUTED by db-tests/bootstrap.test.ts
docs/DEMO_RUNBOOK.md   the demonstration: accounts, journey, and what must not be claimed
scripts/check-bundle-secrets.mjs  reads the built artifact; no secret may ship
```

### Which screens are real

| Screen | Backed by |
|---|---|
| `poziv` (Poziv i intervencija) | **The server.** Draft, publish, status, the live overview, the attendance board and vehicle movements. OWNER, ADMIN or COMMANDER |
| `mobilizacija` (Moj poziv) | **The server.** Availability, acknowledgement, answer, journey progress, check-in and check-out, for the signed-in member only |
| `arhiva` (Arhiva i ucesce) | **The server.** The chronology of a closed intervention, per-intervention participation, and server-computed totals per member |
| `nalozi` (Nalozi i pristup) | **The server.** Sign-in, registration, profile, role, status, the owner directory and its two commands |
| `evidencija` (Evidencija drustva) | **The server**, from slice 3a. The society's real members, groups and vehicles, and the account-to-member link. ADMIN or OWNER only |
| `clanovi` (Clanovi) | Device-local **fictional** roster with the actor selector. Easy to confuse with `evidencija` and must not be: this one edits invented demonstration data and touches no server record |
| `dezurni`, `clan`, `vozila`, `prikaz`, `istorija` | Device-local fictional state and the actor selector. Each carries a banner saying so |
| `dojava` | Abandoned research, local only |

The navigation is grouped to match: **Operativa** and **Evidencija drustva** are
the server, **Prototip (simulacija)** is not.

The actor selector is rendered **only** on a simulated route. On a server-backed
one it is absent from the DOM entirely, so it cannot be tabbed to, announced by a
screen reader, or found by a script - and no screen there reads the simulation
state. `e2e/admin.spec.ts` states that as its own rule.

Two screens still show members, and only one of them is real. `evidencija` is
where DVD Tivat's actual roster is entered; `clanovi` remains the prototype's
invented roster and stays that way until a later slice replaces it.

## Non-negotiable rules for anyone continuing this work

1. **The repository is public.** No real member names, phone numbers, addresses,
   incident records, credentials or private locations — not in code, fixtures,
   tests, screenshots, logs or CI artifacts.
2. **Never fabricate a delivery, a response or an attendance.** Publishing
   creates a `QUEUED` outbox row and nothing else. No row may say "delivered"
   while there is no transport. Guarded by tests; do not relax them.
3. **Ten facts stay separate** — see
   [ACCESS_MODEL.md §7](../ACCESS_MODEL.md#7-facts-that-are-never-inferred-from-each-other).
   `DOLAZIM` never creates attendance. A vehicle departure never checks anybody
   in. Saying you attended is not command standing behind it.
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

A project exists and **all seven migrations are applied to it**, verified by a
structural fingerprint that matches a local PostgreSQL 16 built from the same
files. Recorded here so nobody has to rediscover it:

| Fact | Value |
|---|---|
| Project | `dvd-tivat-app`, ref `yskhdzrdbywrpfowckpn`, **`eu-west-1`** (the docs said `eu-central-1`; the Management API reports `eu-west-1`, so the documented value was wrong) |
| PostgreSQL | 17 (the tests run against 16 locally and in CI) |
| State before | `public` schema completely empty — no migration had ever run |
| **Applied** | All seven. `202609120005` and `202609130006` on 2026-09-12 with the owner's conditional authorisation, after a non-destructive preflight; `202609140007` on 2026-09-13 |
| **Verified** | Structural fingerprint matches a local PostgreSQL 16 built from the same files — **all seven sections identical**, functions `ee2886b99683c44f00216a7e84e7b0dd`, 46 functions |
| Verified | See [DATABASE.md §3](../DATABASE.md#3-the-real-supabase-project) |
| **Contents** | Eight fictional accounts, seven fictional members, two groups, three vehicles. No interventions between demonstrations. Every address is on the reserved `.invalid` domain and cannot receive mail. Passwords are **not** in this repository |
| Publishable key | Safe in the client bundle by design; it is **not** a secret |
| Secret key | Must exist only as a GitHub Actions secret or a git-ignored `.env.local`. Never in a tracked file, never in the bundle, never in a transcript |

**CI does not and must not reach this project.** That would need a secret in CI.
The local PostgreSQL suite is the authoritative automated evidence; no claim here
says the hosted project itself was tested by CI.

## Known limitations (accurate, not aspirational)

- **Identity, access and the society's records use the schema; the incident path
  does not.** Members, groups, vehicles and the account-to-member link are real
  server records with a real screen (`Evidencija drustva`, slice 3a). Drafting a
  call-out has a tested server command but no screen yet. Interventions,
  responses, vehicle movements and attendance are still device-local fictional
  state, and each of those screens says so on itself.
- Real sign-up through the app's own registration form, with a real deliverable
  email, has not yet been exercised end-to-end — every verification so far either
  used privileged SQL to create accounts directly, or the app's internal modules
  driven by a test harness, never a human clicking through the actual sign-up UI.
  Close this the first time a real registration flow is built or manually
  exercised, before any real DVD Tivat member is invited.
- **No password reset.** It needs a configured mail provider (B2). Whether email
  confirmation is currently on or off is **unresolved** — two conflicting
  observations are recorded under Owner action items; do not assume either.
- No notification transport of any kind. No push, SMS, email or call.
- No session invalidation for a suspended account: suspension removes the role
  immediately so every request is refused, but an already-issued JWT stays
  syntactically valid until expiry.
- No media upload pipeline, EXIF stripping or byte-signature validation.
- No CSV export yet.
- ~~No screen publishes a real call-out.~~ **Resolved 2026-09-13:** `poziv`
  drafts, publishes, runs and closes a real intervention; `mobilizacija` answers
  and records attendance; `arhiva` reads the record. Verified against the hosted
  project. The simulated `dezurni` screen remains, clearly labelled.
- ~~Two migrations are not applied to the hosted project.~~ **Resolved
  2026-09-12: all six are applied and fingerprint-verified.** Both defects
  slice 3b-0 fixed are now fixed on the live database too, and the whole
  operational journey was exercised there against disposable fictional data.
  What is still missing on the hosted project is **data and screens**, not
  schema.
- A browser prototype is **no evidence** that a locked Android or iPhone will
  raise an alarm.
- ~~The PWA itself is not built.~~ **Resolved 2026-09-13:** manifest, icons,
  installable standalone shell, a service worker that caches only the shell and
  never a server answer, honest offline and update states, and a GitHub Pages
  workflow. **Still no native application**, and the deployment needs two
  repository variables set once — see docs/DEMO_RUNBOOK.md §3.1.
- **No offline queue.** An action taken with no signal is refused and not
  stored; the interface says so rather than pretending it was saved.
- **No notification transport of any kind.** Publishing writes rows saying a
  message is owed. Nothing sends them, and nothing in the interface may say a
  member was notified.

## Blockers needing an owner decision

| # | Blocker | State |
|---|---|---|
| B1 | Supabase project | **Resolved.** The owner created one and approved its use; **all seven migrations are applied and fingerprint-verified there** |
| B2 | Email verification | **Decided:** "Confirm email" is to be turned **off** in the Supabase dashboard for now, so an account is usable immediately. **Whether it actually is off is unresolved** — two conflicting observations are recorded under Owner action items. An SMTP provider is still needed before real registration at scale: Supabase's default sender only reaches project-team addresses and is rate-limited |
| B3 | Notification transport | **Decided and now active work, not deferred.** PWA Web Push, server-sent from an Edge Function (C1, C8) — slice 3d. Still unbuilt and unproven: nothing may be promised about delivery. **Every platform claim below is UNVERIFIED** and must be checked against Apple/W3C documentation and a real device before it is relied on: that iOS requires the PWA on the home screen, that iOS ignores application-controlled sound and `vibrate`, and that Apple Critical Alerts need an entitlement a PWA cannot hold. See the paragraph under "Slice 3" — these were asserted from general knowledge, not read from an official source |
| B4 | Emergency number to display | **Resolved: 112.** The non-emergency notice names it rather than inventing one |
| B5 | Response visibility | **Resolved:** every member called to an intervention may see the others' responses. That is how a crew coordinates |
| B6 | Second break-glass owner | **Resolved:** one owner only, enforced by the unique index. No second owner for now |
| B7 | Real roster and vehicle data | Open, and a hard rule: real member and vehicle data **never** enters this repository — not in code, fixtures, seed data, tests or documentation |
| B8 | Merge convention | **Resolved: normal merge commits, never squash.** Followed for #1, #3–#8, #13, #14, #15, #16 and #17, so each PR's commits keep their own history and authorship |

### Owner action items

Things only the owner can do, recorded so they are not silently assumed done.
**Reported done is not verified done**, and the distinction is kept deliberately:
these concern a private hosted project that this repository's tests cannot reach.

1. **Rotate the Supabase secret key.** It may have been exposed earlier. Nothing
   built here needs it at runtime, so rotating it breaks nothing in this app.
   *Reported by the owner on 2026-09-12 as rotated, with the replacement stored
   only as a GitHub Actions secret. Not independently confirmed from here, and
   deliberately not inspected — so this stays listed until the owner confirms it
   directly.* Leaving a done item on the list costs a moment; removing an
   undone one leaves a possibly-exposed key rotated only in a document.
2. **Confirm the "Confirm email" setting**, in the Supabase dashboard
   (Authentication → Sign In / Providers). There is no API or MCP access to auth
   configuration from here, so this cannot be checked or changed for them.

   **Two observations conflict and neither is being picked over the other:**

   | Date | Source | Observation |
   |---|---|---|
   | 2026-09-11 | Read directly from `GET /auth/v1/settings` during the second live pass | `"mailer_autoconfirm": false` — confirmation **ON**, and GoTrue additionally rejected `@example.invalid` and `@example.com` as undeliverable, plus a 429 rate limit |
   | 2026-09-12 | Owner continuity record (B2), reported | Provider enabled and `mailer_autoconfirm: true` — confirmation **OFF** |

   The setting may simply have been changed between the two. It matters because
   it decides whether registration yields a usable session immediately, so it
   should be read from the dashboard once and the answer recorded here rather
   than inferred.

## Next concrete action

Identity, access, the society's records **and the incident path** are done. The
commander publishes, the firefighter answers and attends, the commander
confirms, the archive shows the record - all against the real database, verified
live.

What is left, in order:

1. **Open the slice 3b pull request, review its exact head, and merge only on
   green CI.** Normal merge commit, never a squash or a rebase of a shared
   branch (B8).
2. **Set the two repository variables and run the deployment workflow** - see
   docs/DEMO_RUNBOOK.md §3.1. This is the one step between the branch and a
   public demonstration URL, and it needs the owner because this repository
   keeps placeholder configuration only.
3. **Rehearse the journey in docs/DEMO_RUNBOOK.md §5** on the devices that will
   be used, from two browser profiles.
4. Only then notification transport (**B3**), which must not be promised before
   it is built and tested on a real device. Nothing today sends anything.

Not blocking the demonstration, and worth doing after it:

- An offline queue, so an action taken with no signal is stored and sent rather
  than refused.
- Replace the simulated `clanovi`, `dezurni`, `clan`, `vozila`, `prikaz` and
  `istorija` screens, or delete them. They are kept for now because they still
  demonstrate ideas the server slice has not reached, and because they were the
  safety net while the real screens were being built.
- A second Supabase project, so a demonstration and any real use are not the
  same database.

## Manual owner checklist

Automated tests cannot cover the dashboard or a real browser session. Run this
once, by hand, and record the result here.

Follow [OWNER_BOOTSTRAP.md](../OWNER_BOOTSTRAP.md) first.

| # | Check | Expected | Done |
|---|---|---|---|
| 1 | **Read** whether "Confirm email" is on or off, and write the answer into Owner action item 2 | Whichever it is, it is now recorded instead of assumed. Off means registration produces a usable account immediately | ☐ |
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

**B1 is resolved** — the project exists, **all seven migrations are on it**, and
identity, access, the roster and the whole operational journey have been
exercised against it through the application's own data layer.

Since 2026-09-13 the project also holds a **fictional demonstration cast**:
eight accounts covering every role and state, seven members, two groups and
three vehicles. There are no interventions between demonstrations. Every
address is on the reserved `.invalid` domain, which cannot receive mail, and no
password is in this repository.
