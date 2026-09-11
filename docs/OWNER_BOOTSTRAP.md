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

One setting to check first, in **Authentication → Sign In / Providers → Email**:

> **Confirm email** should be **off**.
>
> With it on, Supabase tries to send a confirmation message, and its built-in
> sender only delivers to addresses on the project team and is rate limited. An
> ordinary member would register and then wait for an email that never arrives.
> Turning it back on is the right thing to do later, once a real mail provider is
> configured — see blocker **B2** in
> [ai/PROJECT_STATE.md](./ai/PROJECT_STATE.md).

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

You can now approve people: set a registered account to `Vatrogasac`, `Komandir`
or `Administrator`, or take access away with a reason. Every change is recorded
permanently and shown underneath the list.

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
-- Change 'ADMIN' to 'PENDING' instead if they should keep nothing.
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
