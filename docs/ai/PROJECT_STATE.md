# Project state

Single source of truth for resuming this work without reading the conversation
that produced it. **Update this file in the same commit as the change it
describes.**

Last updated: 2026-09-21

## Current delivery: the owner's own iPhone testing

Five faults reported by the owner from his own phone. Two of them, A and B,
turned out to be one defect: **his account has no `members` row.** That makes
`current_member_id()` null, which is why the call-out screen says his account is
not linked, and it makes `register_web_push_subscription` raise
`ELIGIBLE_MEMBER_REQUIRED`, which the client reported as a connection failure.
The VAPID key is present and valid in the deployed bundle; it was never the
cause.

- **A - owner as firefighter.** No code change is needed for the member link:
  `admin_create_member` and `admin_link_member_account` gate on `is_dvd_admin()`
  (`OWNER` or `ADMIN`) and have no self-targeting guard, the directory does not
  filter out the signed-in user, and `is_eligible_recipient` accepts `OWNER`.
  Assigning himself a DVD *service* was genuinely blocked, and migration
  `202609210016` lifts it while keeping the owner's grant untouchable.
- **B - push messages.** Each server refusal now reaches the screen as itself.
  A refusal carrying a PostgREST code is never reported as a connection problem.
- **C - mobile layout.** The accounts table adopts the existing `table--cards`
  pattern and releases its 920px minimum width; a fixed strip paints the
  `--safe-top` inset so nothing scrolls out from under the iOS status bar.
- **D - reload on tab switch.** Already fixed on 2026-09-13 in `323b633` and
  present in the deployed build. Browser-level tests now cover it; they pass
  unchanged, so they are a guard and not evidence of a repair.
- **E - demo data.** Inventory only, in `docs/DEMO_DATA_INVENTORY.md`. Nothing
  deleted. Awaiting the owner's decision.

**Open decision:** the data-layer read contract. `ead7820` made
`fetchInterventions` throw; the remaining five reads still return `[]` or `null`
on failure. Whether to finish that as `ReadResult<T>` (compile-time enforced) or
as more throws is not settled. Work in progress is saved outside the repository.

**Verification boundary:** the SQL behaviour is proved against a local
PostgreSQL running the real migrations. Migration `202609210016` is **not
applied to production** - production is at `202609200015`, matching `main`.
`db-tests/hosted_operations.test.ts` (12 tests) needs hosted credentials and is
skipped, not passed.

## Previous delivery: citizen-first SZS account activation

The owner clarified the intended onboarding contract: nobody is pre-created in
DVD or SZS. Every person registers their own account, starts as a limited
`CITIZEN`, and can see only their personal account and device settings. The
single system owner then uses two independent selectors to assign DVD, SZS or
both services.

Migration `202609200015` makes that contract authoritative. It changes the
registration default and existing unassigned `PENDING` rows to `CITIZEN`, gives
SZS the full display name `Sluzba zastite i spasavanja Tivat`, adds a self-only
active-membership RPC, and changes DVD removal to return the compatibility
grant to `CITIZEN` without erasing SZS membership. `current_dvd_role()` still
returns NULL for citizens and SZS-only users, so neither can read DVD
operational data.

The application gives a signed-in citizen only **Nalozi** and **Podesavanja** in
the primary navigation and lands them on their account instead of an
operational refusal. The personal account card shows active service roles. The
owner directory names both services, states that service assignment is active,
and supports DVD-only, SZS-only, both or neither. No member, vehicle, group or
intervention is invented for either service.

Local lint, TypeScript, 647 unit/component tests, both production builds,
bundle-secret scanning and the production dependency audit pass. PR #38 CI
#115 then passed the missing PostgreSQL 16/RLS and Playwright/accessibility
gates on head `8d9572a`.

The hosted preflight found six active DVD memberships, zero SZS memberships,
one legacy unassigned `PENDING` grant and no migration 015. Migration 015 was
applied transactionally with exactly one migration-history row. Postflight
found the same six DVD memberships, still zero SZS memberships, one limited
`CITIZEN`, no `PENDING`, the official SZS name and the self-only RPC with
`authenticated` execute and no `anon` execute. The Pages repository variable
`VITE_MULTI_SERVICE_ADMIN_ENABLED` was already `true`; nobody was added to DVD
or SZS. PR #38 was squash-merged as `d8e4b84`; main CI #117 and Pages deploy
#24 passed. The public `Nalozi` smoke test loaded the six-field registration
form and the citizen-first explanation (DVD, SZS or both by owner decision)
without creating an account or exposing a visible application error.

## Previous delivery: required registration profile and member-link readiness

The current `main` checkpoint was inspected before editing. Registration still
accepted only email/password and asked for a name after sign-in; telephone and
date of birth did not exist in the database, and the owner account directory
did not show whether an approved firefighter was linked to a member record.

Migration `202609200014` adds telephone and date of birth to `profiles`,
normalizes Montenegro/local and explicit international telephone input to
E.164, rejects future dates, and replaces the one-argument profile command so
an older or direct client cannot mark a name-only profile complete. New sign-up
metadata is treated as untrusted: invalid or missing fields create an
incomplete `PENDING` account with no operational role. Existing accounts are
marked incomplete until they provide the new fields.

The registration screen now collects full name, telephone, email, date of
birth, password and matching password confirmation in one flow. The same three
profile fields are available to existing incomplete accounts. The owner-only
directory shows telephone, date of birth and whether the account is linked to a
member record, with a direct route to `Evidencija` when it is not.

This delivery is hosted. Migration 014 was applied transactionally to the
production project immediately before PR #36 was squash-merged as `8b78716`.
The postflight confirmed one migration record, the new three-argument command,
no legacy name-only command, and all eight existing profiles incomplete until
they provide telephone and date of birth. PR CI #109 and main CI #110 passed;
Pages deployment #22 then published the matching client. The public account
screen was checked at the deployed URL and shows all six required registration
fields without application console errors.

## Previous delivery: owner multi-service account administration

The owner requested one protected personal account with a complete account
directory: every registered user, separate DVD Tivat and SZS membership roles,
global suspension/restoration, password-recovery initiation and permanent
audit. Migration `202609200013` adds `organizations`, organization-scoped
memberships and their audit plus one owner-only command. Existing DVD roles are
backfilled into the DVD organization; no SZS membership is inferred.

The account screen now has separate DVD and SZS selectors. A person may hold a
different role in each service. Assigning SZS never widens DVD authority. The
existing global grant remains the DVD compatibility authority until every
operational table and policy is explicitly organization-scoped. Passwords are
never displayed or set by an administrator; the owner can only send the same
one-time recovery code used by the guarded recovery flow.

Migration 013 is present on the hosted project. The SZS controls still fail
closed behind `VITE_MULTI_SERVICE_ADMIN_ENABLED`; enablement remains a separate
product decision. Password email remains separately gated by
`VITE_PASSWORD_RESET_ENABLED` and the SMTP acceptance in
`docs/ACCOUNT_RECOVERY.md`.

## Previous delivery: video-guided security hardening

Four supplied videos were reviewed: three security checklists and one design /
Playwright workflow recommendation. The security lists were checked against the
real repository rather than copied as generic tasks. The existing row-level
security, RPC role checks, bundle-secret scan, restricted push origin,
privacy-safe push payload, Playwright/axe suite and design direction already
cover most of the useful advice.

This delivery closes the concrete browser gap found by the review: a restrictive
Content Security Policy and no-referrer policy now ship in the main document,
and the service-worker offline document no longer needs inline JavaScript. CI
also audits production dependencies for high/critical advisories. The reviewed
evidence and the remaining hosted/device checks are in
`docs/SECURITY_REVIEW.md`.

No source review or browser policy proves physical notification delivery,
hosted rate limits, email recovery, restore readiness or operational approval.
Those remain the explicit acceptance tasks below.

Local validation passed for ESLint, TypeScript, the production build, the built
bundle secret scan, the production dependency audit and whitespace checks. The
full unit, database, browser, accessibility and screenshot suites are left to
the pull-request CI so their result is tied to the published commit.

## Previous delivery: account recovery and release acceptance

PRs #30, #31, #32 and #33 are merged on `main`; the release-state checkpoint is
`2198d3c`. PR #32 CI #100 and post-merge main CI #101 both passed. The deployment
workflow #17 completed and the published copy at
`https://dado211207.github.io/dvd-tivat-app/` returns the current Boka Operativa
shell. The recovery build gate is disabled there as intended until hosted email
acceptance passes.

This delivery implements forgotten-password recovery with an emailed one-time
code, matching password confirmation and a temporary non-persistent recovery
session. It stays behind `VITE_PASSWORD_RESET_ENABLED` until a custom SMTP
provider, the `{{ .Token }}` recovery template and hosted-mail acceptance pass.
Every address receives the same on-screen response so the form does not reveal
which members have accounts.

`docs/ACCOUNT_RECOVERY.md` contains the exact enablement gate.
`docs/RELEASE_ACCEPTANCE.md` records the real-device, locked-phone, complete
fictional intervention, backup/restore and three-exercise pilot checks. CI #100
passed 631 unit tests, 367 database tests (12 hosted checks skipped), 276
browser/accessibility cases, six screenshot scenarios, build and bundle-secret
checks. Local recovery-disabled and recovery-enabled builds, TypeScript, ESLint,
workflow YAML parsing and `git diff --check` also passed. Physical-device,
SMTP/mail delivery, backup restore and supervised pilot acceptance remain open.

## Previous follow-up: operational read failures

Merged PR #31 fixes the intervention-list error contract documented in
`docs/UX_AUDIT.md` §10c. Failed reads now reach the command, member and archive
error handlers. Initial command/member loading and failure no longer imply an
empty intervention list; member and archive screens distinguish denied reads
from unavailable data. Its own CI #98 passed before merge.

## Previous delivery: Boka Operativa UX and language pass

The UX working branch is `codex/boka-operativa-ux-brand`, based on the
locally recorded `origin/main` checkpoint `5179472` (PR #29). This is a local
implementation checkpoint, not a claim about the current hosted version.

Completed in this branch:

- Boka Operativa identity across the shell, manifest, icons and push title.
- Quieter screen headings and collapsible field help with a 44px touch target.
- Account and organisation forms, account roles, readiness, and live status
  labels in both supported languages. Account audit and onboarding explanations
  start collapsed.
- Translated owner refusals, 41 operational refusal codes, 14 roster refusal
  codes, profile-save failures and required/optional field labels. User-entered
  notes and server records are never translated.
- Explicit loading and failed-read states for the account directory, its audit
  history, and organisation records, with retry controls. A failed request no
  longer reports an empty roster or a count of zero accounts.
- A documented multi-service design in `docs/PRODUCT_DIRECTION.md`; the runtime
  remains scoped to the existing DVD Tivat organisation.

Validation for this delivery: TypeScript, ESLint, production build and
`git diff --check`. No unit, database, browser or physical-device tests were
run for this branch. Passing the build is not evidence of hosted notification
delivery or device layout acceptance.

PR #30 was merged after GitHub CI completed. Its first run passed lint and
TypeScript but reported three sign-in message
regressions (628 unit tests passed). The follow-up restores distinct network
failure wording, repeated-failure content-blocker guidance and the generic
credential refusal in both languages. Check the latest PR run for its result;
the failed initial run skipped database and browser checks. Local functional
and device tests were not run.

The second automatic CI run passed all 631 unit tests, 367 database tests
(12 hosted checks skipped), build and bundle checks. Its browser stage passed
262 cases and failed 14: seven outdated UI assumptions repeated at desktop and
mobile sizes. Existing scenarios now target the renamed account labels and
direct disclosure summaries, and the keyboard scenario tabs through the new
field-help control before entering the location. No scenario was removed or
disabled. The corrected PR result passed before merge.

At that checkpoint the pass had not published a hosted release or changed the
production database. Multi-service implementation
requires the service-owner decisions listed in `docs/PRODUCT_DIRECTION.md`.
The operational read-error contract issue recorded in `docs/UX_AUDIT.md` §10c
is addressed in the separate follow-up above.

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
- Latest verified historical merge checkpoint: `7fa8ec33274da36957f7953dbb31c23f6dcbeb4a`
  — normal merge commit of PR #25, the final presentation-stabilisation follow-up.
  Check GitHub rather than treating this historical checkpoint as a moving
  current-head claim.
- Earlier checkpoints, still nameable because they are history: `55fdb093`
  (PR #16, slice 3a) and `7d00d9bb` (PR #17, documentation only).
  **Check GitHub for the moving live `main` rather than trusting any SHA here
  as current** (see the note under the PR table).
- Earlier implementation branch: `codex/web-push-notifications`, started from
  historical checkpoint `7fa8ec3`. It contains Web Push source work only; no
  hosted migration, function deployment or physical-device success is claimed.
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
| #27 | **Merged normally** 2026-09-15 into `92c7e74`. Language, task-ordered navigation, push-latency diagnosis |
| #28 | **Merged normally** 2026-09-17 into `e050141`, on green CI run `35136122173` (attempt 1) on its exact head `b2cba92`. The clarity redesign. Pages deploy run `35165704526` succeeded on the merge commit, and the served bundle was verified to contain the new chunks |

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
| 3b | General availability (C2), journey progress (C3) and the member-facing response flow on real data | **Merged and hosted** |
| 3c | PWA shell: manifest, icons, service worker, install onboarding, offline state | **Merged and hosted** |
| 3d | Push delivery: Edge Function, VAPID secrets, `notification_outbox` wired to a transport | **Implemented on `codex/web-push-notifications`; local client tests/build pass. Hosted setup and physical-device proof remain** |
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

**The clarity redesign**, on branch `claude/dvd-tivat-app-dev-n8wctb` from
`92c7e74` (the merge of PR #27). The previous pass fixed the navigation; the
screens a person arrives at were still crowded. This pass is about what a
firefighter and a commander see once they are there.

Full reasoning, with the measurements that drove it, is in `docs/UX_AUDIT.md`
part two. The short version:

1. **One dominant action on the firefighter's screen.**
   `src/ui/views/callOutStep.ts` is a pure function answering "what is left for
   this member?", and its answer is the only large thing on the screen. The four
   facts the schema keeps apart stay four separate facts, as a one-line strip
   rather than four equal-weight panels of which three were already finished.
   Every other action remains reachable one disclosure away. `Dolazim` and `Ne
   mogu` now commit in one tap, not two.
2. **The commander lands on the incident and the response counts.** One shared
   `IncidentCard` for both roles, `ODZIV` with six separately-counted answers
   below it, four tabs on one row at 390px in both languages, and the
   intervention picker demoted to a switcher that appears only when there is
   something to switch between.
3. **A call-out is written in a four-step sequence** - what happened, where and
   what to do, who, then a review showing the incident and the names before
   anything reaches a telephone. It uses the two server operations that already
   existed; the split between steps two and three is exactly the write boundary.
4. **A half-typed call-out survives a reload** (`src/ui/views/callOutDraft.ts`),
   and is cleared the moment the draft reaches the server.

Merged as `e050141`. A follow-up on the same branch then closed the one thing
the brief asked for that the redesign had not reached: **the loading, offline,
permission-denied and server-error states, in both languages.**

- The offline and "new version ready" bars were written straight into
  `ConnectionBar` and never left it, so they stayed Montenegrin on an English
  screen - on every operational screen, and in the one state where being
  understood matters most.
- **`REFUSED_READ` on the commander's console was unreachable code.** It was
  guarded by `error instanceof Error && /permission/i.test(error.message)`, and
  a PostgREST failure is a PLAIN OBJECT (`{ message, details, hint, code }`),
  not an `Error` - so the first half was always false. A commander whose role
  had been taken away was told the server was unavailable and to wait for it.
  `isPermissionDenied` in `supabaseClient.ts` now reads the `42501` code and
  the message off whatever shape was thrown, via `errorMessageOf`.

**Two defects found while redesigning, both predating this pass:**

- The status strip printed `Prisustvo: ne` to a member who had checked in,
  worked ninety minutes and checked out - because attendance was read as a
  boolean and a CLOSED interval is not "checked in". It is four states now
  (`AttendanceStanding`), and `~` with the words `Ceka potvrdu` is what that
  member sees.
- The `Ne prijavljuje prisustvo - ni "Na licu mjesta"` warning was shown only
  while reporting movement was the current step, so it vanished once a member
  reported being on scene - leaving the movement buttons reachable with nothing
  warning about them. It now travels with those buttons.

**No schema, RLS, authorization, role-meaning, audit, server-workflow or Web
Push change.** The push panel's shape changed (one line during a call-out, the
full panel in Settings and when nothing is running); nothing about what it does.
Permission is still never requested without a press.

---

### Previous slice: language, navigation and push latency

On branch `claude/ux-language-push-latency` from `4e944e1`, merged as PR #27
(`92c7e74`). Three deliverables:

1. **Crnogorski and English**, chosen on a new `podesavanja` route and
   remembered on that device. `strings.me.ts` is the source of truth;
   `strings.en.ts` is typed `typeof me`, so an untranslated sentence is a
   compile error. **Nothing about the language reaches the server.** Times stay
   in Europe/Podgorica in both languages; only the way an instant is written
   follows the language. Member-entered and stored content is never translated.
   Coverage of the server vocabulary now runs against both bundles - 40
   assertions became 80, and roles are included.
2. **Navigation by task.** Two groups (Rad, Drustvo) replacing three captions
   over three links. **Every simulation, including the station display, left the
   rail** and is reached from Settings behind a closed disclosure - routes,
   code and each screen's own notice untouched. Three screens now lead with what
   the person came for; the secondary panel closes below it, in one render
   position so a half-typed draft cannot be unmounted away.
3. **Push latency: three defects fixed, and the diagnosis made possible.** Sends
   were strictly sequential in two nested loops, the commander's screen waited
   for the whole fan-out with no deadline, and `provider_status` could not
   distinguish the commander's immediate wake-up from the once-a-minute
   scheduler. That last one is the fix that matters: it is the difference
   between "fast" and "a minute late", and it needed no migration. See
   `docs/PUSH_LATENCY.md`.

**The hosted push timing baseline was NOT captured.** The Supabase MCP
connection available to that session returned "requires approval" and then
`You do not have permission to perform this action` on every attempt to read
`notification_outbox` and `notification_delivery_attempts`. So it is **unknown**
whether the owner's delayed notification came through the immediate path or the
scheduled one. `docs/PUSH_LATENCY.md` §5 has the queries that answer it.

**Hosting: stay on GitHub Pages.** Reasoning in `docs/HOSTING_DECISION.md`.
Nothing was changed; no DNS, no deployment, no secret.

Defects found and fixed while doing the above: a rail note claiming "LOKALNA
SIMULACIJA - bez stvarnih poziva i obavjestenja" on **every** screen including
the server-backed ones; eight timestamps rendering in the device's time zone
rather than Montenegro's; and the archive asserting publishing sent nothing,
which Web Push made false.

---

### Historical: the Web Push handoff review

**Web Push, reviewed but NOT yet deployed** (as recorded on 2026-09-14). A
handoff patch adding protected Web Push call-out alerts was applied onto
`7fa8ec3` (no conflict, hash verified) on branch `claude/web-push-notifications`,
and seven defects found in review were fixed - full detail in
`docs/ai/WORK_LOG.md`. The most serious: repairing a push registration could
silently re-enable an alarm a member had turned off.

**Nothing hosted has changed.** The Supabase project `yskhdzrdbywrpfowckpn` has
not had migration `202609150012` applied, has no Edge Function deployed, holds no
VAPID or worker secret, and has no scheduled invocation. The repository variable
`VITE_WEB_PUSH_PUBLIC_KEY` is not set, so a deployed build reports
`NOT_CONFIGURED` and offers no opt-in. This is a permission blocker, not a
decision: the Supabase management calls this session needed were not approved,
and `api.github.com/repos/.../actions/variables` answers **403** through this
environment's egress proxy while `/actions/runs` answers 200.

**Web Push is optional to the deployment, on purpose.** The handoff made
`VITE_WEB_PUSH_PUBLIC_KEY` mandatory in the Pages workflow, which would have
stopped the whole application publishing until somebody generated VAPID keys -
for a feature the application itself already treats as absent-by-default. The
workflow warns and deploys without push instead. Deployment and push
configuration are now independent, in both directions.

Until that configuration exists, **no push alert can be sent at all**, and no
claim about one should be made. The in-app call-out path is unaffected.


**The measured record.** Nine defects from an independent hosted-browser review,
fixed on branch `claude/dvd-tivat-app-dev-n8wctb`. Full detail is in
`docs/ai/WORK_LOG.md`; the headlines:

- **A ten-second attendance interval displayed as "1 min"**, and the invented
  minute reached the participation total. `src/auth/duration.ts` measures in
  milliseconds, sums before formatting and rounds once, and can express
  seconds - which removes the reason the old `Math.max(minutes, 1)` floor
  existed. `null` is "not measured"; `0 s` is a measurement of no time.
- **The commander's overview showed five states per member and not one
  duration.** `src/auth/metrics.ts` computes every response timing and every
  summary figure; `src/ui/components/timings.tsx` renders them, on BOTH the
  console and the archive, from one `summarise()` - so one incident cannot show
  two different numbers.
- **Every "first" is chosen chronologically**, through `earliestBy`, with a
  stable tie-break. Never `[0]` of a list.
- **Nothing is collapsed into a "vrijeme odaziva".** Publication-to-opening,
  publication-to-answer, opening-to-answer and publication-to-arrival each keep
  their own label. A test asserts the phrase appears nowhere.
- **Vehicle and state durations are printed**, with the actor behind each end.
  The archive used to show two timestamps and leave the reader to subtract them.
- **Times carry seconds** (`dd.MM.yyyy. HH:mm:ss`), so a duration can be checked
  against the timestamps it came from.
- **Citizen reporting is out of the deployed navigation**, together with the
  five simulations that duplicate a server-backed screen. Routes and code stay;
  `ROUTES_NOT_OFFERED` makes the exclusion a decision a test can check.
- **Closure notes no longer produce "prototipa.."**; the stored audit text is
  untouched and still quoted verbatim in the record header.
- **Realtime is proved across two isolated browser contexts** with a real
  WebSocket - see the section below for exactly what that does and does not
  cover.

**No migration in this slice.** Everything needed was already on the hosted
project: `attendance_totals()` already returns exact `numeric` seconds summed
server-side, `vehicle_movements` already carries `departed_by`/`returned_by`,
and `operational_audit` already records `movement_id` on both vehicle events.
The defect was entirely in what the client did with those rows.

### The Realtime evidence, and its limits

`e2e/realtime-acceptance.spec.ts` drives two `browser.newContext()` contexts -
separate storage, separate sessions, one COMMANDER and one FIREFIGHTER - against
one shared mutable store with a real Realtime WebSocket
(`e2e/live-project.ts`, via `context.routeWebSocket`). Both screens are open
before any mutation and neither is navigated or refreshed.

It proves: the fifteen steps of a call-out arrive on the other screen by
themselves; a change made while the socket is cut still arrives; a payload
pushed down a member's own socket for a row they may not read never reaches the
screen; one screen opens exactly one channel.

It does **not** prove, and nothing here claims: the hosted Supabase project
itself (CI holds no credentials for it and must not), or two physical devices on
different networks. Both are an owner checklist in `docs/DEMO_RUNBOOK.md`
section 8a.

---

## Previous slice: presentation stabilisation

**Presentation stabilisation.** Ten reported problems from the physical device
test of 13 September, fixed on branch `claude/dvd-tivat-app-dev-n8wctb`
(PR #23). Full detail is in `docs/ai/WORK_LOG.md`; the headlines:

- **The resume "reload" was a silent REMOUNT**, not a document reload. Fixed at
  the source with `sameAccess()` in `src/auth/access.ts`, so the provider hands
  out the same object when the content has not changed.
- **A withdrawn member was still callable.** Confirmed on the hosted project by
  preflight: one member linked to an account who could not have received a
  call-out. `is_eligible_recipient()` now decides, by the same conditions
  `current_dvd_role()` applies.
- **An archive row labelled "Zatvoreno" showed the publication time.** Each
  state uses the column that means it, or says `Nije zabiljezeno`.
- **Times are Europe/Podgorica**, not the reading device's zone, and carry the
  year.
- **The chronology was never being overwritten.** `operational_audit` had
  recorded everything since the schema was written - 34 rows on the hosted
  project - and simply had no reader. `intervention_audit()` is that reader.
- **Live updates** through Realtime with foreground polling as the fallback,
  and the screen says which is in use. The manual refresh button stays.
- **Layout is now measured**, not eyeballed: `e2e/viewport.spec.ts` checks
  overflow, clipped text, unreachable columns and touch targets at eight widths.
- **Sign-in tells "could not reach the server" apart from "refused"**, which
  leaks nothing because the request never arrived to be judged.
- **Navigation offers each role only what it can use**, and hiding a
  destination is not what keeps anybody out - a test asserts the gate and the
  server still refuse.
- **The reported duplicate title was NOT reproduced** as a field-mapping
  defect. Tested with deliberately different values on all three screens; the
  duplication is the ordinary list-and-detail shape and is pinned at exactly
  two occurrences.

**Metric definitions now live in `docs/METRICS.md`** - what every number on a
screen means, which two events each duration sits between, and what no number
here ever means.

### Migrations in this slice

All four are **additive**. None drops, alters a column, or removes an intended
privilege.

| Migration | What it does |
|---|---|
| `202609150008` | `is_eligible_recipient`, `eligible_recipients`, a replaced `publish_intervention` body (identical signature), a member read policy on `operational_audit` |
| `202609150009` | Publishes eight operational tables to `supabase_realtime`; a no-op where the publication is absent or the role may not alter it |
| `202609150010` | `intervention_audit()` - the chronology reader, with each actor resolved to a display name |
| `202609150011` | Revokes an unintended EXECUTE grant on the `rls_auto_enable()` event trigger function; guarded, since it does not exist outside the hosted platform |

**Applied to the hosted project on 2026-09-13 after preflight.** Postflight
confirmed three functions present, two policies on `operational_audit`, eight
tables published, `anon` holding execute on none of the new functions, and one
member correctly excluded from the callable list.

### Verification on the branch head

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` (unit) | **302 passed** |
| `npm run test:db` (PostgreSQL 16 + RLS) | **359 passed**, 12 skipped |
| `npm run e2e` (browser + axe, 2 projects) | see the PR; run on the final head |

The 12 skipped database tests are `hosted_operations.test.ts`, which needs
credentials CI deliberately does not have. **A skipped test is not evidence and
that file must never be offered as CI evidence.**

---

## Previous slice: 3b - the real operational screens

**Merged** as PR #20 on
2026-09-13 into `main` `a60483aede73a0f7e18dc69cbaf9d342b930c241` - a normal
merge commit, parents `0f1cace7` (previous `main`) and `7def9425` (the reviewed
head), its tree byte-identical to that head. CI was green on `7def9425` before
the merge.

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
| `podesavanja` (Podesavanja) | **This device.** Language, this device's notification opt-in, and the way through to the prototype screens. No server, and deliberately no role check: the person most in need of a refusal message they can read is the one who has been refused |
| `clanovi` (Clanovi) | Device-local **fictional** roster with the actor selector. Easy to confuse with `evidencija` and must not be: this one edits invented demonstration data and touches no server record |
| `dezurni`, `clan`, `vozila`, `prikaz`, `istorija` | Device-local fictional state and the actor selector. Each carries a banner saying so |
| `dojava` | Abandoned research, local only |

The navigation is two groups named for the task: **Rad** (`poziv`,
`mobilizacija`, `arhiva`) and **Drustvo** (`evidencija`, `nalozi`,
`podesavanja`). **No simulation is in the rail at all** - every prototype screen
is reached from Settings, behind a closed disclosure, because a group label is
not a separation. `dojava` is not offered even there.

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

A project exists and **migrations 001-011 are applied to it**. The first
seven were verified by a structural fingerprint matching a local PostgreSQL 16
built from the same files; the four added on 2026-09-13 were applied after a
preflight that confirmed each was additive, and verified by a postflight query.
Recorded here so nobody has to rediscover it:

| Fact | Value |
|---|---|
| Project | `dvd-tivat-app`, ref `yskhdzrdbywrpfowckpn`, **`eu-west-1`** (the docs said `eu-central-1`; the Management API reports `eu-west-1`, so the documented value was wrong) |
| PostgreSQL | 17 (the tests run against 16 locally and in CI) |
| State before | `public` schema completely empty — no migration had ever run |
| **Applied** | All eleven. `202609120005` and `202609130006` on 2026-09-12 with the owner's conditional authorisation, after a non-destructive preflight; `202609140007` on 2026-09-13; `202609150008`, `202609150009`, `202609150010` and `202609150011` on 2026-09-13, all additive, after the preflight recorded in `WORK_LOG.md` |
| **Realtime** | Eight operational tables are in the `supabase_realtime` publication, so live updates use the subscription path rather than only the polling fallback |
| **Verified** | Structural fingerprint matches a local PostgreSQL 16 built from the same files — **all seven sections identical**, functions `ee2886b99683c44f00216a7e84e7b0dd`, 46 functions |
| Verified | See [DATABASE.md §3](../DATABASE.md#3-the-real-supabase-project) |
| **Contents** | Eight fictional accounts, seven fictional members, two groups, three vehicles. No interventions between demonstrations. Every address is on the reserved `.invalid` domain and cannot receive mail. Passwords are **not** in this repository |
| Publishable key | Safe in the client bundle by design; it is **not** a secret |
| Secret key | Must exist only as a GitHub Actions secret or a git-ignored `.env.local`. Never in a tracked file, never in the bundle, never in a transcript |
| Web Push 012 | Present only on the active implementation branch. Not yet applied, deployed or physically verified on the hosted project |

### The published copy, confirmed 2026-09-13

`https://dado211207.github.io/dvd-tivat-app/` serves the presentation build
following historical merge checkpoint `7fa8ec3` (PR #25). Web Push changes on
the active branch are not part of that public build yet.

Checked by fetching the live files, not by trusting the workflow's own report:

| Check | Result |
|---|---|
| Index | 200, and its entry bundle hash changed from the previous deployment |
| `sb_secret_`, `service_role`, `SUPABASE_SECRET`, a JWT header | **0 occurrences** in every served file checked |
| Project URL in the bundle | present, so the published copy is pointed at the project rather than unconfigured |
| `Europe/Podgorica`, `Nije zabiljezeno`, the unreachable-server sentence | present in the entry bundle |
| `safe-area-inset-top`, `table--cards`, `live-dot` | present in the stylesheet |
| `eligible_recipients`, `intervention_audit` | present in `OperationalGate-*.js` |
| the twelve-second polling wording | present in `live-*.js` |

**The last two took two wrong turns worth recording**, because both are easy
traps. The data layer and the live-update hook are in their own code-split
chunks, not in the entry bundle, so grepping the entry alone made the new work
look absent. And the "compare against a local build" check that was supposed to
settle it was run against a **stale local `main`** that still pointed at the
pre-merge commit, so it confirmed the wrong thing. Neither was a deployment
fault; both were measurement faults.

**CI does not and must not reach this project.** That would need a secret in CI.
The local PostgreSQL suite is the authoritative automated evidence; no claim here
says the hosted project itself was tested by CI.

## Known limitations (accurate, not aspirational)

- Identity, roster, intervention, response, movement, attendance, vehicle and
  archive paths all use the hosted schema on the operational screens. The older
  simulation routes remain separate and explicitly labelled.
- Real sign-up through the app's own registration form, with a real deliverable
  email, has not yet been exercised end-to-end — every verification so far either
  used privileged SQL to create accounts directly, or the app's internal modules
  driven by a test harness, never a human clicking through the actual sign-up UI.
  Close this the first time a real registration flow is built or manually
  exercised, before any real DVD Tivat member is invited.
- Password recovery by emailed one-time code is implemented behind
  `VITE_PASSWORD_RESET_ENABLED`. Keep it disabled until SMTP, the recovery
  template and the hosted acceptance in `docs/ACCOUNT_RECOVERY.md` pass.
- Web Push source is implemented but is not operational until migration 012,
  the Edge Function, server-only secrets, public VAPID build variable and
  scheduler are configured and the locked-device matrix passes. There is no
  SMS, email, Viber or automatic call.
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
- A browser or service-worker test is **no evidence** that a locked Android or
  iPhone raised an alarm. Record physical arrival, latency and actual sound
  separately on both platforms.
- ~~The PWA itself is not built.~~ **Resolved 2026-09-13:** manifest, icons,
  installable standalone shell, a service worker that caches only the shell and
  never a server answer, honest offline and update states, and a GitHub Pages
  workflow. **Still no native application**. Web Push adds one public repository
  variable plus server-only secrets — see docs/DEMO_RUNBOOK.md §3.1.
- **No offline queue.** An action taken with no signal is refused and not
  stored; the interface says so rather than pretending it was saved.
- **No guaranteed siren.** Web Push requests high urgency and a vibration
  pattern where supported, but a PWA cannot override silent mode, Focus, battery
  policy or platform delivery. Provider acceptance is not member acknowledgement.

## Blockers needing an owner decision

| # | Blocker | State |
|---|---|---|
| B1 | Supabase project | **Resolved for migrations 001-011.** Migration 012 is new Web Push work and is not yet claimed as hosted or fingerprint-verified |
| B2 | Email verification | **Decided:** "Confirm email" is to be turned **off** in the Supabase dashboard for now, so an account is usable immediately. **Whether it actually is off is unresolved** — two conflicting observations are recorded under Owner action items. An SMTP provider is still needed before real registration at scale: Supabase's default sender only reaches project-team addresses and is rate-limited |
| B3 | Notification transport | **Implementation complete on the active branch, deployment and device acceptance open.** PWA Web Push is server-sent from an Edge Function, opt-in per device, privacy-safe on the lock screen, bounded to one unacknowledged repeat and re-checks access immediately before send. It still cannot be called reliable or alarm-grade until the hosted setup and iPhone/Android locked-screen matrix pass |
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
2. ~~Confirm the "Confirm email" setting.~~ **Answered 13 September 2026.**
   `GET /auth/v1/settings` on the hosted project reports `mailer_autoconfirm:
   true` - confirmation **OFF**, matching the B2 decision. The 11 September
   reading of `false` and the 12 September report of `true` are resolved in
   favour of the later one; the setting was most likely changed between them.
   The same read shows `email` as the only provider and `disable_signup: false`.

   Two things follow. The recovery flow uses a code entered in the application,
   so it does not depend on a redirect or Site URL allowlist entry;
   `detectSessionInUrl` remains off. And **open registration is on**, so anyone who finds a public
   deployment can create an account - they get no role and see nothing, but the
   accounts accumulate, which is why turning sign-up off is on the
   post-presentation cleanup list.

## Next concrete action

Identity, access, the society's records **and the incident path** are done. The
commander publishes, the firefighter answers and attends, the commander
confirms, the archive shows the record - all against the real database, verified
live.

What is left, in order:

1. ~~Open the slice 3b pull request and merge it on green CI.~~ **Done — PR #20
   merged normally on 2026-09-13.** So is PR #23, the presentation-stabilisation
   slice, merged normally the same day with CI green on its exact head.
2. ~~Set the original two repository variables.~~ **Done by the owner on 2026-09-13.**
   The public URL serves a build pointed at the hosted project, confirmed by
   fetching it: `https://dado211207.github.io/dvd-tivat-app/` returns 200, its
   bundle carries the project URL, and it contains no secret key. The earlier
   note that this could not be done from an agent session stands as a record of
   why it had to wait for the owner - `gh` is absent and this environment's
   egress proxy refuses the GitHub Actions configuration paths with 403 while
   permitting `/actions/runs`.
3. **Rehearse the journey in docs/DEMO_RUNBOOK.md §5** on the devices that will
   be used, from two browser profiles.
4. **Run the two-device Realtime acceptance in `docs/DEMO_RUNBOOK.md` §8a.**
   This is the one check nobody but the owner can make, and it is the only
   remaining item the automated suite deliberately does not claim: the hosted
   project itself (CI holds no credentials for it), and two physical devices on
   different networks, where a mobile radio or a corporate proxy blocking
   WebSockets would show up. Record which of *Uzivo* or *Osvjezavanje na svakih
   12 sekundi* the status line showed, and on which network.
5. Finish Web Push (**B3**): green database/browser CI, reviewed merge, hosted
   migration and Edge Function, server-only secrets, public VAPID build variable,
   protected scheduler, Pages deployment and the locked-device acceptance in
   the runbook. The source implementation is not the hosted proof.

Not blocking the demonstration, and worth doing after it:

- An offline queue, so an action taken with no signal is stored and sent rather
  than refused.
- Decide what finally happens to the simulated `clanovi`, `dezurni`, `clan`,
  `vozila` and `istorija` screens. They are no longer OFFERED - each duplicates
  a screen that is now server-backed, and a commander running a call-out on one
  by accident would find nothing on the server afterwards - but the routes and
  the code are still there, listed in `ROUTES_NOT_OFFERED` in `src/App.tsx`.
  Deleting them is an owner decision, not a tidy-up: they were the safety net
  while the real screens were being built. `prikaz` is still offered, because
  the station display has no server-backed equivalent yet.
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

**B1 is resolved for migrations 001-011** — the project exists and
identity, access, the roster and the whole operational journey have been
exercised against it through the application's own data layer.

Since 2026-09-13 the project also holds a **fictional demonstration cast**:
eight accounts covering every role and state, seven members, two groups and
three vehicles. There are no interventions between demonstrations. Every
address is on the reserved `.invalid` domain, which cannot receive mail, and no
password is in this repository.
