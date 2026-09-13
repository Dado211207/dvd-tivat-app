# Access model

The account, role and row-level-security contract for the DVD Tivat internal
operations system.

Every statement here is executed by the integration suite in `db-tests/`. Where
something is *not* enforced yet, it says so.

---

## 1. Identity

Identity is the immutable authenticated user id (`auth.users.id`). A name or an
email address is display and contact data and never carries authority.

Two separate records exist on purpose:

| Record | What it is | Authority |
|---|---|---|
| **Account** (`profiles` + `access_grants`) | Somebody who can sign in | Carries the role |
| **Member** (`members`) | An operational person in the society | Carries none |

They are linked by `members.user_id`, which is nullable. DVD Tivat has 52
members and not all of them need an account; equally, an account with no member
record cannot be called out or check in. Authority is always read from the
account, never from the member row.

## 2. The role contract

`public.current_dvd_role()` is the single source of authority. It returns a role
**only** when all of these hold:

1. the caller is authenticated;
2. the account's grant is `active`;
3. the profile is `profile_complete`;
4. the granted role is one of `OWNER`, `ADMIN`, `COMMANDER`, `FIREFIGHTER`.

Anything else returns `NULL`. `PENDING` and `CITIZEN` deliberately resolve to
`NULL` rather than to their own names, so "no internal role" is one unambiguous
value that a policy written later cannot mistake for a role.

Everything else (`is_dvd_staff()`, `is_dvd_command()`, `is_dvd_owner()`) is
derived from that one function, so the rule lives in exactly one place.

> **Fixed here.** The previous version of `current_dvd_role()` checked neither
> `active` nor `profile_complete`. A suspended or half-registered account kept
> its privileges. Tested by *"gives a SUSPENDED account no role"* and *"gives an
> account with an incomplete profile no role"*.

### Identity is not separable from authority

`public.current_member_id()` answers a different question — *which member is
acting* — and it now requires the same effective role:

```sql
select member_row.id from public.members member_row
where member_row.user_id = auth.uid()
  and member_row.active = true
  and public.current_dvd_role() is not null
```

Both conditions matter and they are not the same thing. `members.active` is
whether **the society** still counts this person as a member.
`current_dvd_role()` is whether **the account** still has standing. A person can
be on the roster while their account is suspended, and that account must then be
nobody operationally.

> **Fixed here, and it was live on the hosted project.** Until `202609130006`
> the function checked only `members.active`. Identity therefore **survived the
> loss of authority**: a `SUSPENDED`, `PENDING` or incomplete-profile account
> whose linked member was on an intervention's recipient list could still
>
> - read rows through the seven policies that route identity through this
>   function — `interventions` (recipient read), `intervention_updates`,
>   `intervention_recipients`, `intervention_responses`,
>   `intervention_acknowledgements`, `attendance_intervals` and
>   `notification_outbox`;
> - **answer a call-out**, because `submit_response` checks only that
>   `current_member_id()` is not NULL;
> - close its own attendance interval through `attendance_check_out`.
>
> Nothing reached it through the application — no screen reads any of this from
> the server — so it was a schema defect, not a live exposure. It still
> contradicted what this project documents about suspension, and the
> member-facing screen is the next slice.
>
> **It was found by a test, not by reading.** `db-tests/authority_matrix.test.ts`
> calls every command as every account state instead of the states somebody
> thought to try, and reported that a suspended account could acknowledge an
> intervention and could read 51 attendance intervals. Three tests now pin the
> fix from different angles, one pins that it did **not** over-tighten (an
> approved recipient still sees their own call-out), and reverting the one-line
> fix fails all three.

`public.current_account_status()` reports `SUSPENDED` / `PROFILE_REQUIRED` /
`ACTIVE` for the interface. It is never used for authorisation, and an anonymous
caller cannot execute it at all.

## 3. Roles

| Role | May |
|---|---|
| **OWNER** | Everything below, plus: read every account, assign `ADMIN`/`COMMANDER`/`FIREFIGHTER`/`PENDING`, suspend and restore access, read the role and status audit |
| **ADMIN** | Manage organisational records — members, groups, vehicles and the account-to-member link (`is_dvd_admin()`). **Also holds full command authority, by explicit owner decision** — see the note below. **Cannot** assign roles, suspend or restore access, or create an owner |
| **COMMANDER** | Create, publish, update, change status of, close and cancel interventions; see responses and attendance; check members in and out; correct attendance with a reason; confirm, reject and withdraw confirmation of attendance |
| **FIREFIGHTER** | See interventions addressed to them; respond; check themselves in and out; request a correction of their own record; record a vehicle departure and return |
| **PENDING** *(default)* | Nothing operational at all |
| **CITIZEN** *(legacy)* | Nothing operational at all. Retained only so rows written by the first migration stay valid |

> ### ADMIN holds command authority — an explicit owner decision, not an accident
>
> **Decided by the owner on 12 September 2026.** `ADMIN` retains full command
> authority in the current product model. This is a deliberate design choice,
> recorded so nobody later reads it as an oversight and "fixes" it.
>
> `is_dvd_command()` resolves `('OWNER', 'ADMIN', 'COMMANDER')`, so an
> administrator can publish a call-out, check members in and out, correct
> attendance, and confirm, reject or withdraw confirmation of it.
>
> **The owner's reasoning, in their own terms:**
>
> - DVD Tivat is a relatively small volunteer organisation.
> - The current account model assigns **one effective role per account**.
> - A person responsible for administration may also need to act operationally.
> - Removing command authority from `ADMIN` would stop that person serving both
>   functions without first introducing a multi-role or capability model.
> - `OWNER` remains the only role that may assign roles, or suspend and restore
>   access.
>
> **The separation of duties therefore runs in one direction, on purpose:**
>
> | | May run call-outs | May manage the society's records | May assign roles and suspend accounts |
> |---|---|---|---|
> | `OWNER` | Yes | Yes | **Yes — only this role** |
> | `ADMIN` | **Yes** | Yes | No |
> | `COMMANDER` | Yes | **No** (`ADMIN_REQUIRED`) | No |
> | `FIREFIGHTER` | No (`COMMAND_REQUIRED`) | No | No |
>
> A `COMMANDER` is refused the roster commands; an `ADMIN` is **not** refused the
> command ones. That asymmetry is the decision.
>
> Pinned by `db-tests/authority_matrix.test.ts`, which asserts the ADMIN cell of
> every command, so the documented model and the enforced model cannot drift
> apart. Changing this is a schema change plus a matrix change, and both would
> fail loudly if only one were done.
>
> **Future design note, not a plan.** If DVD Tivat ever needs a *clerical*
> administrator — somebody who maintains the roster but must **not** receive
> operational command authority — then a multi-role or capability model becomes
> worth considering, because the one-role-per-account model cannot express it.
> That is explicitly **out of scope for this slice** and needs its own owner
> decision, covering how a second role is assigned, how the audit records it,
> and what the interface shows. Do not build it speculatively.

### Owner protections

- Exactly one owner, enforced by a **partial unique index**
  (`access_grants_single_owner`) — not by application code that could be
  forgotten. Tested by *"refuses a second OWNER at the database level"*.
- `OWNER` is never assignable through `owner_set_role`. Tested.
- The owner cannot change their own role or their own access, so they cannot
  lock themselves out. Tested.
- The owner role is **never** derived from registration metadata, "first user"
  logic, or anything a browser can send.

### Owner bootstrap and recovery

Deliberately manual and one-time, in the Supabase dashboard. The full procedure,
written for somebody who is not a developer, is
[OWNER_BOOTSTRAP.md](./OWNER_BOOTSTRAP.md) — including what the single-owner
index's rejection looks like and how to transfer ownership without ever leaving
the system with two owners or none.

That document is not merely checked, it is **executed**: `db-tests/bootstrap.test.ts`
reads the SQL out of the markdown and runs it against a schema built from zero.
A runbook that has quietly stopped working is worse than no runbook, because the
person following it concludes the system is broken rather than the instructions.

There is no in-application path to owner, by design. Whoever controls the
Supabase dashboard controls this system, which is stated in the runbook rather
than left for somebody to work out.

**Owner decision, recorded:** exactly one owner, no documented second break-glass
owner (blocker B6). A multi-owner design needs the single-owner index relaxed and
its reporting and audit consequences decided first.

## 4. What the roles *cannot* do

Enforced and tested:

- an `ADMIN` or `COMMANDER` calling `owner_set_role` → `OWNER_REQUIRED`;
- a `FIREFIGHTER` promoting themselves → `OWNER_REQUIRED`;
- a `FIREFIGHTER` publishing, changing status, or correcting attendance → `COMMAND_REQUIRED`;
- a `FIREFIGHTER` checking somebody else in or out → `COMMAND_REQUIRED`;
- a `FIREFIGHTER` **or a `COMMANDER`** creating, editing or deactivating a
  member, group or vehicle, or linking an account to a member → `ADMIN_REQUIRED`.
  Command authority runs call-outs; it does not edit who is in the society;
- a `FIREFIGHTER` drafting, editing or discarding an intervention → `COMMAND_REQUIRED`;
- a `FIREFIGHTER` confirming, rejecting or unconfirming attendance — **including
  their own** → `COMMAND_REQUIRED`. Declaring your presence and vouching for it
  cannot be the same act by the same person;
- a member acknowledging an intervention they were not called to → `NOT_A_RECIPIENT`;
- an unapproved account recording a vehicle movement → `STAFF_REQUIRED`;
- an unapproved account reading the roster, an intervention, or attendance → zero rows;
- a **`SUSPENDED`, `PENDING` or incomplete-profile** account acknowledging,
  checking in, checking out, or recording a vehicle movement → `STAFF_REQUIRED`,
  **even when its linked member is on the recipient list**. Being addressed is
  not standing;
- an approved account with **no linked member record** acting as a member →
  `MEMBER_RECORD_REQUIRED`, which is a different refusal from the one above and
  deliberately worded differently: one has lost standing, the other never had
  an operational identity;
- an anonymous caller reading anything in the operational schema → `permission denied`,
  including every command added by `202609120005` and `202609130006`.

Every line above is one cell of
[`db-tests/authority_matrix.test.ts`](../db-tests/authority_matrix.test.ts),
which runs **eleven commands against ten account states** and declares an
expectation for all 110. The point of generating the cases rather than choosing
them is that a state nobody thought to try still gets tried: that is how the
`current_member_id()` defect above was found, after a hand-written suite had
passed over it a hundred and sixty times.

## 5. Writes are impossible from a client

Two independent layers have to agree before anything is written.

**Layer one: privileges.** `authenticated` holds `SELECT` on every table and
`INSERT` on exactly three — the three that have an `INSERT` policy. It holds no
`UPDATE`, no `DELETE` and no `TRUNCATE` anywhere. `anon` holds nothing at all:
no table privilege, and no `EXECUTE` on any function this project defines.

**Layer two: row level security.** Enabled on every table, with `SELECT`
policies only apart from those same three inserts, so even a privilege granted
by mistake yields no rows.

> **Fixed here.** A Supabase project ships with
> `alter default privileges in schema public grant all on tables to anon,
> authenticated, service_role`, so every table these migrations create arrived on
> the hosted project with `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` already
> granted to `authenticated`. `202609090002` revoked them from `anon` but for
> `authenticated` only *added* `select`, because on a bare PostgreSQL instance
> the write privileges were never there to take. Layer one was therefore missing
> on the real platform, and **row level security does not apply to `TRUNCATE`** —
> a signed-in account with no role at all could empty a table. `DELETE` and
> `UPDATE` were still filtered to zero rows by the policies, so no data was ever
> reachable through the REST API, which does not expose `TRUNCATE` either.
> `202609110003` restores layer one; `202609110004` removes the PUBLIC `EXECUTE`
> grant that `anon` was riding on. Both are asserted by
> *"client roles hold only the privileges their policies need"*, which reads the
> grants themselves rather than trusting the statements that wrote them.

Every operational write goes through a `security definer` function, so there is
no direct `INSERT`/`UPDATE` path a client could use to forge a fact:

| Command | Authority required |
|---|---|
| `create_intervention_draft` / `update_intervention_draft` / `discard_intervention_draft` | command |
| `admin_create_member` / `admin_update_member` / `admin_set_member_active` | admin |
| `admin_link_member_account` / `admin_unlink_member_account` | admin |
| `admin_create_group` / `admin_rename_group` / `admin_set_group_active` / `admin_set_group_members` | admin |
| `admin_create_vehicle` / `admin_update_vehicle` / `admin_set_vehicle_active` | admin |
| `publish_intervention` | command |
| `set_intervention_status` | command |
| `close_intervention` | command |
| `submit_response` | the authenticated member, and only if they are a recipient |
| `attendance_check_in` / `_out` | self (staff), or command acting for somebody else |
| `attendance_correct` | command, with a reason. **Does not confirm** |
| `attendance_confirm` | command. Stands behind the record; a note is optional |
| `attendance_reject` | command, with a reason |
| `attendance_unconfirm` | command, with a reason. Returns the record to pending |
| `acknowledge_intervention` | the authenticated recipient. Opening is not responding |
| `record_vehicle_departure` / `record_vehicle_return` | staff |
| `owner_set_role` / `owner_set_account_active` | owner, with a reason for status changes |

The one direct write a member has is inserting an
`attendance_correction_requests` row **for their own interval** — which changes
no operational fact by itself.

Tested by *"direct writes are impossible"*: inserting an intervention, forging
an attendance record, editing a response and deleting from the audit trail are
all refused with `permission denied`.

Every function is `security definer` with a fixed `search_path` and explicit
`revoke from public` / `grant execute to authenticated`.

**Administrative authority is not command authority.** A `COMMANDER` publishes
call-outs and is refused every roster command with `ADMIN_REQUIRED`, as firmly as
a firefighter is. That distinction was stated in the table above long before it
had a predicate to stand on; `is_dvd_admin()` is now that predicate, and
*"refuses a COMMANDER too, because command is not roster authority"* is the test.

**Nothing is deleted.** Members, groups and vehicles are deactivated with a
recorded reason, never removed — a member who left in 2024 must still resolve on
the attendance record of an intervention they attended in 2023. A discarded draft
becomes `CANCELLED` for the same reason. This is also what keeps the promise
above that no client role holds `DELETE` anywhere.

> **Caught here.** `organisation_audit` was created holding `INSERT`, `UPDATE`,
> `DELETE` and `TRUNCATE` for `authenticated`, because Supabase's default
> privileges grant them to every new table and the migration initially only
> *added* `select` on top — the identical mistake `202609110003` exists to
> correct. *"never grants a client role a privilege with no policy behind it"*
> failed on the first run of the new migration. The stub reproducing the
> platform's default grants is the only reason that was visible locally.

The command functions being callable by `authenticated` is the design, not an
oversight: they *are* the write surface, and each one begins with its own
authority check (`COMMAND_REQUIRED`, `OWNER_REQUIRED`, `NOT_A_RECIPIENT`, …)
evaluated against `auth.uid()`. Supabase's linter reports them as
"signed-in users can execute a `security definer` function" and that report is
accurate; it is what a server-side command model looks like.

## 6. Who can see an intervention

| Viewer | `DRAFT` | Published |
|---|---|---|
| Command | yes | yes |
| A member on the frozen recipient list | no | yes |
| A member not on that list | no | **no** |
| Unapproved / anonymous | no | no |

This is what keeps incident locations from leaking. A draft is not a call-out,
so it is command-only.

**Product decision, recorded rather than left implicit:** every member called to
the same intervention can see the other recipients' responses and the attendance
board for it. That is how a crew coordinates. If DVD Tivat wants responses
visible only to command, the `responses_recipient_read` and
`attendance_recipient_read` policies are the two places to change.

## 7. Facts that are never inferred from each other

**Ten** separate records, in schema, in the interface and in tests. It was nine
until `202609130006` split the last attendance fact in two, which is the whole
subject of [DATABASE.md §6](./DATABASE.md#6-attendance--the-primary-capability):

1. a commander **published** an intervention → `interventions.status`
2. the server **queued** a notification → `notification_outbox.state = 'QUEUED'`
3. a provider **accepted or rejected** it → `notification_delivery_attempts`
4. a device **acknowledged** receipt → `notification_outbox.state`
5. a member **opened** it → `intervention_acknowledgements`
6. a member **stated an intention** → `intervention_responses`
7. a member **says they attended** → `attendance_intervals`, `source =
   'SELF_DECLARED'`, pending
8. **command stands behind that claim** → the same row, `verified = true`
9. a vehicle **departed** → `vehicle_movements`
10. command **changed the status** → `interventions.status`

Facts 7 and 8 are the pair that was previously collapsed into one, and
collapsing them is what let a self-declared claim be reported as participation.

Tested: publishing creates a `QUEUED` outbox row **and nothing else** — no
response, no acknowledgement, no attendance, no delivery attempt. Answering
`DOLAZIM` creates **no** attendance. Opening creates **no** response and no
attendance. A vehicle departure creates **no** attendance. A self-declared
interval contributes **nothing** to `confirmed_seconds` until command confirms
it, and a rejected one contributes nothing ever.

Nothing in this system may report `delivered`. There is no notification
transport, and the outbox cannot leave `QUEUED` without one.

## 8. Not enforced yet

Honest list of what this slice does **not** do:

- **Nothing is ever sent to anybody.** Publishing a call-out writes rows saying
  a message is *owed* to each recipient. There is no push, email, SMS, Viber or
  telephone transport in this application, so a member learns about a call-out
  only by opening the application. **No screen may say a member was notified**,
  and the interface says the opposite where it matters — the publish
  confirmation and the banner on every server-backed screen.
- ~~No screen is connected to interventions, responses, vehicle movements or
  attendance.~~ **Resolved 2026-09-13.** `poziv`, `mobilizacija` and `arhiva`
  read and write the hosted project through the same commands this file
  specifies. All seven migrations are applied there and fingerprint-verified.
  What remains on device-local fictional state is the earlier prototype
  (`dezurni`, `clan`, `vozila`, `prikaz`, `clanovi`, `istorija`), which carries a
  banner saying so on every one of those screens.
- **There is no offline queue.** An action taken with no signal is refused and
  the interface says so. Storing it silently and sending it later - without the
  person knowing which of the two happened - would be worse than refusing.
- **A member with no linked account cannot answer a call-out.**
  `current_member_id()` returns NULL for them, so `submit_response` refuses with
  `MEMBER_RECORD_REQUIRED`. This is correct behaviour and it is now visible: the
  roster screen marks every such member rather than leaving it to be discovered
  during an incident.
- **Password reset is not implemented**, and is shown as unavailable with the
  reason rather than offered as a form that would send nothing. It needs a
  configured mail provider (blocker B2).
- **Email confirmation: the decision and the current setting are different
  things, and only one of them is known.**

  | | |
  |---|---|
  | **Decided** (blocker B2) | "Confirm email" is to be **off** for now, so an approved account is usable without a mail round-trip |
  | **Actually set on the project** | **Unverified.** `GET /auth/v1/settings` read `"mailer_autoconfirm": false` (confirmation **ON**) on 11 September; `true` (**OFF**) was reported on 12 September. It may simply have been changed between the two |

  So **nothing here may claim that registration immediately yields a usable
  session.** That depends on a dashboard setting nobody has confirmed and on a
  real sign-up flow that has never been exercised end to end. Both observations
  are recorded in
  [ai/PROJECT_STATE.md](./ai/PROJECT_STATE.md) under Owner action items; the
  answer belongs there once somebody reads the dashboard.
- **`btree_gist` is installed in the `public` schema**, which Supabase's linter
  flags (`extension_in_public`, WARN). Its functions take `internal` arguments
  and cannot be called through the REST API, so this is namespace hygiene rather
  than an exposure. Remediation, when it is worth a migration:
  `alter extension btree_gist set schema extensions;` — the exclusion
  constraints reference the operator classes by OID and keep working.
- **Session invalidation for a suspended account is not implemented.**
  Suspension removes the role immediately, so every policy and command refuses
  the caller on their next request — but any already-issued JWT stays
  syntactically valid until it expires. Closing that gap needs the real project.
- **Storage upload handling, EXIF stripping and byte-signature validation** are
  not implemented. The bucket and its policies exist; the pipeline does not.
- The Supabase platform surface used by the tests is emulated
  (`supabase/tests/00_supabase_stub.sql`). It reproduces `auth.uid()` from JWT
  claims, the three database roles, and the storage helpers — it does not
  reproduce GoTrue, the API gateway, or realtime.
