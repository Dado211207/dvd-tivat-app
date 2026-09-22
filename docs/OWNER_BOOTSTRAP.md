# Owner bootstrap

How the first (and only) owner account is created.

This is deliberately a manual, one-time job done in the Supabase dashboard. **The
application has no path to owner and never will** — no button, no hidden screen,
no setting, no "first account becomes owner" rule, and no field in the sign-up
form that a browser could send. If there were one, the most powerful role in the
system would be reachable by whoever found it first.

You do not need to be a developer to follow this. Every command is written out
in full; you copy it, change one thing, and press Run.

---

## Before you start

You need:

- **the Supabase dashboard** for the project, signed in as its owner;
- **the application running**, with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` filled in (copy `.env.example` to `.env.local`
  and fill in the two values from **Project Settings → API**);
- **five minutes**, once.

One setting to read first, in **Authentication → Sign In / Providers → Email**:

> The owner decision is that **Confirm email should be off for now**, but the
> project's current setting is not independently confirmed. Read the dashboard
> value and record it under blocker **B2** in
> [ai/PROJECT_STATE.md](./ai/PROJECT_STATE.md). If it is on, change it only if
> you are following that recorded owner decision.
>
> With confirmation on, Supabase tries to send a message. Its built-in sender is
> restricted and rate limited, so an ordinary member may not receive it.
> Registration must not be described as producing an immediately usable session
> until both the dashboard setting and one real deliverable-email flow have been
> verified. A proper mail provider is still required before confirmation can be
> enabled for real use at scale.

---

## Step 1 — Create your account in the application

Open the application, go to **Nalozi i pristup**, choose **Nemam nalog**, and
register with your email address and a password of at least 12 characters.

## Step 2 — Finish your profile

The application will ask for your name. Enter it and save.

**Do not skip this.** The server only recognises a role on an account whose
profile is complete, so an owner grant on an unfinished profile does nothing at
all — and it looks exactly like the grant failing, which is a confusing hour to
spend.

At this point the screen says your account is waiting for approval and has no
rights. That is correct: every new account starts with none.

## Step 3 — Find your account id

In the dashboard, open **SQL Editor → New query**, paste this, and press **Run**:

```sql
select id, email, created_at
from auth.users
order by created_at desc;
```

Find your own email in the result. You do not need to copy the id — the next
step looks it up by email — but seeing it confirms the account exists.

## Step 4 — Make yourself the owner

Paste this into the SQL editor. **Change the email address on the marked line to
your own**, and change nothing else:

```sql
update public.access_grants
set role = 'OWNER'
where user_id = (
  select id from auth.users
  where lower(email) = lower('your.email@example.com')  -- <<< YOUR EMAIL HERE
);
```

Press **Run**. You should see `Success. 1 row affected` — or wording to that
effect.

**If it says 0 rows affected**, the email did not match any account. Go back to
step 3 and copy the address exactly as it appears there.

**If it reports an error mentioning `access_grants_single_owner`**, read
[What if it refuses because an owner already exists](#what-if-it-refuses-because-an-owner-already-exists)
below. That is the database refusing to create a second owner, which is exactly
what it is there for.

## Step 5 — Check it worked

Still in the SQL editor:

```sql
select u.email, g.role, g.active, p.profile_complete
from public.access_grants g
join auth.users u on u.id = g.user_id
join public.profiles p on p.user_id = g.user_id
where g.role = 'OWNER';
```

You should get exactly one row: your email, `OWNER`, `true`, `true`.

If `profile_complete` is `false`, go back to step 2 — the grant is there but the
server will not act on it.

## Step 6 — Use it

Back in the application, on **Nalozi i pristup**, press **Provjeri pristup
ponovo** (or sign out and in again). The account directory should appear, listing
every registered account, with a role selector and an access control for each.

New accounts start as limited citizens: they can see their own account and
device settings, but no operational data. You can then classify them. The panel
has separate DVD Tivat and SZS selectors,
each offering `Vatrogasac`, `Komandir`, `Administrator` or no membership. You
may also take the whole account's access away with a reason. Every change is
recorded permanently and shown underneath the list.

The SZS selector is active only when migrations `202609200013` and
`202609200015` are applied and the deployment variable
`VITE_MULTI_SERVICE_ADMIN_ENABLED=true` is set. Production satisfies both
conditions as of 2026-09-20. This gate remains intentional: a future
deployment must not expose the selector before its database policy exists.

---

## What if it refuses because an owner already exists

The error looks roughly like this:

```
ERROR: duplicate key value violates unique constraint "access_grants_single_owner"
```

This is a **partial unique index** in the database. It exists so that no code
path, no mistake and no pasted command can create a second owner. Nothing is
broken; the rule is working.

First, see who the owner currently is:

```sql
select u.email, g.granted_at
from public.access_grants g
join auth.users u on u.id = g.user_id
where g.role = 'OWNER';
```

Then one of these:

- **It is already you** (an earlier attempt worked). Nothing to do — go to step 5.
- **It is a test account you no longer want.** Transfer ownership with the block
  below.
- **It is somebody else's real account.** Stop and talk to them. Do not transfer
  ownership of a live system without the current owner knowing.

### Transferring ownership

Change the email on the marked line and run the whole block at once:

```sql
begin;

-- The current owner keeps administrative access but is no longer the owner.
-- Change 'ADMIN' to 'CITIZEN' instead if they should keep no operational role.
update public.access_grants set role = 'ADMIN' where role = 'OWNER';

update public.access_grants
set role = 'OWNER'
where user_id = (
  select id from auth.users
  where lower(email) = lower('your.email@example.com')  -- <<< YOUR EMAIL HERE
);

commit;
```

Both statements are in one transaction so the system is never left with no owner.
If the second one matches nothing, the whole block is undone and the previous
owner keeps the role.

Then run the check in step 5.

### This block leaves no audit row, and that is a real gap

`owner_set_role` — the function the owner panel calls for every other role
change — **cannot** perform this transfer, by three separate guards:

1. `OWNER` is not in its list of assignable roles (`ROLE_NOT_ASSIGNABLE`).
2. It refuses to change the caller's own role (`CANNOT_CHANGE_OWN_ROLE`).
3. It refuses to change an account that currently holds `OWNER`
   (`ACCOUNT_NOT_ASSIGNABLE`).

That is deliberate: ownership is meant to be hard to move. The consequence is
that the block above is the *only* path, and there is **no audit trigger on
`access_grants`** — the two functions that write `role_audit` do so with
explicit `insert` statements, not a trigger. So a plain `update` here changes
who owns the system and records nothing.

Whoever runs the block should add the matching audit rows in the same
transaction:

```sql
insert into public.role_audit(target_user_id, previous_role, next_role, changed_by)
values
  ('<previous owner user_id>', 'OWNER', 'CITIZEN', '<who is running this>'),
  ('<new owner user_id>', 'CITIZEN', 'OWNER', '<who is running this>');
```

Be clear about what this is worth: rows written by the same hand that made the
change are a **statement of intent, not independent evidence**. Anyone with
dashboard access could write the update without them, or write them without the
update. They are better than silence and they are not proof.

### How the current owner was set

On **2026-09-21 06:52:42 UTC**, ownership moved from
`vlasnik@example.invalid` (a fictional test account) to the society's real
account, `doncicdragan2112@gmail.com`. This was done as a **direct change on the
production database, outside any owner function** — which is what this runbook
prescribes, because no owner function can do it.

What is on record, verified read-only on 2026-09-22:

- `access_grants` holds **exactly one** `OWNER`, the real account, `granted_at`
  `2026-09-21 06:52:42.890698+00`.
- `role_audit` holds two rows at that identical microsecond — `OWNER → CITIZEN`
  for the previous owner and `CITIZEN → OWNER` for the new one — both with
  `changed_by` set to the previous owner.
- The identical timestamps put the grant change and the audit rows in one
  transaction.
- No other account, membership or status audit table recorded anything that
  day.

So the transfer was carried out as documented and was voluntarily recorded, in
one transaction, going beyond what this runbook asked for at the time. **No
backfill has been made and none should be** — a record written afterwards to
make a trail look complete would be worth less than the gap it hides.

The standing weakness is in the procedure, not in that particular execution:
ownership of this system can be moved by anyone with Supabase dashboard access,
and the database will not notice. A `owner_transfer_ownership` function that
makes the transfer atomic and self-auditing is on the backlog at **low
priority** — see `docs/ai/PROJECT_STATE.md`. It is not built, and it would not
change who can reach the dashboard, which remains the real control.

## If you lose access to the owner account

There is no recovery path inside the application, on purpose. Recovery is the
same SQL editor, the same statements above, run by somebody with dashboard
access to the project.

That means **whoever controls the Supabase dashboard controls this system.**
Protect that login at least as carefully as the owner account itself.

**Only one owner exists**, by the society's decision (blocker **B6**). If a
documented second break-glass owner is ever wanted, that is a change to the
single-owner index and needs its own review — the reporting and audit
consequences should be decided first, not discovered afterwards.

---

## Things this procedure will never ask you for

- **The secret key** (`sb_secret_...`). Nothing in this application needs it. It
  must never be pasted into a file in this repository, into a `VITE_` variable,
  or into a chat. If something appears to need it inside the application itself,
  that is a design mistake to raise, not a step to follow.
- **Anybody's password.** Not yours, not a member's. The owner cannot read
  passwords and does not need to.
- **A change to the application code.** If a procedure asks you to edit code to
  grant yourself access, it is the wrong procedure.

## Why it is done this way

| Decision | Reason |
|---|---|
| Manual, in the dashboard | The owner role must not be reachable by anything a browser can send |
| One owner, enforced by a database index | Not by application code, which can be forgotten or bypassed |
| `owner_set_role` cannot assign `OWNER` | Even the owner cannot delegate it, so it cannot spread by accident |
| The owner cannot change their own role or access | So they cannot lock themselves out |
| Profile must be complete first | A role means nothing until the server knows who holds it |

All five are executed by the integration suite in `db-tests/access.test.ts`; see
[ACCESS_MODEL.md §3](./ACCESS_MODEL.md#3-roles).
