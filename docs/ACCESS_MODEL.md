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

`public.current_account_status()` reports `SUSPENDED` / `PROFILE_REQUIRED` /
`ACTIVE` for the interface. It is never used for authorisation, and an anonymous
caller cannot execute it at all.

## 3. Roles

| Role | May |
|---|---|
| **OWNER** | Everything below, plus: read every account, assign `ADMIN`/`COMMANDER`/`FIREFIGHTER`/`PENDING`, suspend and restore access, read the role and status audit |
| **ADMIN** | Read operational data; manage organisational records. **Cannot** assign roles or create an owner |
| **COMMANDER** | Create, publish, update, change status of, close and cancel interventions; see responses and attendance; check members in and out; correct attendance with a reason |
| **FIREFIGHTER** | See interventions addressed to them; respond; check themselves in and out; request a correction of their own record |
| **PENDING** *(default)* | Nothing operational at all |
| **CITIZEN** *(legacy)* | Nothing operational at all. Retained only so rows written by the first migration stay valid |

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

Deliberately manual and one-time. After the owner's account exists and its
profile is complete, an operator with database access runs:

```sql
update public.access_grants set role = 'OWNER' where user_id = '<the exact auth.users uuid>';
```

Recovery uses the same statement. There is no in-application path to owner, by
design. **Open owner decision:** whether a documented second break-glass owner
is wanted; a multi-owner design needs the single-owner index relaxed and a
separate review.

## 4. What the roles *cannot* do

Enforced and tested:

- an `ADMIN` or `COMMANDER` calling `owner_set_role` → `OWNER_REQUIRED`;
- a `FIREFIGHTER` promoting themselves → `OWNER_REQUIRED`;
- a `FIREFIGHTER` publishing, changing status, or correcting attendance → `COMMAND_REQUIRED`;
- a `FIREFIGHTER` checking somebody else in or out → `COMMAND_REQUIRED`;
- an unapproved account reading the roster, an intervention, or attendance → zero rows;
- an anonymous caller reading anything in the operational schema → `permission denied`.

## 5. Writes are impossible from a client

**RLS grants reads only.** Every operational write goes through a
`security definer` function, so there is no direct `INSERT`/`UPDATE` path a
client could use to forge a fact:

| Command | Authority required |
|---|---|
| `publish_intervention` | command |
| `set_intervention_status` | command |
| `close_intervention` | command |
| `submit_response` | the authenticated member, and only if they are a recipient |
| `attendance_check_in` / `_out` | self (staff), or command acting for somebody else |
| `attendance_correct` | command, with a reason |
| `owner_set_role` / `owner_set_account_active` | owner, with a reason for status changes |

The one direct write a member has is inserting an
`attendance_correction_requests` row **for their own interval** — which changes
no operational fact by itself.

Tested by *"direct writes are impossible"*: inserting an intervention, forging
an attendance record, editing a response and deleting from the audit trail are
all refused with `permission denied`.

Every function is `security definer` with a fixed `search_path` and explicit
`revoke from public` / `grant execute to authenticated`. `anon` holds nothing.

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

Nine separate records, in schema, in the interface and in tests:

1. a commander **published** an intervention → `interventions.status`
2. the server **queued** a notification → `notification_outbox.state = 'QUEUED'`
3. a provider **accepted or rejected** it → `notification_delivery_attempts`
4. a device **acknowledged** receipt → `notification_outbox.state`
5. a member **opened** it → `intervention_acknowledgements`
6. a member **stated an intention** → `intervention_responses`
7. a member **actually attended** → `attendance_intervals`
8. a vehicle **departed** → `vehicle_movements`
9. command **changed the status** → `interventions.status`

Tested: publishing creates a `QUEUED` outbox row **and nothing else** — no
response, no acknowledgement, no attendance, no delivery attempt. Answering
`DOLAZIM` creates **no** attendance. A vehicle departure creates **no**
attendance.

Nothing in this system may report `delivered`. There is no notification
transport, and the outbox cannot leave `QUEUED` without one.

## 8. Not enforced yet

Honest list of what this slice does **not** do:

- **No application code uses any of this.** The browser prototype still runs on
  device-local state with a simulated actor selector. The schema is verified;
  the client is not connected to it.
- **No Supabase project exists.** The migrations have never been applied to a
  hosted database — only to PostgreSQL 16, locally and in CI.
- **Registration, verification and password reset are not proven.** They need a
  real project and configured email; see the blockers in
  `docs/ai/PROJECT_STATE.md`.
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
