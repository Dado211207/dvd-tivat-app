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
6. `supabase/migrations/202609120005_organisational_writes.sql`.

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

`202609110003` and `202609110004` exist because of a defect only a real project
could reveal; both are explained in
[ACCESS_MODEL.md §5](./ACCESS_MODEL.md#5-writes-are-impossible-from-a-client).
`202609120005` is not part of that repair — it closes a different gap, that the
schema could publish a call-out but nothing could create one.

## 3. The real Supabase project

**Partially applied, and the gap matters.**

| Migration | On the hosted project |
|---|---|
| `202609090001` · `202609090002` · `202609110003` · `202609110004` | **Applied**, in order |
| `202609120005_organisational_writes.sql` | **Not applied** |

The first four were applied to the owner's project (`dvd-tivat-app`, region
`eu-central-1`, PostgreSQL 17), whose `public` schema was empty beforehand.

**The hosted schema is therefore behind this branch.** Every function
`202609120005` defines — the three intervention-draft commands, the member,
group and vehicle commands, `admin_link_member_account`, `is_dvd_admin()` — and
the `organisation_audit` table do not exist there. Calling any of them against
the hosted project fails. Applying it is a deliberate, owner-authorised step that
has not been taken.

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
before `202609120005` existed and says nothing about the five-migration schema
this branch builds. It is not evidence that the hosted project matches this
branch — it currently does not.

Do **not** apply `supabase/tests/00_supabase_stub.sql` to a real project. It
would collide with the platform's own `auth` and `storage` schemas.

CI cannot reach the hosted project — that would need a secret in CI, which this
repository deliberately does not have — so the local PostgreSQL suite remains the
authoritative automated evidence. Nothing here claims CI tested the live project.

## 4. What the schema keeps separate

The nine facts in [ACCESS_MODEL.md §7](./ACCESS_MODEL.md#7-facts-that-are-never-inferred-from-each-other)
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
  recorded_by, verified, verified_by, verified_at
)
```

Rules, each enforced by the database and tested:

| Rule | How |
|---|---|
| Several intervals per member per intervention | No unique constraint; people leave and come back |
| No interval ends before it starts | `check (ended_at is null or ended_at > started_at)` |
| **A member is never in two places at once** | `exclude using gist` on `(member_id, tstzrange(started_at, coalesce(ended_at,'infinity')))` |
| Duration is never stored | `attendance_totals()` sums closed intervals only |
| An open interval is visible as open | `attendance_totals()` returns `open_intervals` separately and contributes 0 seconds |
| Correction needs a reason | `attendance_correct()` refuses `REASON_REQUIRED` |
| Before and after are preserved | `attendance_corrections` holds both as `jsonb`, plus actor and time |
| A correction cannot create an overlap | Exclusion constraint, surfaced as `CORRECTION_WOULD_OVERLAP` |
| Closing with open intervals is never silent | `OPEN_ATTENDANCE_INTERVALS:<n>` unless command passes `allow_open_attendance` |

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
- The separate `Clanovi` prototype screen is **still fictional browser state**
  and is not the same thing as `Evidencija drustva`. Two screens now show
  members and only one of them touches the database.
- No CSV export. The `attendance_totals()` function is the query it would use;
  the export itself, with its formula-injection escaping, is not written.
- No `intervention_updates` write command (the table and its read policy exist).
- No seed file of fictional data for a real project.
- No general availability, no journey progress, no notification transport.
