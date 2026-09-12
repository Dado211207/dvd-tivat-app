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
7. `supabase/migrations/202609130006_attendance_truth.sql`.

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

**Partially applied, and the gap matters.**

| Migration | On the hosted project |
|---|---|
| `202609090001` · `202609090002` · `202609110003` · `202609110004` | **Applied**, in order |
| `202609120005_organisational_writes.sql` | **Not applied** |
| `202609130006_attendance_truth.sql` | **Not applied** |

The first four were applied to the owner's project (`dvd-tivat-app`, region
`eu-central-1`, PostgreSQL 17), whose `public` schema was empty beforehand.

**The hosted schema is therefore two migrations behind this branch.** Every
function `202609120005` defines — the three intervention-draft commands, the
member, group and vehicle commands, `admin_link_member_account`,
`is_dvd_admin()` — and the `organisation_audit` table do not exist there.
Neither does anything from `202609130006`: the attendance confirmation commands,
the `source` and rejection columns, `acknowledge_intervention`, the vehicle
movement commands, or the new `attendance_totals()` shape. Calling any of them
against the hosted project fails. Applying them is a deliberate,
owner-authorised step that has not been taken.

**The hosted project still has the attendance defect.** Its
`attendance_totals()` is the original version with no `verified` filter, so on
that database a self-declared claim would still be summed as participation.
Nothing reads it there yet — no screen uses attendance against the server — but
it is the reason to apply `202609130006` rather than leave it pending
indefinitely.

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

Publishing writes `QUEUED` and nothing else. There is no transport, so no row
can currently leave `QUEUED`, and nothing in the system may say "delivered".
Provider outcomes live in `notification_delivery_attempts`, one row per attempt,
kept separate from whether a human opened or answered anything.

`dedupe_key` is unique, so a retried fan-out cannot alert the same member twice.
`attempt_count` is capped at 10, so retries are bounded.

## 8. Indexes

For the live board and the historical filters:

- `interventions(status, created_at desc)`
- `attendance_intervals(intervention_id, started_at)` and `(member_id, started_at desc)`
- a partial index on open attendance intervals and on open vehicle movements
- a partial index on pending outbox rows

## 9. Timestamps

Everything is `timestamptz` and written with the server's `now()`. Display
converts to Europe/Podgorica in the client; the stored value stays canonical
UTC. No duration is ever computed from a formatted string.

## 10. Not built yet

Stated as a boundary rather than a list of absences, because the interesting part
is where "built" stops and "usable" starts.

**Built and tested on merged `main`, but not yet activated on the hosted project:**

- Admin write commands for `members`, `groups`, `group_members` and `vehicles`,
  the account-to-member link, the three intervention-draft commands, the
  `is_dvd_admin()` predicate and the `organisation_audit` trail — all in
  `202609120005`, covered by `db-tests/organisation.test.ts`.
- The server-backed `Evidencija drustva` screen that drives them.
- **None of it exists on the hosted project**, because `202609120005` is not
  applied there. See §3.

**Genuinely not built:**

- **No screen publishes a real call-out.** The draft commands exist; the
  dispatcher screen still writes device-local state.
- **No screen uses any of `202609130006`.** Confirmation, rejection,
  acknowledgement and vehicle movements are server commands with tests and no
  interface. The vehicles and attendance screens are still device-local.
- The separate `Clanovi` prototype screen is **still fictional browser state**
  and is not the same thing as `Evidencija drustva`. Two screens now show
  members and only one of them touches the database.
- No CSV export. The `attendance_totals()` function is the query it would use;
  the export itself, with its formula-injection escaping, is not written.
- No `intervention_updates` write command (the table and its read policy exist).
- No seed file of fictional data for a real project.
- **No general availability and no journey progress.** Both are designed in
  [ai/PROJECT_STATE.md](./ai/PROJECT_STATE.md) and neither has a migration yet.
- No notification transport.
