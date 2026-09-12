# Work log

Newest entry first. One entry per unit of work, written in the same commit as the work itself.
Record what was done, what was verified, and what the next concrete action is.

---

## 2026-09-12 - Slice 3b-0: a self-declared claim was already counting as participation

**The defect, found by reading the code rather than the documentation.** DATABASE.md called attendance
"the primary capability" and the nine-facts contract promised that "a member **actually attended**" was
its own separate record. It was not. Three facts, each verified in the migration source:

1. `attendance_check_in(intervention)` with no target member required only `is_dvd_staff()`, so a
   FIREFIGHTER created their own interval (`202609090002:894`).
2. The row landed `verified = false`, which *looked* like a safeguard (`:487`).
3. **`attendance_totals()` never filtered on `verified`** (`:536`). It summed every closed interval.

So self-declared presence flowed straight into participation totals. And `verified = true` was set in
exactly one place - inside `attendance_correct()` (`:994`) - as a **side effect of a commander
correcting the times**. Confirmation was not a decision anybody made; it was something that happened
to a record when somebody fixed its clock. Nothing read the column at all.

The owner's recorded rule for slice 3 - "`ON_SCENE` may create an **unverified** interval; it must
never write verified attendance" - was therefore already violated, before journey progress existed to
violate it.

**The single test touching `verified` asserted the defect.** It expected `verified: true` after a
correction. That assertion has been replaced with its opposite, and the commit says so plainly: this
is not weakening a test to get green, it is removing a test that pinned a bug.

**The design chosen**, of the two the owner offered: **intervals with an explicit `source` and a
three-state confirmation**, not a separate claims table. The claims table would have had to duplicate
the cross-intervention overlap exclusion constraint, which is the hard part and already correct, and
would have left history and CSV unioning two tables. `source` and confirmation are independent: a
commander recording somebody else is `COMMAND_RECORDED` and **still unconfirmed**, because "I wrote it
down" and "I stand behind it" are different claims by the same person.

`source` is decided inside the command from `auth.uid()` and is deliberately **not a parameter** - a
client must not be able to label its own claim as command-recorded. Tested by passing your own member
id explicitly and getting `SELF_DECLARED` anyway.

**Rejection needs a reason; confirmation does not.** Rejecting overrides what a member said about
their own presence and has to be explainable. Confirmation is the expected outcome, and demanding
boilerplate from a commander working through thirty records after an incident would produce thirty
meaningless strings. Both are audited with actor and server time regardless.

**Two more write gaps, the same shape as slice 3a's.** `intervention_acknowledgements` and
`vehicle_movements` have both existed since `202609090002` with a table, constraints, RLS and a read
policy - and **no write path at all**. "Opened" was unrecordable, which is exactly the distinction a
commander needs (somebody who has not opened the call-out is a different problem from somebody who
opened it and has not answered). Both now have commands. Acknowledging is idempotent and never moves
the first-seen timestamp, because "when did they see it" must stay answerable.

**Also corrected while here:** the nine-facts list is now ten, since fact 7 split into "says they
attended" and "command stands behind it". Four stale "nine facts" references were updated across
ACCESS_MODEL.md, DATABASE.md, the new migration and the new test; two remaining mentions are
deliberately historical.

**A second defect, found by generating the test cases instead of choosing them.** Revalidating the
authority model produced `db-tests/authority_matrix.test.ts`: eleven commands x ten account states,
110 declared cells. 96 of the first hundred matched the intended model. Four did not, and they shared
one cause.

`current_member_id()` (`202609090002:289`) read `members.active` - whether the SOCIETY still counts
the person - and never `current_dvd_role()` - whether the ACCOUNT still has standing. So **member
identity survived the loss of authority.** A SUSPENDED, PENDING or incomplete-profile account whose
linked member sat on an intervention's recipient list could read through seven policies
(`interventions`, `intervention_updates`, `intervention_recipients`, `intervention_responses`,
`intervention_acknowledgements`, `attendance_intervals`, `notification_outbox`), **answer a
call-out** through `submit_response`, close its own interval through `attendance_check_out`, and - new
in this slice - acknowledge an intervention. The matrix reported a suspended account reading 51
attendance intervals and 82 interventions.

This is live on the hosted project, not only on this branch. It is not reachable through the
application - no screen reads any of it from the server - so it is a schema defect rather than an
exposure. It is fixed now because the member-facing screen is the next slice and it directly
contradicts what this project documents about suspension.

Fixed at the root: one added condition in `current_member_id()`, and every consumer - seven policies
and three commands - tightens with it. `acknowledge_intervention`, `attendance_check_in` and
`attendance_check_out` additionally check `is_dvd_staff()` FIRST, so a withdrawn account is refused
with `STAFF_REQUIRED` rather than `MEMBER_RECORD_REQUIRED`, which would be untrue - they have a
member record, they have lost standing to use it.

**`submit_response` was deliberately left alone**, and the first attempt at it is worth recording as
a warning. I re-created it to add the same staff check and wrote the body from memory rather than
copying the original: wrong signature, wrong return type, two wrong table names, one wrong column
name, a dropped no-op-on-unchanged-answer branch, and an error code changed from `ETA_REQUIRED` to
`INVALID_ETA`. Caught by diffing my version against the real one before running anything. Since the
root fix already closes the hole there and only the message is imperfect, the whole block was
removed. A seventy-line merged function is not worth re-creating to improve one error string.

**Nine mutations, each from a byte-identical pristine copy, each restored and re-verified afterwards
(`sha256sum -c` after every one):** removing the `verified` filter from totals fails 3; forcing every
interval `COMMAND_RECORDED` fails 3; dropping `revoke ... from public` fails 10 (was 4 - the matrix's
anonymous cells detect it independently now); reverting the `current_member_id` fix fails 3, each
from a different angle; removing the staff gate from `acknowledge_intervention` fails 3, on the
message rather than on access, which is the defence-in-depth story working; from `attendance_check_in`
fails 6; from `attendance_check_out` fails 3; putting `verified = true` back in `attendance_correct`
fails 2; and **over-tightening** - making `current_member_id()` always NULL - fails 60, which is the
check that the fix does not simply deny everything.

**Mutation testing found a gap in my own work.** The staff gate added to `attendance_check_out` could
be deleted with all 267 tests still passing, because that command was not one of the nine and so had
no row in the matrix. It has one now, and removing the gate fails 3. A line of authority code with no
failing test behind it is a claim, not a safeguard.

**One thing deliberately not changed, because it is the owner's call.** `ADMIN` has held full command
authority since `202609090002`, while the role table implied administrators only manage records - the
separation of duties runs one way only. Documented and pinned by the matrix rather than altered: in a
52-member society the administrator is probably also an officer, and refusing them a call-out at
03:00 to honour a textbook rule is the worse failure. Recorded in PROJECT_STATE.md as a decision to
take.

**Verified.** Lint, strict typecheck, `vite build` and the bundle secret scan pass. Unit **128
passed** (unchanged - this slice adds no client code). Database **277 passed**, up from 135 on `main`:
+25 for attendance truth, +110 for the authority matrix, +7 for the identity fix and the states it
covers. Browser and accessibility **74 passed**, run with `.env.local` moved aside as CI does and
restored byte-identically.

Checked against deliberately broken code, not only working code - the full mutation battery is
recorded further down this entry.

**Not applied anywhere.** `202609130006` is local and CI evidence only. The hosted project is two
migrations behind this branch, one behind `main`, and **still carries this defect** - nothing reads it
there yet, because no screen uses attendance against the server, but that is the reason to apply it
rather than leave it pending.

**`202609130006` is not purely additive, and the first version of this entry should have said so.**
It drops and recreates `public.attendance_totals(timestamptz, timestamptz)` with different result
columns, because `create or replace function` cannot change a function's output contract. That makes
it a **breaking replacement of a callable interface**, additive only in its table and column changes.
No consumer calls it today - no application module, no view, no other function - which is why the
replacement is safe *now* and would not be later. The order `202609120005` then `202609130006` is
required, the execute grant has to be re-issued after the recreate, and
[DATABASE.md](../DATABASE.md) §1 carries the preflight checks, the post-migration verification and the
forward-fix path if `...0006` fails after `...0005` has already applied.

**PR #17 merged first, as recommended, then merged into this branch.** #17's own commits keep their
authorship; the overlapping documentation was resolved by hand, keeping both sides. Conflicts were in
`docs/ai/PROJECT_STATE.md` (six hunks) and `docs/ai/WORK_LOG.md` (one hunk, this entry against #17's);
`docs/DATABASE.md` auto-merged.

**Next concrete action:** slice 3b proper - availability, journey progress, and the real commander and
firefighter screens, including the batch-confirmation requirement now recorded in PROJECT_STATE.md.
Merging PR #18 and applying either migration to the hosted project each need separate owner
authorisation and neither has it.

---

## 2026-09-12 - Post-merge documentation synchronization

**Done**

- PR #16 was marked ready and merged normally with explicit owner authorisation.
  Merge commit: `55fdb093e65692ddcb430f1f3383ce329944bb0a`; comparison to live `main`
  returned identical at the checkpoint.
- Re-read the repository-facing continuation documents after the merge. Updated
  `README.md`, `OWNER_BOOTSTRAP.md`, `DATABASE.md` and `PROJECT_STATE.md` so
  they distinguish merged code, hosted activation and fictional prototype screens.
- Kept the email-confirmation decision separate from the unresolved hosted
  dashboard setting.

**Boundary**

- No application code, test, migration or schema changed.
- Migration `202609120005` is still not applied to the hosted project. This
  workspace has no authenticated Supabase dashboard/CLI access, so no honest
  hosted smoke test can be claimed.
- Slice 3b has not started.

**Next concrete action**

Review and merge this documentation-only synchronization after CI. Then, with
separate owner authorisation and authenticated Supabase access, apply migration
`202609120005` and smoke-check `Evidencija drustva` with disposable data before
starting Slice 3b.

*Recorded afterwards, so this historical entry is not read as current: the merge
named above happened later the same day as PR #17, merge commit `7d00d9bb`. The
hosted migration and the smoke test are still outstanding and still need
separate owner authorisation. Slice 3b-0 had already started on its own branch
by the time this entry was merged, so the entry's "Slice 3b has not started"
was true when written and is not true now.*

---

## 2026-09-12 - Slice 3a: the write paths the response system never had

**The gap, found by reading the schema instead of the brief.** `202609090002` built a complete
mobilisation system - publish, receive, respond, record attendance - and no way to create anything.
`publish_intervention(target_intervention, recipient_member_ids)` takes an intervention that must
ALREADY exist in `DRAFT`, and nothing in the database could produce one. `members`, `groups`,
`group_members` and `vehicles` had no write path at all. The whole schema was reachable only by
privileged SQL.

**Why a hundred passing tests did not notice.** `db-tests/harness.ts` inserted drafts directly as the
SUPERUSER, outside `asUser`. The helper held a privilege no commander in the application has ever
held, so the missing function was invisible. `createDraft` now goes through
`create_intervention_draft`, which makes every intervention scenario in the suite depend on the
authority check, the validation and the grants being right. The one test that needed the old
behaviour - the unique index refusing a duplicate idempotency key - was **split rather than deleted**:
it had conflated "the command is idempotent" with "the constraint is the backstop", and both are now
asserted separately by their own test.

**The same privilege defect, caught on the first run.** `organisation_audit` was created holding
`INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` for `authenticated`, because a Supabase project's default
privileges grant them to every new table and the migration initially only *added* `select` on top -
the identical mistake `202609110003` exists to correct. *"never grants a client role a privilege with
no policy behind it"* failed immediately. The stub reproducing the platform's default grants is the
only reason that was visible locally rather than on the owner's project.

**Two other defects found while building, both mine.** A parameter named `idempotency_key` is
ambiguous against the column of the same name inside the function body, which is exactly why every
other parameter in this schema carries a `requested_` prefix. And `max(uuid)` does not exist - the
one-query existence-and-value trick was wrong, and plpgsql's `FOUND` is the right mechanism, because
`user_id` is legitimately NULL for a member with no account and the value cannot distinguish "no such
member" from "member not linked".

**Administrative authority now has a predicate.** `ACCESS_MODEL.md` has said since PR #13 that an
ADMIN maintains organisational records while a COMMANDER runs call-outs. That distinction existed
only in prose. `is_dvd_admin()` is now the predicate, and a COMMANDER is refused every roster command
with `ADMIN_REQUIRED` as firmly as a firefighter is.

**The link that makes the system reachable.** `members.user_id` is what `current_member_id()` reads,
and nothing could write it - so every approved account resolved to no member and `submit_response`
would have refused all of them with `MEMBER_RECORD_REQUIRED`. `admin_link_member_account` closes
that, reports its two one-to-one collisions differently (a member who already has an account needs a
different correction from an account already given to somebody else), and confers no authority:
authority is read from `access_grants` and nowhere else, which is its own test.

**Nothing is deleted.** Members, groups and vehicles deactivate with a recorded reason; a discarded
draft becomes `CANCELLED`. A member who left in 2024 must still resolve on the attendance record of
an intervention they attended in 2023.

**Verified.** Lint, typecheck, `vite build` and the bundle secret scan pass. Unit **128 passed**
(was 117). Database **135 passed** (was 101). Browser and accessibility **74 passed** (was 70).
Checked against deliberately broken code, not only working code: granting a firefighter admin
authority fails 3 tests, dropping the new table's revoke fails 3, and taking the coordinate capture
time from the caller instead of the server fails 1.

**One test was quietly under-covering.** `navigation.spec.ts` hardcoded eight route names, so it
passed while never visiting the ninth. It now enumerates the rendered navigation, with an explicit
assertion on the expected set so adding a route stays deliberate.

**Environment note, not a code finding.** Four `admin.spec.ts` tests fail on a machine that has a
real `.env.local`, because they assert the "server not configured" screen that CI deliberately gets.
Confirmed environmental by running the suite with the file moved aside - all pass - and restoring it
byte-identically. Worth knowing before somebody treats it as a regression.

**Next concrete action:** slice 3b - general availability (three states, audited like account status)
and the member response flow on real data, including the progress column decided alongside the
existing answer vocabulary.

### Correction, same day: the state file contradicted the slice it shipped in

An independent review of PR #16's exact head found `docs/ai/PROJECT_STATE.md` internally stale, and
it was right on every point. Verified against the file rather than taken on trust, then fixed:

| Stale claim | Reality |
|---|---|
| `Last updated: 2026-09-11`, and the same date on the PR section heading | 2026-09-12 |
| ``main`` = `bd79f7f` (the PR #14 merge) | `dc3aade`, the PR #15 merge |
| PR table ended at #14 | #15 merged, #16 open as Draft |
| "No owner/admin write commands for members, groups and vehicles yet" | **This PR adds them** |
| "no PWA decision made" | C1 decided PWA-only; the PWA itself is still unbuilt |
| "Only identity and access use the schema" | The society's records now do too |
| Next-action items 1 and 2 | Both completed by this slice |
| B3 "Open ... PWA Web Push vs native must be investigated" | Decided (C1/C8) and now active slice-3d work |

**The worst one was "no owner/admin write commands ... yet" sitting inside the diff that adds them.**
When the Slice 3 section was added, the rest of the file was not swept for claims the slice had just
invalidated. That is the same failure as the stale `main` SHA corrected in PR #15, and the lesson
from that one was not generalised: **updating this file means re-reading all of it, not appending to
it.** A state file that contradicts its own commit is worse than no state file, because the next
agent trusts it.

**Two things were deliberately NOT marked resolved**, because they concern a private hosted project
this repository cannot reach and "reported done" is not "verified done":

- **Secret rotation** is reported by the owner as complete. It stays on the action list until the
  owner confirms it directly. Removing an undone item would leave a possibly-exposed key rotated only
  in a document; leaving a done one costs a moment.
- **"Confirm email"** has two conflicting observations now recorded side by side with their dates and
  provenance: read directly from `GET /auth/v1/settings` on 11 September as `mailer_autoconfirm:
  false` (confirmation ON), and reported on 12 September as `true` (OFF). It may simply have been
  changed between them. Neither was picked over the other.

**One claim of mine was downgraded.** That iOS Web Push ignores application-controlled sound and
`vibrate` was asserted from general knowledge, not read from Apple or W3C documentation and not
observed on a device. It is now recorded as needing confirmation before anything is promised about
how a call-out gets noticed - which is exactly the kind of claim that must not be taken on trust,
since a push that does not wake somebody is the failure this application exists to prevent.

Documentation only: no source file, migration, test or schema object changed.

### Second correction, same day: the first correction was not a full reread

A second independent reread found six more inconsistencies. The first correction had fixed the
items it was pointed at and had **not** re-read the whole file - which is the exact failure it
claimed to have learned from, one commit earlier. Recording that plainly, because the pattern is
now three deep: PR #15 fixed a stale SHA, `e7df6fc` fixed what that missed, and this fixes what
`e7df6fc` missed.

| Found | Fix |
|---|---|
| The PR table called `cb074eb` the current head of #16, citing the superseded CI run - a self-referential stale SHA created *by* the correction commit | The table now names `cb074eb` and `e7df6fc` as checkpoints and sends readers to PR #16 for the live head, with a note saying why a moving reference must never be written here |
| B3 still asserted iOS ignores sound and `vibrate` as established fact, contradicting the downgraded paragraph directly above it | Every platform claim in B3 is now marked UNVERIFIED pending Apple/W3C evidence and a device test |
| The slice-2 verification table said 116 unit tests | **117.** Verified by checking out PR #14's head `35383a5` in a throwaway worktree and running the suite: `Tests 117 passed (117)` |
| "Which screens are real" omitted `evidencija` | Added, and `clanovi` split onto its own row saying plainly that it is the fictional roster and must not be confused with the real one |
| The repository map stopped at `202609110004` | Added `202609120005`, `src/auth/roster.ts`, `src/ui/views/OrganisationView.tsx` and `db-tests/organisation.test.ts` with their actual roles |
| The PR #13 and #14 paragraphs said in the present tense that `main` is byte-identical to those heads | Both rewritten as checkpoint statements, with an explicit line that current `main` contains PR #15 and matches neither |

**Four more found by reading the whole file rather than only the listed items:**

- "All four migrations applied to the live project" read as *all* migrations now that a fifth
  exists. Scoped to that slice's four, in three places, plus a **Not applied** row in the live-project
  table so a scanner cannot miss it.
- "email confirmation is expected to be off" contradicted the unresolved conflict recorded two
  sections below. Now says unresolved, and B2 says so too.
- "Identity and access are done" understated what slice 3a did and misdescribed what remains.
- The manual checklist told the owner to confirm "Confirm email" is off - assuming the answer to
  the very question that is open. It now says to **read** it and write down whichever it is.

**The lesson, stated so it is not learned a fourth time:** this file is read top to bottom by whoever
resumes, so it must be edited top to bottom. Fixing named items is not the same as making the file
true.

Documentation only: no source file, migration, test or schema object changed.

### Third correction: the same drift in ACCESS_MODEL.md and DATABASE.md

`PROJECT_STATE.md` was made coherent while the two documents it links to were not. Both were read
completely and compared against `PROJECT_STATE.md` at `fe37529`, `202609120005`, `db-tests/harness.ts`,
`db-tests/organisation.test.ts` and the live PR state.

**The single most misleading claim, in both files, was the same one:** that the roster screen *runs
against the real project*. It does not. `202609120005` is not applied to the hosted project, so every
command that screen issues would fail there with `function ... does not exist`. Code proven against
local PostgreSQL and CI is not code proven against the target. Both documents now separate
**implemented and tested** from **usable on the hosted project** in a table, because a sentence
carrying both meanings is how this got recorded wrongly in the first place.

`ACCESS_MODEL.md`:

- §8 roster claim split into the two-column table above.
- §8 email confirmation: the **decision** (B2: off) is now separated from the **current setting**
  (unverified: `false` observed 11 September, `true` reported 12 September). The claim that
  registration immediately yields a usable session is gone — it depends on a dashboard setting nobody
  has read and a sign-up flow nobody has exercised.
- §4's enumerated list of enforced refusals was missing the whole authority boundary this slice
  added. A COMMANDER being refused `ADMIN_REQUIRED` on roster commands was described in §5 but absent
  from the list that claims to be the enforced set; added, along with the firefighter draft refusal
  and anon's refusal on the new commands.
- §8 draft bullet now says the migration defining those commands is not on the hosted project either.

`DATABASE.md`:

- §1 clean-database sequence was missing `202609120005`, which the harness does apply — so the
  document described a four-migration run that has not happened since the migration was added. Added,
  with a note to keep it in step with `db-tests/harness.ts`.
- §2 "the last two exist because of a defect only a real project could reveal" became wrong the moment
  a fifth migration existed. Names `202609110003` and `202609110004` explicitly, and says what
  `202609120005` is instead.
- §3 "All four migrations have been applied" replaced by a per-migration table, plus a plain statement
  that the hosted schema is **behind this branch**.
- §3 fingerprint claim scoped: that byte-for-byte comparison covers `...0001`–`...0004`, was taken
  before `202609120005` existed, and is **not** evidence that the hosted project matches this branch.
- §10 said there are no owner/admin write commands and the roster lives in browser state. Both false.
  Rewritten as a boundary: built and tested on this branch / not on the hosted project / genuinely not
  built — and naming the `Clanovi` prototype screen as the one that *is* still fictional browser
  state, since two screens now show members and only one touches the database.

**Three found beyond the listed defects:** §5 described the intervention lifecycle without mentioning
that drafts can now be created, edited and discarded by command — the very gap this slice closed;
the `idempotency_key` note covered only publish, not the draft command that now honours the same key;
and §1 credited the platform stub with catching one defect when it has now caught two, the second
being the identical mistake repeated on `organisation_audit`.

Documentation only: no source file, test, migration or schema object changed. `202609120005` remains
unapplied to the hosted project, and slice 3b has not started.

---

## 2026-09-11 - Real accounts: the simulated actor stops moving access

**The defect this slice existed to fix.** `AccountAccessSetup` switched to a local `READY` step the
moment `signInWithPassword` resolved. That proved one thing - a password was correct - and was then
treated as though it proved three more: that the account was approved, that its profile was
finished, and that it had not been suspended. Separately, the account directory (the most sensitive
screen in the application) was unlocked by choosing "administrator" in the actor selector, which made
it the easiest screen to reach rather than the hardest.

**Configuration.** Two public build-time values, read in one module. `.env.example` keeps
placeholders only - the standing instruction is to use placeholder configuration values, and putting
the real project URL in a public repository would lower the bar to creating accounts on it for no
benefit, since the owner copies them from the dashboard anyway. Real values live in a git-ignored
`.env.local`. `VITE_SUPABASE_ANON_KEY` was renamed to `VITE_SUPABASE_PUBLISHABLE_KEY` so the name
says what the value is.

**The access snapshot.** `src/auth/access.ts` is pure and takes an injected gateway: it reads the
profile row, `current_dvd_role()` and `current_account_status()` and produces one value. Two rules
in it are worth naming, because both are the kind of thing that is easy to get backwards:

- An unreachable server is `UNAVAILABLE`, never a signed-in state with a null role. "We could not
  ask" must not be actionable as "you have no role" - and equally must not grant anything.
- A role string the client does not recognise is not authority. If the server grows a fifth role,
  this fails towards no access rather than towards some.

`AccessProvider` holds `LOADING` until that load returns, and reloads on every auth-state change. A
token refresh matters as much as a sign-in: it is the moment a suspension made while a tab was open
becomes visible.

**The owner directory is real.** It lists actual accounts and calls `owner_set_role` and
`owner_set_account_active`, reason mandatory, with both audit trails shown beneath. The simulated
`ADMIN` -> `OWNER` shortcut is gone.

**Non-enumerating errors.** One message for every failed credential attempt, including rate-limit
and network failures, and the same outcome whether an address was new or already registered. A
sign-in form that answers differently for a known address is a membership oracle for a volunteer
fire society. Password reset is stated as unavailable with the reason, rather than offered as a form
that would send nothing (B2).

**`docs/OWNER_BOOTSTRAP.md`, and a test that executes it.** The runbook is written for somebody who
is not a developer: what to check first, five numbered steps, what `0 rows affected` means, what the
single-owner index's rejection looks like, and how to transfer ownership without ever leaving the
system with two owners or none. `db-tests/bootstrap.test.ts` **reads the SQL out of the markdown and
runs it** against a schema built from zero. A runbook that has quietly stopped working is worse than
no runbook, because the person following it concludes the system is broken rather than the
instructions. Confirmed by breaking the document deliberately: four tests fail.

**Every other screen says it is simulated**, in a banner on itself, and the real identity control is
deliberately shaped unlike the actor selector beside it.

**Verified**

- `npm run lint`, `npm run typecheck`: pass.
- `npm run test` (unit): **116 passed**, up from 91. Includes six provider rendering tests, confirmed
  to fail against a deliberately broken guard, and the one that matters most: protected content does
  not render while the server has not yet answered.
- `npm run test:db`: **100 passed**, up from 87. The new file covers a PENDING account having zero
  access, bootstrap succeeding once and a second attempt being refused by the index, a role change
  changing what the server actually returns, and a suspension taking effect on the very next request
  with no new session involved.
- `npx vite build`: pass. `npm run verify:bundle`: pass - and confirmed it catches a planted
  `sb_secret_` key, an encoded `service_role` JWT, and refuses to pass on an empty directory.
- `npm run e2e`: **70 passed**, up from 66, including axe on the accounts screen.

**Honest limits of this slice**

- Only identity and access are connected. Interventions, responses, vehicle movements and attendance
  are still device-local fictional state.
- CI builds with no project configured, so the browser suite exercises the "not configured" states.
  The signed-in paths are covered by unit tests against a fake gateway, not by a browser against the
  live project - and a manual owner checklist is in `PROJECT_STATE.md` for what neither can reach.
- A suspended account's already-issued JWT stays syntactically valid until it expires. Every request
  is refused because the role is re-read, but the token is not revoked.

**Next concrete action**

Owner/admin write commands for `members`, `groups` and `vehicles`, then linking an account to a
member record. An intervention cannot be published to recipients who do not exist as server-side
members, so that comes before the publish flow.

---

## 2026-09-11 - PR #13 merged, the schema applied to a real project, and a privilege defect it exposed

**PR #13 merged.** A normal merge, not a squash, so the fifteen individual commits keep their own
history and authorship - including the work contributed through the `codex/*` stack (#9-#12), which
was linear in it and landed at the same time. `main` is now `3133d00` and its tree is byte-identical
to PR #13's head `110e57b`, confirmed with `git diff`. The working branch was restarted from that
`main`.

**Migrations applied to the owner's Supabase project.** The `public` schema was completely empty
beforehand - the migrations had never run there. `202609090001` and `202609090002` were applied in
order, then the two new ones below.

**Verified rather than assumed.** A structural fingerprint of the hosted schema was compared against
the same fingerprint taken from a local PostgreSQL 16 that had applied the same files: tables and
their RLS flags, every column with type, nullability and default, every constraint definition, every
index definition, every policy with its `using` and `with check` expressions, every trigger, every
table grant, and an md5 of every function body. **Every section matches byte for byte.** The single
difference is Supabase's own platform function `rls_auto_enable()`, which the local stub does not
provide. This check is what makes "the live project runs the schema the tests cover" a statement of
fact rather than of intent.

**The defect that only a real project could reveal.** A Supabase project ships with
`alter default privileges in schema public grant all on tables to anon, authenticated, service_role`.
Every table these migrations create therefore arrived on the hosted project with `INSERT`, `UPDATE`,
`DELETE` and `TRUNCATE` already granted to `authenticated`. `202609090002` revoked them from `anon`,
but for `authenticated` it only *added* `select` - on a bare PostgreSQL instance the write privileges
were never there to take, so the local suite could not see the gap and passed while proving less than
it claimed.

Consequence, established by running it rather than by reasoning about it: **row level security does
not apply to `TRUNCATE`**, so a signed-in account with no operational role at all could empty a table.
`DELETE` and `UPDATE` were still filtered to zero rows by the policies. No data was ever reachable
through the REST API, which exposes no `TRUNCATE`, and the project holds no data yet - but the access
model claimed two layers and had one.

A second, smaller finding from Supabase's own linter: `revoke all on all functions ... from anon` does
not remove PostgreSQL's default `PUBLIC` grant, so eight `security definer` helpers were callable
without signing in. They all key on `auth.uid()` and returned NULL or false, so nothing leaked - but
`docs/ACCESS_MODEL.md` said "`anon` holds nothing", and that was not true.

**Fixed, in new migrations rather than by editing applied ones:**

- `202609110003_client_role_privileges.sql` - takes every privilege back from both client roles, then
  grants `select` on all tables and `insert` on exactly the three that have an `INSERT` policy.
- `202609110004_function_execute_privileges.sql` - revokes the `PUBLIC` execute grant from the eight
  helpers and grants `execute` to `authenticated` explicitly, which policy evaluation requires.

**Fixed the test suite so it can no longer miss this.** `supabase/tests/00_supabase_stub.sql` now
reproduces Supabase's default privileges. Without that the local database was *stricter* than the
real platform. Confirmed the tests actually detect the gap: removing `202609110003` from the harness
makes four tests fail. Four new tests read the grants themselves - anon holds nothing, authenticated
holds `select` everywhere and `insert` only where a policy backs it, no function is anon-executable,
and `TRUNCATE` is refused - so a table or function added later without its own revoke fails CI.

**Verified**

- `npm run lint`, `npm run typecheck`: pass.
- `npm run test` (unit): 91 passed.
- `npm run test:db` (PostgreSQL 16 + RLS): 87 passed, up from 81.
- Supabase security advisors: anon-executable `security definer` findings went from 9 to 1, and the
  remaining one is Supabase's own `rls_auto_enable()`, not this project's.

**Not fixed, deliberately.** The advisor also reports `btree_gist` installed in the `public` schema
(WARN, `extension_in_public`). Its functions take `internal` arguments and cannot be called through
the REST API, so this is namespace hygiene rather than exposure. Remediation is recorded in
`docs/ACCESS_MODEL.md` §8: `alter extension btree_gist set schema extensions;`. Left alone for now
because moving it would make the local and hosted schemas diverge, which is the property that made
the verification above worth anything.

**Owner action items** (only the owner can do these):

1. **Rotate the Supabase secret key.** It may have been exposed earlier. Nothing built here uses it
   at runtime, so rotating it breaks nothing in this application.
2. **Turn off "Confirm email"** in the Supabase dashboard (Authentication -> Sign In / Providers).
   There is no API or MCP access to auth configuration from here.

**Next concrete action**

`.env.example` plus a git-ignored `.env.local`, then the global authentication and access state that
loads session, profile, role and status **before** any protected route renders.

---

## 2026-09-09 - Internal-operations direction, and a verified database contract

**Product direction (highest priority of the brief).** Recorded the owner's decision that DVD Tivat
is an internal mobilisation and intervention-record system and **not** a replacement for calling the
official fire service. Citizen reporting was the FIRST item in primary navigation; it is now out of
the operational groups, under an explicitly experimental heading, with a non-emergency notice and an
"abandoned research" notice on the screen itself. The wording deliberately does not invent an
emergency telephone number - that is blocker B4 for the owner.

**Base chosen and reported.** Branched from `codex/access-map-research` (`f1111d5`), the newest
coherent tree, rather than from `main`. Verified first that `main` is an ancestor of it and that the
previous branch head `35a6416` (merged as PR #1) is contained in it, so nothing was discarded and no
force-push was needed. The stack is linear: `main` -> #9 -> #10 -> #11 -> #12 -> `f1111d5`.

**The database is now real, and tested.** This was the repository's largest unverified risk: a
migration that had never been applied anywhere, with an access model that existed only on paper.

- `202609090001` left **untouched**, so a database that already applied it converges with a clean
  one. All repairs are additive in `202609090002`.
- Repaired the confirmed defects: `current_dvd_role()` now requires an **active** grant AND a
  **complete** profile AND one of the four operational roles (it previously checked none of that, so
  a suspended or half-registered account kept its privileges); added `owner_set_account_active` with
  a mandatory reason and a status audit (the owner could grant roles but never take access away);
  enforced at most three images per report; tightened the report-insert policy from "any
  authenticated user" to an active account.
- Added `PENDING` as the default so an unapproved account holds nothing, and enforced **exactly one
  owner** with a partial unique index rather than with application code that could be forgotten.
- Added the internal-operations schema: members/groups/vehicles, interventions with an explicit
  lifecycle, frozen recipient sets, an honest notification outbox with separate provider-attempt
  rows, responses with retained revisions, vehicle movements, an operational audit, and
  **attendance intervals** - the primary new capability.
- All writes go through `security definer` commands; RLS grants reads only. There is no direct
  insert or update path a client could use to forge an operational fact.

**Attendance, per the brief's core requirement.** Several intervals per member per intervention;
trusted server timestamps; user-reported times kept as separate columns that duration never reads;
duration derived as the sum of closed intervals with open ones reported separately; corrections
requiring a reason and preserving before/after immutably; and closing an intervention with open
intervals refused unless command explicitly acknowledges it - the intervals are then left open
rather than given an invented checkout time. A member being in two places at once is refused by an
**exclusion constraint across all interventions**, so participation hours cannot be double-counted;
that rule is documented as a decision in `docs/DATABASE.md`.

**Resolved the location contract mismatch.** The interface allowed a coordinate-only report while
the SQL demanded 2-300 characters, so a valid-looking submission would have failed at the database
boundary. The contract is now one thing: typed text always required, coordinates optional and
carrying their provenance and capture time. Both the accepted and the rejected path are tested.

**Verified**

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass |
| Types (strict) | `npm run typecheck` | Pass |
| Unit | `npm run test` | **91 passed** |
| Database + RLS | `npm run test:db` | **81 passed** |
| Build | `npx vite build` | Pass |
| Browser + axe | `npm run e2e` | **66 passed** |

The database tests run against real PostgreSQL 16.13 - no Supabase project, no credentials, no paid
service. Every test switches to the non-superuser `authenticated` role first; without that
PostgreSQL would bypass RLS and the suite would pass while proving nothing. Added a `postgres:16`
service container to CI so the same suite runs on a standard GitHub runner.

**Three real defects found by these tests and fixed at the cause**

1. `current_dvd_role()` returned `'PENDING'` for unapproved accounts. No permission leaked, because
   `is_dvd_staff()` excluded it, but "no internal role" was not one unambiguous value and a policy
   written later could have mistaken it for a role. It now returns NULL.
2. `effective_eta not in (15, 30, 60)` is NULL when the ETA is NULL, so a missing arrival band fell
   through the guard to the table constraint and the caller got an opaque error instead of
   `ETA_REQUIRED`. Classic SQL NULL trap.
3. `current_account_status()` was reachable by `anon`. Least privilege: an anonymous visitor already
   knows it is anonymous and needs nothing from the operational schema.

**Not done, and honestly not claimed**

- **No application code uses the new schema.** The browser prototype still runs on device-local
  state with a simulated actor. The schema is verified; the client is not connected to it.
- No Supabase project exists, so registration, email verification, password reset, session
  invalidation for suspended accounts, storage uploads and realtime remain unproven. Blocker B1.
- The Supabase platform surface in the tests is emulated (`supabase/tests/00_supabase_stub.sql`). It
  reproduces `auth.uid()` from JWT claims, the three database roles and the storage helpers; it does
  not reproduce GoTrue, the API gateway or realtime.
- No notification transport, no CSV export, no owner/admin write commands for members, groups and
  vehicles, no PWA decision, no deployment, no device testing.

**Next concrete action**

Wire the application to the verified schema: a global auth/access state that loads profile, role and
status before protected routes render, then real protected routes, then the commander publish flow
and the attendance board. This needs blocker **B1** (a Supabase project) resolved first - the wiring
cannot be honestly verified without one.

---

## 2026-09-09 — Accounts, owner roles and incident-map foundation

**Requested workflow:** added the detailed design for email/password signup, a six-digit email
verification code, name-and-surname completion, citizen-by-default access, and owner-only promotion
to firefighter, commander or administrator. Names are display data; permissions bind to the
authentication UUID. The owner role is deliberately absent from assignable roles.

**Report workflow:** specified and tested that every active approved firefighter, commander,
administrator and owner receives an informational `UNVERIFIED` report alert. This is separate from
an authorised call-out. Citizens cannot see the member roster, account directory, other reports or
operational details.

**Prototype UI:** added an eighth `Nalozi i pristup` view with the five-step registration flow and
a searchable fictional owner directory. It lets the owner simulation review role assignment without
accepting real emails or claiming authentication. Added an interactive Leaflet/OpenStreetMap map to
citizen intake: explicit device location and explicit map pin carry different sources, and stored
prototype reports appear with labelled unverified/reviewed markers. CI blocks community tile requests
rather than using the public tile service as test infrastructure.

**Production foundation:** added a dormant Supabase client for signup, OTP verification, profile
completion, sign-in and sign-out; a sample file containing only public browser configuration names;
and a SQL migration for profiles, access grants, role audit, citizen reports and private-media
metadata with RLS enabled. No project exists or is configured by this change, and the migration is
not applied anywhere.

**Research:** primary-source security, upload, geolocation, map-policy, push, storage and email limits
are cited in `ACCOUNTS_REPORTS_MAP_PLAN.md`. Free service allowances are treated as prototype capacity,
not reliability evidence. Custom SMTP, real role-policy tests, private storage, owner MFA and field
notification measurements remain gates before involving real people.

**Verification:** ESLint, 91 Vitest tests across eight files, strict TypeScript, production build and
`git diff --check` pass on the final local tree. The initial build warned that the new map and auth
libraries pushed one JavaScript chunk over 500 kB; the account and citizen-report views are now lazy
chunks, reducing the initial bundle to about 230 kB (69 kB gzip). The local Playwright run was
attempted and all 66 scenarios stopped before page launch because the required Chromium executable
was absent. Four official CDN attempts then timed out or returned 502, so no browser pass is claimed
locally. The complete tests remain committed for GitHub CI, which installs its own browser.

**Next:** publish this isolated branch for review and require the exact-head GitHub browser and
accessibility job to pass. The SQL migration has not been executed because this environment has no
dedicated Supabase project or local PostgreSQL instance; apply it only after independent review. Do
not configure a backend, deploy, send email or alert anyone as part of this slice.

## 2026-09-09 — Prepare the first-test and presentation package

**Source clarification:** the prototype owner confirmed that he is a DVD Tivat
firefighter-rescuer. The 52-member count, two vehicle categories, no-shift/base-first routine,
Viber alert group, iPhone/Android mix and DVD-Tivat-only scope are therefore recorded as first-hand
operating facts, not as facts awaiting another confirmation. Formal application permissions,
pilot approval, data governance and emergency safeguards remain authorised product decisions.

**Public context:** checked the society's public Instagram and Facebook presence. The public profile
supports the name and the 2018 origin/history statement only; it is not used to infer operations.
No social-media crest was imported because no approved original SVG or high-resolution transparent
PNG was available.

**Test package:** added `FIRST_TEST_CHECKLIST.md` with simulation safety gates, one complete
call-out, vehicle/status separation, citizen-report and administration checks, persistence/reset,
and explicit 390x844 and 412x915 phone passes. Added `TEST_FEEDBACK_FORM.md` with ratings, an issue
template and a decision outcome. Both forbid real identities and incident data.

**Presentation package:** added an 8–10 minute `PRESENTATION_SCRIPT.md` with exact fictional inputs,
spoken opening/boundary/closing text, a timed demonstration and the product decisions to obtain.
The detailed `DEMO_GUIDE.md` now routes presenters through the checklist and feedback form first.

**Drift protection:** three new tests read the committed documents and require the same 52-member
scale, base, Viber fallback, MAN-1, TERENAC-1, iPhone/Android targets, non-delivery statement and
public-branding boundary used by the application. The first implementation failed because Vitest
resolved an `import.meta.url` document path to `/docs`; the test now resolves from the project root.
The next run correctly caught two copy mismatches (`Viber` versus `Viber grupa`, and `terenac`
versus `TERENAC-1`); the documents were made exact and no assertion was weakened.

**Verification:** ESLint, 78 Vitest tests, strict TypeScript, the Vite production build and
`git diff --check` pass locally twice on the final tree. The private-data scan first matched CSS
triplets such as `255 255 255`; after excluding CSS colour declarations, the targeted secret,
telephone and email scan was clean.

GitHub CI run `34333542412`, job `102407498984`, completed successfully at attempt 1 on exact head
`0631119b8316cb390a654c70eaee6278e7dbee2e`: 78 unit tests, production build, 62 Chromium
functional/accessibility scenarios and 3 screenshot scenarios. Screenshot artifact `10096819765`
contains 14 PNGs, is 4,869,671 bytes and has GitHub-recorded ZIP SHA-256
`dd632584a7fd27884f6f9297a998a7c16fab996ea4bc3401a2e79cc3d4c13893`.

**Next:** keep PR #12 Draft and unmerged. The owner can now run the first-test checklist before
showing the prototype to DVD Tivat. The only visual output changed in this slice is the profile note
from pending confirmation to member-confirmed; the same screenshot suite passed on the exact head.

---

## 2026-09-09 — Apply the DVD Tivat operating profile

**First-hand operating facts:** the owner, a DVD Tivat firefighter-rescuer, confirmed 52 members;
one MAN firefighting vehicle and one firefighting SUV; no shifts; members travel from home to the
base for equipment before deployment; the current alert channel is a Viber group; both iPhone and
Android are used; and the product is for DVD Tivat only. Pending product decisions are isolated in
`docs/SOCIETY_PROFILE.md`.

**Public-data boundary:** the public repository still contains no real person, number, address,
registration, credential or incident. The seed now has 52 fictional member rows; rows 15–52 use
generic names. The two vehicle callsigns are invented. No scraped crest is used: the available
social profile image is not an approved, app-quality identity asset.

**Workflow correction:** removed the member-facing direct-to-incident choice. Every new response is
normalised by the pure reducer to `directToLocation: false`; the field remains only for compatibility.
Every preview and stored message states `Mjesto okupljanja: Baza DVD Tivat` separately from the
incident location. The duty overview names the no-shift/base-first model and Viber only as the
existing fallback; no Viber integration or notification was added.

**Scale and mobile UX:** the all-members group contains all 52 active fictional records. The duty
composer adds accessible search and a bounded scrolling roster without losing hidden selections.
Representative 390x844 iPhone and 412x915 Android checks assert no horizontal overflow and a 44px
primary action. These are browser-layout checks, not native push or locked-screen evidence.

**Local verification:** `npm run verify` passed: ESLint, 74 Vitest tests, strict TypeScript and a
Vite production build. Local Playwright could not launch because this environment has no Chromium;
the failed launch ran zero application assertions and is not counted as browser evidence. CI on the
exact remote head remains required before review.

**GitHub evidence:** Draft PR #12, runtime head
`f37994fc16a8aaa52d9eafef0b4cce89fd32a0e6`, CI run `34313382766`, job `102344466690`, attempt 1,
passed without a rerun: lint, strict typecheck, 74 unit tests, production build, 62 Chromium
browser/accessibility scenarios and 3 screenshot scenarios. Artifact `10089211902` contains 14 PNGs,
is 4,869,709 bytes and has GitHub-recorded ZIP SHA-256
`2085185206a6198ff79bf53d1385a706d7f154aacec9dc5c3b8d2408f66a2678`. The overview, composed
recipient search, member screen, two-vehicle board and 390x844 phone screenshot were visually
inspected; no overlap or clipping was observed. The phone screenshot is responsive-browser evidence,
not an iOS or Android native-device result.

**Next:** review the stacked Draft PRs in order (#9 through #12). Merge only with explicit owner
approval and reverify each retargeted exact head. Do not deploy, publish, enter real data or call
this an operational alert system.

---

## 2026-09-09 — Add safe local administration and define the production boundary

**Owner direction:** continue independently while Claude is unavailable, add the remaining useful
prototype functions, keep the experience personalised for DVD Tivat, and leave a reliable written
handoff. A later clarification records single-society use as the confirmed current scope.

**Citizen-report evidence:** CI run `34304900877`, job `102319448025`, attempt 1, passed on exact
head `b2c8065f18b82a9156a05aa48639b312f99efaa3`: lint, strict typecheck, 61 unit tests, production
build, 52 Chromium browser/accessibility scenarios and 3 screenshot scenarios. Artifact
`10086318945` contains 13 PNGs and has GitHub-recorded ZIP SHA-256
`4f69f5b6528b7a1264ff2cb484d2354c101e9ef8cf50f416965378093ef4c05d`. The preceding run failed
only because one test selected both a visible location result and the same text in a hidden dialog;
the selector was narrowed to the visible result without changing product behaviour or assertions.

**Local administration:** added pure reducer commands and a simulated-admin panel for creating and
updating invented members, groups and vehicles. Group membership is updated symmetrically on both
records, duplicate group names and vehicle callsigns are rejected, deactivated members remain in
history but are excluded from new recipient resolution, and repeated command ids are no-ops. The
panel accepts no contact details and repeatedly warns that it is local demonstration data, not
authentication or permission enforcement. Ten focused domain tests and browser/accessibility
coverage guard the new paths.

**Production boundary:** added `docs/PRODUCTION_ARCHITECTURE.md`. It records the server-owned data,
identity, authorisation, realtime, notification, citizen-media, privacy, operations and staged
physical-device evidence required after workflow approval. It is explicitly a decision document;
no backend, account, push service, upload endpoint, deployment or real data was added.

**Local verification:** `npm run verify` passed on the complete working tree: ESLint, 71 Vitest
tests, strict TypeScript and the Vite production build. `git diff --check` is clean. Local Chromium
remains unavailable, so no local browser pass is claimed.

**GitHub evidence:** Draft PR #11 targets `main` to test the complete stacked tree. CI run
`34305679955`, job `102321763307`, attempt 1, passed on exact runtime head
`55b3c15b848d489e903577ce020795953d63d2c8`: dependency install, lint, strict typecheck, 71 unit
tests, production build, 56 Chromium browser/accessibility scenarios and 3 screenshot scenarios.
Artifact `10086586979` contains 14 PNGs, is 4,107,485 bytes and has GitHub-recorded ZIP SHA-256
`92af330186f3f0abe8ec4362efea6c932d158d40fb6aaee6aa24524fda9c8239`. The full-page fictional
administration screenshot was visually inspected: the warning, forms, focusable controls, status
chips and roster/group/vehicle tables are legible with no observed clipping or overlap.

**Next:** review the stacked Draft PRs in order (#9, #10, #11). Merge only with explicit owner
approval and re-run exact-head CI after each retarget. Do not deploy, publish or enter real people
or operational data.

---

## 2026-09-08 — Simplify and modernise the interface before remaking the video

**Owner direction:** the first cinematic demonstration was acceptable as a video, but its application
interface was not. Do not revise the video yet. First produce a cleaner, simpler and more modern
desktop and phone experience, preserve every function, let the owner review it, then write a better
script and use more natural narration for the replacement video.

**Branch and safety:** work is isolated on `codex/modern-ui-ux`, based on verified
`main@9b4ba3fd22e83d30cb64c9718b673b5c19167a94`. No merge, deployment, real alert, real data,
credential, paid service or new video is part of this change.

**Interface correction:** removed the oversized decorative first-screen treatment and replaced it
with a compact operational summary whose status and counts come from the existing fictional state.
Grouped the six routes into operations and records, made the call composer a clear two-step workflow,
kept diagnostics secondary, and replaced the two-row phone menu with a compact horizontally
scrollable navigation row. Light and dark palettes now use calmer surfaces, stronger hierarchy,
larger focus rings and local system typography. The simulation disclosure, actor selector, preview
confirmation, validation, accessibility labels and every domain transition remain in place.

**Local verification:** `npm run verify` passed: ESLint, 50 Vitest tests, strict TypeScript and the
Vite production build. `git diff --check` passed. The repository Playwright command could not launch
locally because its Chromium binary was absent. One installation attempt was made; the CDN timed out
or returned 502, so it was not repeated. Browser, accessibility, responsive and screenshot evidence
will come from the existing GitHub workflow on the exact branch head rather than being guessed.

**First browser result and correction:** CI run `34233620774`, job `102085644202`, attempt 1,
failed five accessibility scenarios while all functional browser scenarios passed. Axe found the
new footer colour at 4.35:1 instead of the required 4.5:1 and found three explanatory `span`
elements inside a definition-list group. The result was not rerun. The next commit darkens the
shared faint-text token with a safety margin, increases footer text slightly, and represents each fact note
as a proper `dd`; no accessibility assertion was changed.

**Second browser result and correction:** CI run `34234136013`, job `102087384224`, attempt 1,
passed 46 browser scenarios and failed the same active-vehicle contrast check on desktop and phone.
The `Izaslo` chip measured 4.38:1 against its pale accent surface. That run was not rerun. The next
commit changes the light-theme accent from `#087b8c` to `#077687`, a measured 4.68:1 on that surface;
the existing dark-theme token is unchanged and no test or semantic status is changed.

**First complete browser pass and visual finding:** CI run `34234493087`, job `102088592524`,
attempt 1, passed all 50 unit tests, 48 browser/accessibility scenarios and two screenshot scenarios.
Screenshot artifact `10059284486` matched GitHub's recorded ZIP SHA-256
`4eb17435f0b4c307e62deb09a2f2b0c308329f037317babcb6e37c47f12585ac`. Visual inspection then
found that the three summary fact notes rendered at the numeric `dd` size and were ellipsised. The
cause was selector specificity after changing those notes from `span` to semantic `dd`. The next
commit gives the note selector equal structural specificity and allows the short copy to wrap; this
is a visual correction even though the automated suite was already green.

**Next:** push one atomic branch commit, open a Draft PR, run the existing 48 browser/accessibility
checks and two screenshot scenarios, then visually inspect the generated desktop and phone PNGs.
Do not merge or create the replacement video before owner review.

---

## 2026-09-08 — Final review, ordered merge and post-merge verification

**Owner approval:** after the combined-tree review reported no blocker, the owner explicitly
approved merging the reviewed stack.

**Review before merge:** the complete PR #7 tree matched the remote branch tree. Local lint,
strict typecheck, 50 unit tests and the production build passed. Both the full and runtime-only npm
audits reported zero known vulnerabilities. The public-tree scan found no real phone number,
email, credential, member record or private incident data. The only runtime external URL is the
OpenStreetMap search link opened by an explicit user click. Exact-head CI run `34200629847`, job
`101978356399`, attempt 1, passed 48 browser/accessibility checks and 2 screenshot scenarios.

**Merge:** PRs #1, #3, #4, #5, #6 and #7 were merged with merge commits in that order. Each next
PR was retargeted to `main` only after its verified base landed, preserving the tested ancestry.
Final `main` is `5c9acb6853543d61d6219fe377ba466e83ddf897`. GitHub compare reported the PR #7 branch ahead by
zero with no changed files, proving the merged tree is the reviewed final tree. PR #2 was not part
of the application stack and remains unmerged.

**Post-merge verification:** CI run `34204300780`, job `101990099552`, push event, attempt 1,
completed successfully on the exact final `main` commit. Dependency installation reported zero
vulnerabilities; lint, strict typecheck and production build passed; 50 unit tests, 48 Chromium
browser/accessibility checks and 2 screenshot scenarios passed. Artifact `10047140105` contains
12 PNGs, is 2,303,291 bytes, and has GitHub-recorded ZIP SHA-256
`5f3251f5f910889af95809ef65dd6c2f43391a8a0f9b4fe86069be10c8efdda7`.

**Unchanged limits:** no deployment, licence, account, backend, notification channel, paid service
or real data was added. Single-society use is still the owner's expectation, not a confirmed DVD
Tivat requirement.

**Next:** owner testing from `main` using `docs/DEMO_GUIDE.md`. Record concrete feedback before
changing the prototype. Do not begin production work before PRODUCT_PLAN questions Q1 and Q12 are
answered with the society.

---

## 2026-09-07 — Personalise the DVD Tivat workspace and prepare the demonstration

**Owner direction:** implement the outstanding review, mobile/keyboard checks, screenshots and
demonstration scenario. Personalise the modern interface for DVD Tivat. Use by this society alone
is an expectation, not confirmed; recorded in PRODUCT_PLAN and PROJECT_STATE. Claude is temporarily
unavailable; Codex is continuing on `codex/dvd-tivat-interface`, preserving every previous branch.

**Changes:** navy society rail, responsive six-item navigation, system light/dark working surfaces,
original sea-line decoration and a team overview whose fictional record counts use existing selectors.
No official logo, remote asset, dependency, authentication, alert channel or operational rule added.
The simulation disclosure remains visible on every view. Added DESIGN_DIRECTION and DEMO_GUIDE.

**Two corrections found during the requested review:**

- The skip link's `#main` fragment changed the hash route to the default screen. It now moves keyboard
  focus to main without changing the route or losing an unsent member draft. Added an HTTP browser
  interaction test, compact-width navigation checks and a count-independence scenario.
- A failed write probe discarded readable saved work in favour of the seed. A pre-fix persistence
  run showed **1 failed, 12 passed**, with the saved exercise title replaced by the seed title. Reads
  now proceed even if writes fail; existing data load with a truthful warning. No stored state is
  overwritten during loading. Full nested validation and multi-tab synchronisation remain limitations.

**First verification on runtime head `6016df4`:** lint, typecheck, build and **50 unit tests** passed
locally and on GitHub. CI run **34167989821**, job **101882738158**, attempt 1: **46 browser/axe
checks and 2 screenshot scenarios passed**. Twelve PNGs in artifact **10034805633**, ZIP SHA-256
`01e8d04406d3a0bc1e2e128727fa8e28d5a69ca435b27ea9c7626c0bc828ebfb`, downloaded and matched before review.

**Visual-review follow-up:** the member notice still claimed an answer had been recorded before
submission (pre-existing copy). It now distinguishes unsent, recorded and editing states, covered
by one browser scenario in both viewports. Full-page screenshot capture now scrolls to the top so
the sticky rail does not appear halfway down the image. Final follow-up CI belongs in the PR evidence.

**Follow-up verification on `dc38f1a`:** GitHub CI run **34168251914**, job **101883472581**, attempt
1: lint, strict typecheck, production build, **50 unit tests, 48 browser/axe checks and 2 screenshot
scenarios all passed**. Twelve screenshots in artifact **10034881906** were downloaded, the ZIP
matched SHA-256 `b8e9ed27f4816caf697e6e8d337f4a0dd615394bc3270a2295f90d29a97a12a0`, and the corrected desktop
and phone images were visually reviewed before being committed. The artifact contained only the
12 expected PNG basenames. No test was re-run; both CI runs were attempt 1.

The interactive cloud browser could not open this environment's localhost (`ERR_BLOCKED_BY_CLIENT`),
so browser verification and refreshed images use the repository's existing Playwright suite on a
standard GitHub runner. Added a CI screenshot artifact step; no deployment or automatic image commit.
The first local typecheck caught an optional indexed test value; corrected before CI.

**Next:** review Draft PR #7 and the committed screenshots, then have the owner run the demo.
Keep all PRs Draft and unmerged; no publishing, licence, paid service or real member data.

---

## 2026-09-07 — Harden local storage startup checks

**Finding and reproduction**

The start-up capability check wrote and deleted the fixed generic key `__dvd_tivat_probe__`.
Another application on the same origin could already own that key, in which case merely opening
this prototype overwrote and deleted the other application's value. Separately, `loadState()` did
not catch a `getItem()` refusal after the storage reference and write probe had succeeded, so a
browser policy change during start-up could crash React initialisation instead of showing the
existing storage warning.

Both regressions were written and run before the correction. The focused pre-fix result was
**2 failed, 10 passed**: one uncaught `SecurityError`, and one erased pre-existing probe value. The
test-only commit is preserved as remote commit `4e192fa`.

**Correction**

- The write probe now stays in the prototype's own `dvd-tivat-prototip:*` namespace.
- Any value already present at that namespaced probe is restored, including a best-effort restore
  when a storage backend mutates and then throws.
- Refusal of the real state read is caught. The app starts from fictional seed data and displays
  the existing `NEDOSTUPNO` warning instead of crashing.

**Verified**

| Check | Result |
|---|---|
| Persistence suite | **12 passed** |
| Full Vitest suite | **49 passed** |
| ESLint | Passes |
| Strict TypeScript + Vite 8 production build | Passes |
| GitHub CI run 34149475169, job 101828503089, attempt 1 | **Success** |
| Playwright + axe | **40 passed** — 20 desktop and 20 phone |

The CI result is on the exact runtime correction `279619b`. The failure-report upload step was
correctly skipped because the job passed; no verification step was skipped.

**Next concrete action**

Review stacked Draft PR #6 after #5. Do not merge, deploy or publish automatically. The committed
screenshots still need regeneration before the meeting because this environment could not download
Chromium locally.

---

## 2026-09-07 — Isolate unsent member drafts between simulated actors

**Finding and reproduction**

`MemberView` kept its answer draft, ETA, direct-to-location choice, error and edit mode in component
state. Switching the simulated actor did not unmount that view, so a second fictional member could
inherit the first member's unsent form. Nothing had been persisted, but the second member could
submit the inherited choices as their own.

The regression was pushed before the correction. GitHub run 34148415755, job 101825317231, attempt
1 failed on both desktop and phone: after switching from Ivan to Petar, `submit-response` still had
count 1 instead of 0. The rest of the browser suite passed (38 passed, 2 failed).

**Correction**

- Key only the member view by the simulated actor id. React now remounts that local form when the
  simulated person changes, discarding the old person's unsent draft.
- Other views are not keyed by actor, so changing the simulation selector cannot erase an
  in-progress dispatcher or vehicle form.
- The regression verifies a delayed/direct draft, switches actors twice, requires clean controls,
  and finally confirms that all four called members still have no recorded response.

**Verified**

| Check | Result |
|---|---|
| Full `npm audit` | **0 vulnerabilities** |
| ESLint | Passes |
| Vitest 5 | **47 passed** |
| Strict TypeScript + Vite 8 production build | Passes |
| GitHub CI run 34148622458, job 101825935869, attempt 1 | **Success** |
| Playwright + axe | **40 passed** — 20 desktop and 20 phone |

The failing run remains recorded; it was not rerun. The passing result came from the next commit
containing the product correction.

**Next concrete action**

Review stacked Draft PR #5. The committed screenshot files still need regeneration before the
meeting; the screenshot test is updated, but this environment could not download Chromium.

---

## 2026-09-07 — Development toolchain security update

**Finding**

`npm audit --omit=dev` reported zero production vulnerabilities, but the full audit reported five
development-only findings: three moderate, one high and one critical. They affected the local
Vite/esbuild development server and the optional Vitest UI server. The application ships no Node
server, so this was not a runtime-app vulnerability, but leaving known vulnerable tools in the
project was unnecessary risk for anyone running the prototype locally.

**Done**

- Upgraded the compatible toolchain set together: Vite 5 to 8.2.2, Vitest 2 to 5.0.0, and the React
  Vite plugin 4 to 6.1.1. No `--force` or `--legacy-peer-deps` was used.
- Rebuilt `package-lock.json` from the declared dependency set instead of preserving an old peer
  graph that npm correctly refused to reconcile.
- Added the Node version range required by Vitest 5 and documented it in the README.
- Updated the architecture document's current Vite version. The earlier Session 1 entry remains
  unchanged as historical evidence of what was originally scaffolded.
- Corrected the old claim that Vite output can be opened directly from disk. The generated HTML
  uses root-relative `/assets/...` URLs; it must be served by `npm run preview` or a static host.

**Verified before push**

| Check | Result |
|---|---|
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Full `npm audit` | **0 vulnerabilities** |
| ESLint | Passes |
| Vitest 5 | **47 passed** |
| Strict TypeScript + Vite 8 production build | Passes |
| `git diff --check` | Passes |
| GitHub CI run 34147837288, job 101823596636, attempt 1 | **Success** |
| Playwright + axe in that job | **38 passed** — 19 desktop and 19 phone |

GitHub CI installed Chromium and exercised the browser/accessibility suite on the exact toolchain
commit `4f070a5`; all 38 checks passed. A later documentation-only commit records that evidence and
does not change dependencies, application code or tests.

**Next concrete action**

Review stacked Draft PR #4. Leave it unmerged and undeployed for owner review.

---

## 2026-09-07 — Member response confirmation and test-count correction

**Done**

- Continued from `claude/dvd-tivat-app-dev-n8wctb@35a6416` on the separate
  `codex/member-response-confirmation` branch. The source branch and `main` were not modified.
- Corrected the member response flow: tapping `Dolazim`, `Dolazim kasnije` or `Ne mogu` now creates
  a visible draft. The member reviews the destination and, where applicable, the ETA before the
  explicit `Posalji odgovor` action records anything.
- Added a browser regression covering arrival via the station, direct arrival, delayed arrival,
  refusal, and editing an existing answer. Updated the existing flow, accessibility and screenshot
  paths to use the same explicit confirmation.
- Corrected `PROJECT_STATE.md` to distinguish 38 CI browser checks from the two desktop-only
  screenshot-generation checks instead of combining them into one ambiguous total.

**Verified before push**

| Check | Result |
|---|---|
| ESLint | Passes |
| Vitest | **47 passed** |
| Strict TypeScript + production build | Passes |
| `git diff --check` | Passes |
| GitHub CI run 34146149937, job 101818505766, attempt 1 | **Success** |
| Playwright + axe in that job | **38 passed** — 19 desktop and 19 phone |

The local environment could not download its Chromium test binary, so no local browser-test pass is
claimed. GitHub CI installed Chromium and executed the full browser/accessibility suite on the exact
runtime commit `f09fea1`; all 38 checks passed. A later documentation-only commit records that
evidence and does not change application or test code.

**Next concrete action**

Review stacked Draft PR #3 into `claude/dvd-tivat-app-dev-n8wctb`. Do not merge or deploy it
automatically.

---

## 2026-09-07 — Session 1, part 2: prototype implementation and verification

**Done**

- Scaffolded React 18 + TypeScript (strict) + Vite 5. Two runtime dependencies (`react`,
  `react-dom`); everything else is a dev dependency. No backend, no paid service, no network calls
  at runtime.
- Implemented the pure domain layer in `src/domain/`: `types`, `errors` (errors as values, not
  exceptions), `commands` (the command union, shaped like a future server API), `reducer`
  (`applyCommand`, the single place state changes), `selectors`, `message`, and the fictional
  `seed`.
- Implemented `src/storage/persistence.ts` over one `localStorage` key, handling storage
  unavailable, quota exceeded, corrupt data and an unknown schema version — each with its own
  message, and no silent migration.
- Built six views with hand-written CSS: dispatcher, member, vehicles, station display, roster,
  history. The application opens directly into the dispatcher screen.
- Wrote `.github/workflows/ci.yml` — one job on `ubuntu-latest`, `concurrency` with
  `cancel-in-progress`, Chromium only, 7-day artifact retention.

**The honesty rules, and where they are enforced**

- `DeliveryAttempt` is only ever created in `applyCommand`, always as `NIJE_POKUSANO` on channel
  `NEMA`. A test drives every user-reachable command and asserts no other state is ever produced.
- `vehicleStateFrom(movements, vehicleId)` does not take responses as a parameter, so no future
  edit can make an answer move a vehicle.
- `Exercise.status` changes only through `SET_EXERCISE_STATUS`; `ZAVRSENA`/`OTKAZANA` are not
  reachable from it at all, only through the separate confirmed close/cancel commands.
- `Call.recipientIds` is frozen at send time and is not recomputed from group membership.
- The simulation bar is on every screen, styled as a warning strip rather than an account menu.

**Verified — all green**

| Check | Result |
|---|---|
| `tsc --noEmit`, strict | Passes |
| ESLint (typescript-eslint, react-hooks, jsx-a11y) | Passes |
| Vitest | **47 passed** — 37 domain, 10 storage |
| Playwright, desktop 1440x900 | **20 passed** |
| Playwright, Pixel 5 viewport | **18 passed** (screenshot spec is desktop-only) |
| axe-core (wcag2a/2aa/21a/21aa) | No violations on six views, light **and** dark, empty and populated, plus the modal |
| Build | Clean; 203 kB JS / 62 kB gzipped |

Screenshots regenerated into `docs/screenshots/` from fictional data only.

**Three real defects found by the checks and fixed at the cause**

1. `saveState` probed storage with a test write before saving, so a quota-exceeded failure was
   reported as "this browser blocks storage". Split the probe (start-up only) from the real write,
   which now reports its own failure.
2. `--c-ink-faint` measured 4.49:1 against the page background — below WCAG AA for small text.
   Darkened to 5.2:1. `--c-unknown` had the same problem at chip size.
3. `.btn--danger` hardcoded white text, but `--c-alert` flips to a light salmon in dark mode:
   2.28:1. Added `--c-ink-inverse`, which flips with the theme, and extended the dark-mode axe scan
   to render a selected answer button, where the same bug was latent.

Also fixed: `scrollable-region-focusable` at phone width — tables and the modal body scroll but had
no tab stop, so they were unreachable without a pointer. Added a labelled `ScrollRegion`. And row
headers were inheriting the column-header styling, rendering member names uppercase and faint.

**Two more found by CI itself, on the first hosted run**

4. The browser job died on a bare `Timed out waiting 120000ms from config.webServer`. `vite preview`
   binds `localhost` by default, which on the runner can resolve to `::1` while Playwright probes
   `127.0.0.1` — the server was up and unreachable. Both sides are now pinned to `127.0.0.1`, and
   the webServer's stdout/stderr are piped so the next such failure is readable rather than a bare
   timeout. Reproduced the CI path locally with `CI=1`, which forces a fresh server instead of
   reusing a running one.
5. The workflow listened to both `push` on every branch and `pull_request`, so each push to a
   branch with an open PR ran the whole suite twice. Push now covers `main` only.

**Not done / limitations**

- No server, no accounts, no notification of any kind. By design.
- FireApp itself was never installed or tested; `docs/FIREAPP_REVIEW.md` is a documentation review.
- Apple's Critical Alerts entitlement wording and the Google Play SMS policy table were **not**
  verified in this session and are marked as such.
- No private preview hosting was available, so the prototype is provided as a runnable project and
  screenshots. It has not been deployed anywhere.
- Playwright resolves to a version whose bundled Chromium build may not match a pre-provisioned
  sandbox. `PLAYWRIGHT_CHROMIUM_PATH` points the run at an existing browser; CI installs its own and
  leaves the variable unset.

**Next concrete action**

Take the prototype to the meeting and answer
[PRODUCT_PLAN.md §G](../PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society) — starting
with Q1 (is any dispatch system obligatory?) and Q12 (what does a custom build give the society
that an existing product does not?). Do not start Phase 2 until those two are answered: the first
can invalidate the plan, and the second decides whether it is worth doing.

---

## 2026-09-07 — Session 1, part 1: research review and plan

**Done**

- Inspected the repository before editing: one commit (`307ebba`), a two-line `README.md`, no other
  files. Nothing pre-existing to preserve. Working branch `claude/dvd-tivat-app-dev-n8wctb` already
  existed on the remote and was already checked out.
- Re-verified the reference research against primary sources rather than trusting the supplied
  report. Fetched and confirmed: FireApp's selective-alarming workflow (recipient selection,
  preview, double confirmation, TEST/VAJE/INTERVENCIJA labels, internet requirement), the member
  response options (three answers, 15/30/60-minute bands, direct-to-location, changeable), and
  vehicle departure/return logging. Written up with a per-claim verification table in
  `docs/FIREAPP_REVIEW.md`.
- Could **not** verify Apple's Critical Alerts entitlement wording — the Apple documentation page is
  client-rendered and returned no body text to the fetch tool. Recorded as unverified rather than
  asserted. Same for the Google Play SMS policy table, which is reported from the source research
  and not independently re-fetched.
- Wrote the plan: `docs/PRODUCT_PLAN.md` (scope, users, prototype vs production, assumptions, four
  roles with a proposed permission matrix, the six-fact data model, five phases with failable
  acceptance criteria, risks, questions for the society) and `docs/ARCHITECTURE.md` (stack choice
  and rejected alternatives, layering, the pure-reducer decision, honesty enforced in types,
  persistence limits, path to mobile, verification strategy).

**Verified**

- Four primary-source fetches succeeded and are quoted in `docs/FIREAPP_REVIEW.md` §2.
- Two intended sources did not verify and are marked as such. No claim in the documents rests on an
  unverified source without saying so.

**Not done / limitations**

- No code yet at the time of this entry.
- FireApp itself was not installed, logged into, or tested. This is a documentation review only.

**Next concrete action**

Scaffold the React + TypeScript + Vite project per `docs/ARCHITECTURE.md` §1, then implement
`src/domain/` (types, errors, commands, pure reducer, selectors, fictional seed) before any UI.
# 2026-09-08 — Citizen-report prototype, first slice

**Scope**

- Started `codex/citizen-report-prototype` from the exact tree under review in
  `codex/modern-ui-ux`. Stable `main` and the redesign branch were not modified.
- Added a seventh route for a citizen to describe a possible incident, attach an optional
  session-only photo, type a landmark or explicitly request device coordinates, review the exact
  record, and save it locally.
- Added a separate DVD Tivat inbox action that can say only "reviewed in simulation". The domain
  structurally prevents report submission or review from creating an exercise, call, delivery,
  member response or vehicle movement.
- A reviewed item may prefill the existing dispatcher composer. It selects no recipients and
  creates nothing until the duty officer reviews and explicitly confirms the ordinary call flow.
- Bumped the JSON schema to 2 with one explicit lossless migration from schema 1: add an empty
  report inbox. Unknown versions are still rejected.

**Privacy and safety boundary**

- No backend, account, notification, upload or real alert channel was added.
- Image bytes and the local filename never enter application state or local storage.
- Device location is requested only after an explicit button press and remains in this browser.
- Every report screen states that it is not an emergency channel and that nothing reaches DVD
  Tivat or any service.

**Verification so far**

- TypeScript and ESLint pass.
- 24 focused domain and persistence tests pass, including nine new report rules and explicit
  schema migration coverage.
- Local browser execution is not claimed: the Playwright Chromium download failed with repeated
  CDN timeouts/502 responses. GitHub CI must execute the browser, mobile and accessibility checks
  on the eventual pushed head.

**Next concrete action**

Run the complete local non-browser gate, finish browser-test coverage and push this isolated branch
for a Draft stacked review. Do not merge or deploy it.

---
