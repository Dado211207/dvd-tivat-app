# Database

Schema, semantics and how to run the integration tests.

Companion: [ACCESS_MODEL.md](./ACCESS_MODEL.md) for the role and RLS contract.

---

## 1. Running the tests

The database tests need a real PostgreSQL 16. They do **not** need Supabase,
Docker, credentials or any paid service.

```bash
npm run db:start     # throwaway PostgreSQL 16 on port 55432
export DVD_TEST_DATABASE_URL="postgresql://postgres@localhost:55432/postgres"
npm run test:db
npm run db:stop
```

Any existing PostgreSQL 16 works too — point `DVD_TEST_DATABASE_URL` at it. The
suite **drops and recreates** the `public`, `auth` and `storage` schemas on every
run, so give it a scratch database and never a database you care about.

In CI a standard GitHub `postgres:16` service container provides the server; see
`.github/workflows/ci.yml`.

### What the tests prove, and what they do not

Each run applies, from an empty database:

1. `supabase/tests/00_supabase_stub.sql` — **test-only** emulation of the
   Supabase platform surface;
2. `supabase/migrations/202609090001_accounts_reports.sql`;
3. `supabase/migrations/202609090002_internal_operations.sql`;
4. `supabase/migrations/202609110003_client_role_privileges.sql`;
5. `supabase/migrations/202609110004_function_execute_privileges.sql`;
6. `supabase/migrations/202609120005_organisational_writes.sql`;
7. `supabase/migrations/202609130006_attendance_truth.sql`;
8. `supabase/migrations/202609140007_availability_and_journey.sql`;
9. `supabase/migrations/202609150008_recipient_eligibility_and_history.sql`;
10. `supabase/migrations/202609150009_realtime_publication.sql`;
11. `supabase/migrations/202609150010_intervention_audit_read.sql`;
12. `supabase/migrations/202609150011_revoke_event_trigger_execute.sql`;
13. `supabase/migrations/202609150012_web_push_subscriptions.sql`;
14. `supabase/migrations/202609200013_multi_service_account_admin.sql`;
15. `supabase/migrations/202609200014_required_registration_profile.sql`;
16. `supabase/migrations/202609200015_activate_szs_account_service.sql`.

The list lives in `db-tests/harness.ts`; keep the two in step, because a
migration missing from that array is a migration nothing ever runs.

So "the migrations run on a clean database" is checked on every run: if any
migration is not runnable from zero, every test fails.

Every test acts through `asUser()`, which sets the same `request.jwt.claims` GUC
Supabase sets and switches to the non-superuser `authenticated` role. **That role
switch is what makes the tests real** — as `postgres` (a superuser) PostgreSQL
bypasses every policy, and a suite written without it would pass while proving
nothing.

The stub reproduces `auth.uid()` from JWT claims, the `anon` / `authenticated` /
`service_role` roles, `auth.users`, the storage helpers, and — importantly —
Supabase's **default privileges**, which grant every client role full access to
each new table in `public`. Without that last part the local database would be
*stricter* than the real platform and the suite would keep proving a
least-privilege property the hosted project did not have. See
[ACCESS_MODEL.md §5](./ACCESS_MODEL.md#5-writes-are-impossible-from-a-client) for
the **two** defects this has now caught — the original one on the hosted project,
and the identical mistake repeated on `organisation_audit` in `202609120005`,
which failed on that migration's very first local run.

It does **not** reproduce GoTrue signup and OTP, the API gateway, storage upload
handling, or realtime. Those need a real project and are listed as blockers in
[ai/PROJECT_STATE.md](./ai/PROJECT_STATE.md).

## 2. Migration strategy

Every migration that has been applied anywhere is left **untouched**. A database
that applied an earlier one converges to the same place as a clean one, which is
the only migration discipline worth having — so a defect is repaired by a new
migration, never by editing an old one.

| File | What it does |
|---|---|
| `202609090001_accounts_reports.sql` | Accounts, roles, the abandoned citizen-report tables |
| `202609090002_internal_operations.sql` | Repairs the first migration's defects with `alter` / `create or replace`, then adds the whole internal-operations schema |
| `202609110003_client_role_privileges.sql` | Takes back the table privileges Supabase's project defaults hand to `anon` and `authenticated`, and grants back only what the policies need |
| `202609110004_function_execute_privileges.sql` | Removes the PUBLIC `EXECUTE` grant that left eight `security definer` helpers callable without signing in |
| `202609120005_organisational_writes.sql` | The missing write paths: creating, editing and discarding an intervention draft, and CRUD for members, groups and vehicles. Adds `is_dvd_admin()` and the `organisation_audit` trail |
| `202609130006_attendance_truth.sql` | Stops a self-declared claim counting as participation: adds `source`, a rejection state, `attendance_confirm`/`_reject`/`_unconfirm`, and **replaces** `attendance_totals()` with a version that separates confirmed from unverified time. Adds the two remaining write paths — `acknowledge_intervention` and vehicle departure/return. Also repairs `current_member_id()`, which resolved a member identity for accounts that had lost their role — see [ACCESS_MODEL.md §2](./ACCESS_MODEL.md#identity-is-not-separable-from-authority) |
| `202609200013_multi_service_account_admin.sql` | Adds independent DVD/SZS account memberships, owner-only assignment and permanent audit without widening DVD operational access |
| `202609200014_required_registration_profile.sql` | Requires server-validated full name, telephone and date of birth before operational access can become effective |
| `202609200015_activate_szs_account_service.sql` | Makes new and unassigned accounts limited citizens, gives SZS its official display name, adds a self-only membership read and returns removed DVD members to citizen without touching SZS membership |

`202609110003` and `202609110004` exist because of a defect only a real project
could reveal; both are explained in
[ACCESS_MODEL.md §5](./ACCESS_MODEL.md#5-writes-are-impossible-from-a-client).
`202609120005` is not part of that repair — it closes a different gap, that the
schema could publish a call-out but nothing could create one.

**Additive is not the same as harmless, and only one of the two pending
migrations is additive at all.** `202609120005` adds and drops nothing.
`202609130006` **drops and recreates `attendance_totals(timestamptz,
timestamptz)` with different result columns**, which is a breaking change to a
callable interface and not something to file under "additive". §3.1 sets out the
before-and-after contract, every place the function is called from, the required
order, and what to do if it fails halfway. Read it before applying either file.

## 3. The real Supabase project

**All checked-in migrations are applied.** Historical fingerprints and the
latest targeted postflight are recorded below.

| Migration | On the hosted project |
|---|---|
| `202609090001` · `202609090002` · `202609110003` · `202609110004` | **Applied** 2026-09-11, in order |
| `202609120005_organisational_writes.sql` | **Applied** 2026-09-12 |
| `202609130006_attendance_truth.sql` | **Applied** 2026-09-12 |
| `202609140007_availability_and_journey.sql` | **Applied** 2026-09-13 |
| `202609140008` through `202609150012` | **Applied** before the 2026-09-20 account rollout |
| `202609200013_multi_service_account_admin.sql` | **Applied** before the 2026-09-20 preflight |
| `202609200014_required_registration_profile.sql` | **Applied** 2026-09-20 |
| `202609200015_activate_szs_account_service.sql` | **Applied** transactionally 2026-09-20; targeted postflight passed |

The project is `dvd-tivat-app`, ref `yskhdzrdbywrpfowckpn`, region `eu-west-1`,
PostgreSQL 17. Its `public` schema was empty before the first four.

`...0005` and `...0006` were applied with the owner's conditional authorisation
after the §3.1 preflight: the four-migration starting point confirmed, neither
pending migration partly applied, the old five-column `attendance_totals`
contract read rather than assumed, **zero dependent views** (`pg_depend`), and
every table empty. The recovery position was that the repository's own
migrations reproduce the state exactly, because there was no data to lose.

Post-migration verification passed every check in §3.1, including the one most
easily forgotten: **the `EXECUTE` grant survived the drop-and-recreate**
(`authenticated` yes, `anon` no), and exactly one `attendance_totals` overload
exists with the eight-column contract.

**The hosted schema is level with the branch, and that was verified rather than
assumed.** A structural fingerprint — functions, columns, constraints, indexes,
policies, client grants and RLS flags — was taken on the hosted project and on a
local PostgreSQL 16 that had applied the same files from zero. **All seven
sections matched**: `907cb555d29b28616a57807d3503f55a` across 43 functions
after `202609130006`, and `ee2886b99683c44f00216a7e84e7b0dd` across 46 after
`202609140007`.

`202609140007` is **purely additive** in the strict sense this file uses: four
new tables, three new functions, new policies and grants. It alters no existing
function's signature and drops nothing, so §3.1's warning does not apply to it.

The migration-015 postflight verified exactly one history row, the `CITIZEN`
default, no remaining `PENDING` grants, six unchanged active DVD memberships,
zero SZS memberships, the official SZS display name and the self-membership
RPC privileges (`authenticated` execute; no `anon` execute).

**The measured-record slice of 2026-09-13 added no migration at all.** Every
fact it puts on screen was already stored: `attendance_totals()` already
returned exact fractional seconds, `vehicle_movements` already carried
`departed_by` and `returned_by`, and `operational_audit` already recorded
`movement_id` on `VEHICLE_DEPARTED` and `VEHICLE_RETURNED`, which is how the
archive names the member behind each end of a vehicle movement. The defect was
entirely in what the client did with those rows.

**`attendance_totals()` now has an application caller.** `ArchiveView` selects
its named columns through `fetchParticipationTotals()`. When `202609130006` was
written, nothing outside the test suite called that function, which is what made
its drop-and-recreate safe. That is no longer true: **changing its result columns
is now a breaking change to the history screen**, and the same drop-and-recreate
would need the caller updated in the same change.

**`confirmed_seconds` is `numeric`, and the fraction matters.** The function has
always summed `ended_at - started_at` exactly and returned seconds with their
fractional part; the client was discarding it, turning a 10.591-second interval
into a whole number and then - through a formatter that could not express
seconds at all - into "1 min". Nothing on the server needed changing.
`fetchParticipationTotals` converts once at the boundary
(`confirmed_seconds * 1000`) so the rest of the application works in
milliseconds. See `docs/METRICS.md` for the full duration contract.

Whoever changes this function next: **do not round it**, and do not narrow the
column to `integer`. A `numeric` that loses its fraction here cannot be
reconstructed on the client, and the difference between 10 and 11 seconds is
the difference between a record and a guess.

> One wrinkle worth recording, because it nearly became a silent exception. The
> first apply stripped the inline comments out of thirteen function bodies to
> keep the request manageable. `pg_get_functiondef` stores a body verbatim, so
> those thirteen hashed differently even though the code was identical — proven
> identical by comparing comment- and whitespace-normalised hashes before
> anything was changed. Rather than document a thirteen-function exception list
> that would rot, the exact repository text was re-applied. A fingerprint with
> a list of "expected differences" stops being able to detect a real one.

The result of those first four was verified rather than assumed: a structural
fingerprint of the hosted schema — tables and their RLS flags, every column with
type, nullability and default, every constraint definition, every index
definition, every policy with its `using` and `with check` expressions, every
trigger, every table grant, and an md5 of every function body — was compared
against the same fingerprint taken from a local PostgreSQL 16 that had applied
the same files. **Every section matched byte for byte**, with one expected
exception: the hosted database also carries Supabase's own platform function
`rls_auto_enable()`, which the local stub does not provide.

**That comparison covers migrations `...0001`–`...0004` only.** It was taken
before `202609120005` existed and says nothing about the six-migration schema
this branch builds. It is not evidence that the hosted project matches this
branch — it currently does not.

Do **not** apply `supabase/tests/00_supabase_stub.sql` to a real project. It
would collide with the platform's own `auth` and `storage` schemas.

CI cannot reach the hosted project — that would need a secret in CI, which this
repository deliberately does not have — so the local PostgreSQL suite remains the
authoritative automated evidence. Nothing here claims CI tested the live project.

### 3.1 Applying the two pending migrations — and why "both are additive" is wrong

An earlier draft of this documentation called both pending migrations additive.
**That was wrong about `202609130006`, and the distinction is not pedantic**: an
additive migration cannot break a caller, and this one can.

`202609120005` **is** purely additive. It creates new tables, functions and
grants; it alters no existing function's signature and drops nothing.

`202609130006` is additive in its **table** changes — three new columns on
`attendance_intervals`, new constraints, a new index, six new functions — but it
also performs a **breaking replacement of a callable interface**:

```sql
drop function if exists public.attendance_totals(timestamptz, timestamptz);
create function public.attendance_totals(...) returns table (...)
```

The drop is unavoidable, not a shortcut. PostgreSQL's `create or replace
function` **cannot change a function's output columns** — it fails with `cannot
change return type of existing function`. Splitting one `total_seconds` figure
into confirmed and unverified time is precisely such a change, so the old
function must go before the new one can exist.

**What changed, exactly:**

| | Before (`202609090002`) | After (`202609130006`) |
|---|---|---|
| Signature | `attendance_totals(from_ts timestamptz default '-infinity', to_ts timestamptz default 'infinity')` | **Identical** — same name, same two argument types, same defaults |
| Result columns | `member_id uuid`, `full_name text`, `closed_intervals bigint`, `open_intervals bigint`, `total_seconds numeric` — **5 columns** | `member_id uuid`, `full_name text`, `confirmed_intervals bigint`, `confirmed_seconds numeric`, `unverified_intervals bigint`, `unverified_seconds numeric`, `open_intervals bigint`, `rejected_intervals bigint` — **8 columns** |
| Meaning of the time figure | `total_seconds` summed **every** closed interval regardless of `verified` — the defect | `confirmed_seconds` counts only `verified` intervals; unconfirmed time is reported separately and never added in |
| Volatility, language, security | `language sql`, `stable`, `security invoker`, fixed `search_path` | **Unchanged** |
| Execute grant | `authenticated` only, from `202609110004` | Dropped with the function, then **re-granted** in `...0006`'s final block |

Only `member_id`, `full_name` and `open_intervals` survive by name, and
`open_intervals` changed subtly too: it now excludes rejected rows.

**Does any consumer call it?** Established by reading the tree, not assumed:

| Possible consumer | Result |
|---|---|
| Application source (`src/**`) | **No.** Every `.rpc()` call site was enumerated: `owner_set_role`, `owner_set_account_active`, `complete_own_profile`, `current_dvd_role`, `current_account_status`, and the twelve `admin_*` roster commands. `attendance_totals` is not among them, and no `.from()` read touches it |
| Database views | **None exist.** No migration creates a view, so no view has frozen the old column list |
| Other SQL functions | **No.** The only other mentions in `supabase/` are the two privilege-grant arrays inside the migrations themselves |
| `db-tests/**` | **Yes** — `attendance.test.ts` and `attendance_truth.test.ts`, both updated in this branch to the new columns |
| Anything on the hosted project | **Nothing that this repository built.** No screen reads attendance from the server yet |

**So the replacement is safe now, and would not be later.** The safety comes
entirely from there being no live caller today — not from the change being small.
Once a history screen or CSV export selects named columns from this function,
the same edit becomes a breaking change that needs a new function name or a
compatibility shim. The window is open now; it will not stay open.

`select *` is also why the test suite survives: it reads whatever columns the
function returns and asserts on named fields, so it fails loudly on a missing
column rather than silently mismatching positions.

**Required order: `202609120005` first, then `202609130006`.** `...0006` is
written against a schema that already has `...0005`. Applying `...0006` alone
against the hosted project's current four-migration state will fail. The local
suite proves the seven-step sequence from an empty database on every run; it
proves nothing about any other order, and no other order should be attempted.

#### Preflight, before either file is applied

Run these against the hosted project and **stop if any answer is unexpected**:

```sql
-- 1. Confirm the starting point: exactly the first four migrations' objects,
--    and neither pending migration already partly applied.
select to_regprocedure('public.is_dvd_admin()')            as expect_null,
       to_regclass('public.organisation_audit')             as expect_null,
       to_regprocedure('public.attendance_confirm(uuid,text)') as expect_null,
       to_regclass('public.attendance_intervals')           as expect_not_null;

-- 2. Confirm the OLD attendance_totals contract is what is actually there,
--    rather than trusting this document.
select p.oid::regprocedure as signature,
       pg_get_function_result(p.oid) as result_columns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'attendance_totals';
-- Expect exactly one row, 5 result columns, ending in total_seconds numeric.

-- 3. Confirm nothing on the hosted project depends on it that this
--    repository did not create (a dashboard view, a hand-written function).
select distinct dependent.relname, dependent.relkind
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class dependent on dependent.oid = r.ev_class
where d.refobjid = 'public.attendance_totals(timestamptz,timestamptz)'::regprocedure;
-- Expect zero rows. Any row here means a view would be dropped or broken:
-- STOP and re-plan with a renamed function instead.

-- 4. Confirm the data the new columns will describe.
select count(*) as intervals,
       count(*) filter (where verified) as already_verified,
       count(*) filter (where ended_at is null) as still_open
from public.attendance_intervals;
-- Pre-migration rows become source = 'UNKNOWN'. Expect 0 on a project with
-- no attendance screen; a non-zero count needs an explanation before applying.
```

Take a backup or a point-in-time-recovery checkpoint before applying either
file. On Supabase that is the dashboard's own backup facility; this repository
cannot take one for you.

#### Post-migration verification

```sql
-- 1. The new contract exists, with exactly 8 result columns, and only one
--    overload of the name exists.
select p.oid::regprocedure, pg_get_function_result(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'attendance_totals';

-- 2. The execute grant survived the drop-and-recreate. This is the step most
--    easily forgotten: dropping a function drops its grants with it.
select has_function_privilege('authenticated',
         'public.attendance_totals(timestamptz,timestamptz)', 'execute') as expect_true,
       has_function_privilege('anon',
         'public.attendance_totals(timestamptz,timestamptz)', 'execute') as expect_false;

-- 3. No function anywhere in public is executable by anon or by PUBLIC.
select p.oid::regprocedure
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (has_function_privilege('anon', p.oid, 'execute')
       or coalesce(array_to_string(p.proacl, ',') like '%=X/%', false));
-- Expect zero rows.

-- 4. The new columns, constraints and the confirmation commands are present.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'attendance_intervals'
  and column_name in ('source','rejected_at','rejected_by','rejection_reason');
-- Expect 4 rows.

-- 5. The function actually runs and returns the new shape.
select * from public.attendance_totals() limit 1;
```

Then re-take the structural fingerprint described above and compare it against a
local PostgreSQL that has applied all seven files, exactly as was done for
`...0001`–`...0004`. **A migration reported as applied is not a migration
verified as applied.**

#### If `202609130006` fails after `202609120005` has already applied

`...0005` is purely additive, so a half-applied pair is **not** a broken
database: the four-migration functionality plus `...0005`'s write paths all work.
Nothing in `...0005` depends on `...0006`.

The hazard is narrower and specific: **`...0006` drops `attendance_totals`
before creating the replacement.** Whether a failure between those two
statements leaves the function missing depends entirely on how the file is
applied, and **the file does not control that itself** — it contains no `begin;`
or `commit;`, deliberately, so the tool applying it decides. Apply it in one
transaction, and make that explicit rather than assumed:

| How it is applied | One transaction? |
|---|---|
| `supabase db push` | Yes — the CLI wraps each migration file |
| `psql --single-transaction -f <file>` | Yes |
| `psql -f <file>` without that flag | **No** — each statement commits on its own |
| Pasted into the Supabase dashboard SQL editor | **Not guaranteed.** Wrap the paste in `begin;` … `commit;` by hand |

If it was applied atomically, a failure rolls the drop back with everything else
and the old five-column function is still there. Verify that rather than assume
it:

```sql
select p.oid::regprocedure, pg_get_function_result(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'attendance_totals';
```

- **One row, 5 columns** → the rollback was clean. Fix the cause, re-run the
  whole file. Do not hand-patch.
- **Zero rows** → the drop committed and the create did not, so the file was
  applied without a surrounding transaction. **Forward-fix, do not improvise**:
  re-run `202609130006` from the beginning. Every statement in it is written to
  be re-runnable, and this was checked against the file rather than hoped for:
  `add column if not exists` for all four new columns, `drop constraint if
  exists` immediately before each of the three `add constraint` statements,
  `create index if not exists`, `create or replace function` for all eight other
  functions, and `drop function if exists` before the one that must be
  recreated. So a second run completes the work instead of failing on what is
  already there. Re-running is the recovery path; reconstructing the old
  function by hand is not, because it would restore the defect.
- **Two rows** → an unexpected overload exists. Stop and report it rather than
  dropping anything.

There is no "roll back `202609130006`" path and there should not be. Reverting
it would reinstate a function that counts self-declared claims as participation
— the defect the migration exists to remove. If it must be undone, that is a new
forward migration with its own review, not a restore of deleted code.

## 4. What the schema keeps separate

The ten facts in [ACCESS_MODEL.md §7](./ACCESS_MODEL.md#7-facts-that-are-never-inferred-from-each-other)
each have their own table. The two that matter most:

- **Intent** (`intervention_responses`) is not attendance.
- **Attendance** (`attendance_intervals`) is not a vehicle movement.

## 5. Interventions

`interventions` carries the lifecycle:

```
DRAFT ──publish──> PUBLISHED ──> ASSEMBLING ──> DEPLOYED ──> CONTAINED
                        │                                        │
                        └──────────── CLOSED / CANCELLED ─────────┘
```

- `DRAFT` is command-only: not yet a call-out. It is created by
  `create_intervention_draft`, edited by `update_intervention_draft` while it is
  still a draft, and abandoned by `discard_intervention_draft`, which marks it
  `CANCELLED` rather than deleting it. Before `202609120005` there was no way to
  create one at all, which made `publish_intervention` unreachable.
- `CLOSED` and `CANCELLED` are **not reachable** through
  `set_intervention_status`; they are separate commands that require a reason.
- `version` gives optimistic concurrency, so two commanders cannot silently
  overwrite one another (`VERSION_CONFLICT`).
- `idempotency_key` is unique per creator, so a retried publish cannot call the
  society twice. `create_intervention_draft` honours the same key: a commander
  whose connection drops mid-tap gets the draft they already made, not a second
  one. The unique index remains the backstop behind that, and both are tested
  separately.

### The location contract

**A typed place is always required** (`incident_location`, 2–300 characters).
Coordinates are optional and, when present, must carry both
`coordinate_source` (`MAP_PIN` / `TYPED` / `DEVICE`) and
`coordinate_captured_at`.

> **Fixed here.** The earlier branch let the interface submit a coordinate-only
> report while the SQL demanded 2–300 characters, so a valid-looking submission
> would have failed at the database boundary. The contract is now one thing: the
> text is required, coordinates are an addition with provenance. A bare pin is
> also not something a crew can act on at 03:00. Both the accepted and the
> rejected path are tested.

The commander's device position is never assumed to be the incident: `DEVICE` is
a distinct, recorded provenance, not a default.

## 6. Attendance — the primary capability

```sql
attendance_intervals(
  intervention_id, member_id,
  started_at, ended_at,                      -- trusted server time
  reported_started_at, reported_ended_at,    -- optional, user-reported, never used for duration
  crew, task_role, vehicle_id,               -- optional deployment detail
  recorded_by,
  source,                                    -- WHO ASSERTED IT (202609130006)
  verified, verified_by, verified_at,        -- command stands behind it
  rejected_at, rejected_by, rejection_reason -- command repudiates it (202609130006)
)
```

### Two independent facts: provenance and confirmation

> **Fixed here, and it was the most consequential defect found in this project
> so far.** Until `202609130006` a member could check themselves in and that
> claim counted as participation, because:
>
> 1. `attendance_check_in()` with no target member required only
>    `is_dvd_staff()`, so a `FIREFIGHTER` created their own interval;
> 2. the row landed `verified = false`, which *looked* like a safeguard;
> 3. **`attendance_totals()` never filtered on `verified`.** It summed every
>    closed interval.
>
> So "a member **actually attended**" — then one of nine facts this schema
> exists to keep separate, now split into two — was in practice "a member said
> they were there". And
> `verified = true` was set in exactly one place: as a **side effect** of
> `attendance_correct()`. Confirmation was not a decision anybody made; it was
> something that happened to a record when a commander fixed its clock. Nothing
> read the column at all.

The two facts are now separate and neither implies the other:

| Field | Question it answers | Values |
|---|---|---|
| `source` | **Who asserted this?** | `SELF_DECLARED`, `COMMAND_RECORDED`, `UNKNOWN` |
| `verified` / `rejected_at` | **Has command decided about it?** | pending, confirmed, rejected |

`source` is set inside the command from `auth.uid()` and is **not a parameter** —
a client must not be able to label its own claim as command-recorded. `UNKNOWN`
exists only for rows written before this migration, where the information is
genuinely unrecoverable; it counts as unconfirmed.

A commander recording somebody else's arrival is `COMMAND_RECORDED` and **still
unconfirmed**. That is deliberate: "I wrote it down" and "I stand behind it" are
different claims by the same person.

Rules, each enforced by the database and tested:

| Rule | How |
|---|---|
| Several intervals per member per intervention | No unique constraint; people leave and come back |
| No interval ends before it starts | `check (ended_at is null or ended_at > started_at)` |
| **A member is never in two places at once** | `exclude using gist` on `(member_id, tstzrange(started_at, coalesce(ended_at,'infinity')))` |
| Duration is never stored | `attendance_totals()` sums closed intervals from server timestamps |
| **Only confirmed time is participation** | `attendance_totals()` returns `confirmed_seconds` and `unverified_seconds` as separate columns. Nothing can read a claim as confirmed |
| **A rejected claim contributes nothing** | Counted as `rejected_intervals`, never summed into either seconds column |
| An open interval is visible as open | `open_intervals` is separate and contributes 0 seconds |
| A record cannot be confirmed and rejected at once | `attendance_not_both_states` check constraint, behind two command refusals |
| Confirming is idempotent | A repeat returns without a second audit row |
| Rejection needs a reason; confirmation does not | See the note below |
| Confirmation is reversible | `attendance_unconfirm()` returns the row to **pending**, not to rejected |
| **Correcting is not confirming** | `attendance_correct()` no longer touches `verified` at all |
| Correction needs a reason | `attendance_correct()` refuses `REASON_REQUIRED` |
| Before and after are preserved | `attendance_corrections` holds both as `jsonb`, plus actor and time |
| A correction cannot create an overlap | Exclusion constraint, surfaced as `CORRECTION_WOULD_OVERLAP` |
| Closing with open intervals is never silent | `OPEN_ATTENDANCE_INTERVALS:<n>` unless command passes `allow_open_attendance` |

**Why rejection needs a reason and confirmation does not.** Rejecting overrides
what a member stated about their own presence, and that has to be explainable
afterwards. Confirmation is the expected outcome, and demanding boilerplate from
a commander working through thirty records after an incident would produce thirty
meaningless strings. Both are audited with actor and server time either way.

**The simultaneous-participation rule, decided and documented:** overlap is
refused **per member across all interventions**, not just within one. A person
cannot physically attend two incidents at the same moment, and allowing it would
double-count participation hours. If DVD Tivat ever needs a member logged
against two concurrent incidents, the `attendance_no_overlap` constraint is the
one place to change, and the reporting consequences need deciding first.

**Closing with open intervals** leaves them open. The intervention closes, the
audit entry records how many were open, and the intervals stay visible as
unfinished for correction. Nothing invents a checkout time.

`reported_started_at` / `reported_ended_at` exist for genuine back-entry, and
are deliberately never read by `attendance_totals()`.

## 7. Notification truth

`notification_outbox.state` moves only through:

```
QUEUED → SENT_TO_PROVIDER → PROVIDER_ACCEPTED → DEVICE_ACKNOWLEDGED
                          ↘ PROVIDER_REJECTED / FAILED / UNKNOWN
```

Publishing always writes an `IN_APP` row. Migration `202609150012` also writes
one `WEB_PUSH` row when that recipient has at least one active, non-expired
device subscription. The Edge Function claims that row atomically, sends the
same privacy-safe alert to each active device and records each provider attempt.
Provider acceptance still must not be displayed as "the member was notified":
it is separate from a device receipt, a human opening and a human answer.

`dedupe_key` is unique, so a retried fan-out cannot alert the same member twice.
The worker also claims a row only when its current state and attempt count still
match, so two simultaneous invocations cannot both send it. The Web Push worker
is deliberately bounded at two attempts: the immediate alert and one repeat
after 90 seconds, only while the member has not opened the intervention.
When an opening is found, the row receives `delivery_closed_at` and
`delivery_close_reason = 'MEMBER_OPENED'`; it no longer enters scheduled scans.
That closure is not described as a device delivery receipt — the authoritative
opening remains the separate `intervention_acknowledgements` row.

**The opening is checked before every attempt, including the first.** Review
found the check running only before a repeat, which left a real hole on the
recovery path: a `QUEUED` row whose immediate wake-up failed can sit for minutes
while the member opens the call-out through the in-app path, and the next
scheduled scan would then raise an alarm about something they were already
looking at.

`delivery_close_reason` is constrained to the reasons the schema recognises, so
a closure cannot be recorded for a reason nobody can audit later: `MEMBER_OPENED`,
and since `202609250032` `CALLOUT_NOT_OPEN` — the call-out ended before the alert
(or its repeat) went out — and, for rows no command writes, `SERVICE_MISMATCH` —
the alert's call-out and member are not in its service — and `NOT_A_RECIPIENT` —
its member is not on the call-out's recipient list. Each is set aside unsent and
without an attempt. A close time without a reason, or a reason without a time,
is rejected by the same constraint — half a record of a closure is not a record
of one. What an alert is about (call-out, member, channel, dedupe key, time
queued) is fixed once written, and a delivery attempt is never updated.

Whether a queued alert may still be sent is decided by
`push_delivery_verdict(outbox)`, a caller-rights function only the service role
may run. From the STORED alert, call-out, recipient list and member it answers,
first answer wins: `SERVICE_MISMATCH`; `NOT_A_RECIPIENT`; `OPENED`;
`CALLOUT_NOT_OPEN` unless the call-out is `PUBLISHED`, `ASSEMBLING`, `DEPLOYED` or
`CONTAINED` (a list of what may be sent: `close_intervention` changes the
call-out and nothing queued under it); `INELIGIBLE`; or `DELIVER` with the account
whose devices to use. Eligibility is asked in the service of the call-out — the
conditions of `is_eligible_recipient_in`, which the tests hold it to. The worker
holds the service role, which bypasses row-level security, so nothing else bounds
what it sends.

What the worker sweeps is `push_delivery_queue(accepted_before, claimed_before)`:
the open Web Push alerts that are **due** by the worker's clock — queued or
refused at once, accepted once its ninety-second repeat wait is over, claimed
once its worker is presumed dead after thirty — less any whose stored service
contradicts its call-out's. Both exclusions come before the worker's
fifty-alert limit: fifty alerts waiting out their repeat used to fill the sweep
and delay a call-out queued behind them by two scheduler runs. The worker passes
both instants from its own clock (policy.ts `dueCutoffs`, the same waits as
`holdForNow`); the database compares the stored time truncated to the
millisecond, as the worker reads it, so the two never disagree about a row. A
row whose label contradicts its call-out cannot be written by anybody but a
superuser with the triggers off, so the worker could neither send it nor set it
aside, and fifty of them at the front of the queue used to be every sweep there
was. It is left exactly as it is and counted instead —
`push_delivery_mislabelled(call-out)`, reported by the worker on every run
(`mislabelled`, and a warning in the function's log) until somebody repairs it.
The rest of what it applies — how long before a repeat, how many
attempts exist at all, what it does with each verdict, and exactly which three
fields may reach a locked screen — lives in
`supabase/functions/send-web-push/policy.ts` as pure functions, and its queries in
`deliver.ts`. They run in Deno in production and under Vitest in CI — the queries
against the test database, as the service role, through a PostgREST stand-in —
because a rule that decides whether a phone makes a noise at three in the morning
should not be reachable only by a live push service.

### Web Push subscription authority

`web_push_subscriptions` stores endpoint, public encryption key, authentication
secret and expiration per authenticated user. RLS lets an account with
operational standing in either service read only its own registrations. Inserts
and revocations are available only through `register_web_push_subscription()`
and `revoke_web_push_subscription()`; direct client writes are revoked.

A device belongs to the ACCOUNT. Registration requires a member record the
account may be called out as, asked in that record's own service
(`is_eligible_recipient_in`): active member, linked account, completed profile,
active access grant, and an operational membership in that service (or the
installation owner's grant). Somebody serving in both services registers once
and is reached as whichever member each call-out was sent to. The server worker
re-checks eligibility immediately before each send, per alert and in the service
of its call-out, so suspending an account — or withdrawing it from one service —
after publication stops an unsent or repeated alert. A subscription endpoint
already owned by another account cannot be claimed by a modified client.

The endpoint and key material never enter the notification payload or an error
message. The payload contains only intervention id and publication time. Title,
location and instructions are fetched after the application opens and RLS has
checked the signed-in account again.

## 8. Indexes

For the live board and the historical filters:

- `interventions(status, created_at desc)`
- `attendance_intervals(intervention_id, started_at)` and `(member_id, started_at desc)`
- a partial index on open attendance intervals and on open vehicle movements
- a partial index on pending outbox rows
- a partial index for queued/in-flight/accepted Web Push work

## 9. Timestamps

Everything is `timestamptz` and written with the server's `now()`. Display
converts to Europe/Podgorica in the client; the stored value stays canonical
UTC. No duration is ever computed from a formatted string.

## 10. Who may be called, and the chronology

Added 2026-09-13 by migrations `202609150008` and `202609150010`. Both additive.

### `is_eligible_recipient(member)`

True only for a member with an active roster record, a linked account, a
completed profile, an active grant, and a role of `OWNER`, `ADMIN`, `COMMANDER`
or `FIREFIGHTER`.

Those are exactly the conditions `current_dvd_role()` applies, and reusing them
is the point: **"can be called" and "can respond" cannot drift apart**. Before
this, `publish_intervention` filtered on `members.active` alone, so a roster row
still marked active passed even when the account behind it had been withdrawn.
The hosted preflight found one such member on the real project.

`publish_intervention` refuses the **whole** call-out if any requested recipient
is ineligible, rather than silently dropping them. A commander who selected five
people and got four must be told, not left to find out when somebody never
answers — and a modified client posting an ineligible id straight at the RPC
gets an error rather than a partial publication.

`eligible_recipients()` is the same rule as a list, for the picker. The screen
cannot offer somebody the server will refuse; the server refusing regardless is
what makes a modified client harmless.

**Command roles are eligible, deliberately.** In a volunteer society the
commander and the administrator turn out to incidents like everybody else.

### `intervention_audit(intervention)`

`operational_audit` has recorded every state transition and every journey step
since the schema was written. It had no reader, and one policy —
`is_dvd_command()` — so a member could not have read their own participation
history even if a screen had asked.

This function returns the recorded events with each actor resolved to a display
name (no e-mail address, no account id), to command or to a member who was
actually called to that intervention. Ordering is `occurred_at` then `id`,
because several events share a transaction time to the microsecond and an
archive whose lines shuffle between readings is not a record.

`202609150008` also adds `operational_audit_recipient_read`, **alongside** the
command policy rather than replacing it. PostgreSQL ORs permissive policies, so
command keeps reading everything and a recipient gains exactly their own
interventions. It is a SELECT policy only: no client holds INSERT, UPDATE or
DELETE on that table through any policy in any role, and the actor on every row
is `auth.uid()` recorded by the command that did the work.

Since `202609250033` audit history is append-only **as a rule**, not only by
privilege. `operational_audit`, `role_audit`, `account_status_audit`,
`organization_membership_audit` and `report_status_audit` refuse UPDATE and
DELETE (`AUDIT_APPEND_ONLY`), as `registry_audit` has since `202609240026`; and
none of them, nor `attendance_corrections`, can be truncated — TRUNCATE fires no
row trigger, which is where the earlier rules stopped. The one change an
`operational_audit` row still accepts is its own foreign keys' `ON DELETE SET
NULL` when a call-out or an account is deleted: recognised because it arrives
nested inside the referential action and only clears links. The row keeps its
service, wording and time. The service role reads these tables and writes none
of them; the `security definer` commands write every row. None of this binds the
superuser, which can disable a trigger — it makes rewriting history deliberate.

**A published call-out, and the history under it, stay** (`202609250034`, the
owner's rule of 2026-09-25; in review, not deployed). A published call-out is
closed or cancelled, never deleted. The migration does four things:

- `member_availability_history`, `intervention_journey_history` and
  `intervention_response_revisions` are append-only by the same functions:
  UPDATE, DELETE and TRUNCATE are refused. P2's organisation trigger on each
  still refuses a contradicting label first. The service role reads them and
  writes none of them; `set_own_availability_in`, `set_journey_progress` and
  `submit_response` write every row.
- An answer's revisions RESTRICT its deletion. The current answer in
  `intervention_responses` still changes, but the answer row itself cannot be
  deleted once it has a revision, and every answer has one.
- `interventions` refuses DELETE (`PUBLISHED_INTERVENTION_RETAINED`) for any
  call-out showing a trace of publication: a status past DRAFT/CANCELLED, a
  publisher, a recipient list, or the `INTERVENTION_PUBLISHED` audit row. It
  also refuses TRUNCATE.
- A draft, or a draft discarded before anybody was sent it, is still deleted.
  Its audit rows stay, detached by the SET NULL above.

No command deletes a call-out, an answer or any history. Removing such rows,
for example demo data, is an exceptional purge by a superuser, outside the
application and decided separately.

**What an answer, a journey step and an availability are about is settled
when they are written** (`202609250035`; in review, not deployed). The
current answer, journey step and availability are state whose history is
append-only. They now keep what they are about:

- An answer keeps its id, call-out, member, service and first-answered time
  (`RESPONSE_IDENTITY_FIXED`). `submit_response()` revises only the answer,
  ETA, direct-travel flag, `updated_at` and revision number. The answer's
  service is fixed and each revision is checked against it when written, so
  an answer and its revisions never carry different services.
- The current journey step keeps its call-out, member and service
  (`JOURNEY_IDENTITY_FIXED`). The current availability keeps its member and
  service (`AVAILABILITY_IDENTITY_FIXED`).
- An answer is removed only with its call-out (`RESPONSE_RETAINED`; no
  TRUNCATE). A published call-out therefore keeps every answer, including one
  that has no revision; an answer is only ever written that way from outside
  `submit_response()`.

Each rule runs after P2's label check, which still refuses a contradicting
label first.

## 11. Realtime

`202609150009` adds eight operational tables to the `supabase_realtime`
publication. The block is guarded and is a **no-op** where the publication is
absent — which is the plain PostgreSQL the tests run against — or where the role
may not alter it.

The client treats a change notice as one thing only: "something you care about
may have moved". It never reads the payload; the response is always to re-read
through the ordinary policy-checked queries. So a notice can never show anybody
a row they could not already read, and where no notice arrives the client polls
in the foreground instead. `REPLICA IDENTITY` is deliberately left at the
default: the old row would only matter to a client that read payloads.

## 12. Web Push deployment boundary

The migration and Edge Function being present in this repository does not make
the hosted transport active. The function must be deployed, VAPID and worker
secrets must be set server-side, the public VAPID key must be added to the Pages
build, and a one-minute scheduled invocation must be configured for the single
unacknowledged repeat. Exact setup and the physical-device acceptance are in
[DEMO_RUNBOOK.md](./DEMO_RUNBOOK.md).

## 13. Not built yet

Stated as a boundary rather than a list of absences, because the interesting part
is where "built" stops and "usable" starts.

This section was stale and is corrected here rather than quietly rewritten:
the commander, firefighter and archive screens already run against the real
database. Migration `202609150012` is new in this branch and is not described as
hosted until its application and fingerprint are independently verified.

**Genuinely not built:**

- The separate `Clanovi` prototype screen is **still fictional browser state**
  and is not the same thing as `Evidencija drustva`. Two screens show members
  and only one of them touches the database.
- No CSV export. The `attendance_totals()` function is the query it would use;
  the export itself, with its formula-injection escaping, is not written.
- No `intervention_updates` write command (the table and its read policy exist).
- No seed file of fictional data for a real project.
- No guaranteed alarm transport that can override a phone's sound, Focus or
  battery policy. Web Push is best-effort and must pass the physical-device
  matrix before operational use.
