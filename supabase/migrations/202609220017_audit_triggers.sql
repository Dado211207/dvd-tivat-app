-- A role change can no longer happen without leaving a record.
--
-- WHAT THIS FIXES, AND WHAT IT DOES NOT
--
-- Before this migration, `role_audit` and `organization_membership_audit` were
-- written only by explicit `insert` statements inside `owner_set_role` and
-- `owner_set_organization_membership`. Any change made another way - the direct
-- SQL that `docs/OWNER_BOOTSTRAP.md` prescribes for transferring ownership,
-- a dashboard edit, a future code path that forgets - changed who controls this
-- system and recorded nothing at all. That is what happened on 2026-09-21: the
-- ownership transfer produced audit rows only because the person running it
-- wrote them by hand.
--
-- After this migration every write of `access_grants.role`, and every change to
-- an `organization_memberships` row, produces its audit row from a trigger.
-- There is no longer a way to change a role quietly.
--
-- It does NOT make the audit forgery-proof, and nothing at this layer can:
--
--   * A superuser - which is what the Supabase SQL editor runs as - can still
--     `insert into role_audit` directly, `alter table ... disable trigger`, or
--     delete rows. Postgres has no mechanism that stops its own superuser.
--   * So this closes "a change with no record". It does not close "a record
--     with no change". Those are different problems and only the first one is
--     solvable here.
--
-- Whoever holds the Supabase dashboard still controls this system. That remains
-- the real control, and no trigger changes it.

-- ---------------------------------------------------------------------------
-- 1. `changed_by` must be allowed to be null.
-- ---------------------------------------------------------------------------
--
-- `auth.uid()` is null when the change did not come through an authenticated
-- application session - which is exactly the case this migration exists to
-- capture. With `not null` in place the trigger's insert would fail and take
-- the whole UPDATE down with it, so a raw change would still leave no record,
-- and now would also be impossible.
--
-- A null `changed_by` is not missing data. It is the statement "this did not
-- come through the application", which is precisely what a reader needs to
-- know. Inventing a sentinel actor would be worse than saying nothing.
alter table public.role_audit alter column changed_by drop not null;
alter table public.organization_membership_audit alter column changed_by drop not null;

-- ---------------------------------------------------------------------------
-- 1b. Resolving the actor must never be able to block the change.
-- ---------------------------------------------------------------------------
--
-- `auth.uid()` parses `request.jwt.claims` as jsonb. When that setting is left
-- as an empty string rather than unset - which happens after a transaction that
-- set it locally, and can happen in a dashboard session - the cast raises
-- `invalid input syntax for type json`. Called inline from a trigger, that
-- exception aborts the UPDATE that fired it.
--
-- An audit trigger that can refuse a legitimate role change because a session
-- variable is malformed is worse than the gap it was added to close. Every
-- failure to identify the caller means the same thing - the caller is unknown -
-- so all of them resolve to null, which is exactly what a null `changed_by`
-- already says.
create or replace function public.audit_actor()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  return auth.uid();
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Global role changes.
-- ---------------------------------------------------------------------------
create or replace function public.audit_access_grant_role()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- `update of role` fires even when the value is unchanged, and an unchanged
  -- role is not an event. Only a real transition is recorded.
  if tg_op = 'UPDATE' and old.role is not distinct from new.role then
    return new;
  end if;

  insert into public.role_audit(target_user_id, previous_role, next_role, changed_by)
  values (
    new.user_id,
    case when tg_op = 'UPDATE' then old.role else null end,
    new.role,
    -- `auth.uid()` first, because it is the only one the caller cannot choose.
    -- `granted_by` is a column somebody writing raw SQL sets themselves, so it
    -- is a weaker claim and is only used when there is no session at all.
    coalesce(public.audit_actor(), new.granted_by)
  );
  return new;
end;
$$;

-- `previous_role` is `not null` on the table, so an INSERT (which has no
-- previous role) cannot be recorded without relaxing it too.
alter table public.role_audit alter column previous_role drop not null;

drop trigger if exists audit_access_grant_role_change on public.access_grants;
create trigger audit_access_grant_role_change
after insert or update of role on public.access_grants
for each row execute function public.audit_access_grant_role();

-- ---------------------------------------------------------------------------
-- 3. Service membership changes.
-- ---------------------------------------------------------------------------
create or replace function public.audit_organization_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'UPDATE'
     and old.role is not distinct from new.role
     and old.active is not distinct from new.active then
    return new;
  end if;

  insert into public.organization_membership_audit(
    organization_id, target_user_id, previous_role, next_role,
    previous_active, next_active, changed_by)
  values (
    new.organization_id,
    new.user_id,
    case when tg_op = 'UPDATE' then old.role else null end,
    -- The row's actual role, including when it is being deactivated. The
    -- previous hand-written insert recorded null on stand-down; the row itself
    -- keeps its role and merely becomes inactive, and recording what is
    -- actually there is the less surprising of the two.
    new.role,
    case when tg_op = 'UPDATE' then old.active else null end,
    new.active,
    coalesce(public.audit_actor(), new.granted_by)
  );
  return new;
end;
$$;

drop trigger if exists audit_organization_membership_change on public.organization_memberships;
create trigger audit_organization_membership_change
after insert or update on public.organization_memberships
for each row execute function public.audit_organization_membership();

-- ---------------------------------------------------------------------------
-- 4. Replace the hand-written inserts with an assertion.
-- ---------------------------------------------------------------------------
--
-- Keeping the inserts as well as the trigger would double every row the
-- application writes, which would make the audit actively misleading rather
-- than merely incomplete. But simply deleting them loses something real: the
-- function's insert was an INDEPENDENT guarantee, and without it, disabling one
-- trigger silently removes auditing from the application path too.
--
-- Measured rather than assumed. With the trigger disabled and the insert gone,
-- `owner_set_role` changed a role to FIREFIGHTER and recorded nothing at all.
--
-- So the function keeps a guarantee without duplicating a row: it checks that
-- an audit row appeared and refuses to complete if one did not. Redundancy
-- becomes a tripwire. The moment auditing stops working, role changes stop
-- working, loudly, instead of proceeding unobserved.
--
-- THE COST, because this is a real trade and not a free win: an audit failure
-- becomes an outage. If the trigger is ever broken or dropped, an owner cannot
-- reassign a role until it is fixed. On a system whose purpose is that
-- authority cannot move unobserved, failing closed is the right direction - but
-- it is availability traded for accountability, on the one function that
-- manages access.

create or replace function public.owner_set_role(target_user uuid, requested_role text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  old_role text;
  audit_before bigint;
  audit_after bigint;
begin
  if not public.is_dvd_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if requested_role not in ('ADMIN', 'COMMANDER', 'FIREFIGHTER', 'PENDING', 'CITIZEN') then
    raise exception 'ROLE_NOT_ASSIGNABLE';
  end if;
  if target_user = auth.uid() then raise exception 'CANNOT_CHANGE_OWN_ROLE'; end if;

  -- `for update` also serialises this against any other `owner_set_role` for
  -- the same account, which is what makes the count comparison below sound.
  select role into old_role from public.access_grants where user_id = target_user for update;
  if old_role is null or old_role = 'OWNER' then raise exception 'ACCOUNT_NOT_ASSIGNABLE'; end if;

  select count(*) into audit_before
  from public.role_audit where target_user_id = target_user;

  -- The audit row is written by `audit_access_grant_role_change`, so the
  -- application and a raw SQL change produce the record by the same path.
  update public.access_grants
  set role = requested_role, granted_by = auth.uid(), granted_at = now()
  where user_id = target_user;

  -- An unchanged role is not an event and the trigger correctly writes nothing,
  -- so only a real transition is asserted on.
  if old_role is distinct from requested_role then
    select count(*) into audit_after
    from public.role_audit where target_user_id = target_user;

    if audit_after = audit_before then
      raise exception 'AUDIT_NOT_WRITTEN';
    end if;
  end if;
end;
$$;

-- One residual race, stated rather than left to be discovered: under `read
-- committed`, another session committing a `role_audit` row for this same
-- account between the two counts would satisfy the check. The row lock above
-- makes that impossible for another `owner_set_role`, leaving only a
-- concurrent raw SQL change to the very same account. The failure direction is
-- the safe one - it degrades to the behaviour without this check, never to a
-- refusal of a legitimate change.

create or replace function public.owner_set_organization_membership(
  target_user uuid, organization_code text, requested_role text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  normalized_code text := upper(trim(coalesce(organization_code, '')));
  normalized_role text := upper(trim(coalesce(requested_role, '')));
  target_organization uuid;
  target_global_role text;
  old_membership_role text;
  old_membership_active boolean;
  new_membership_active boolean;
  membership_changes boolean;
  next_global_role text;
  membership_audit_before bigint;
  membership_audit_after bigint;
  role_audit_before bigint;
  role_audit_after bigint;
begin
  if not public.is_dvd_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if normalized_role not in ('NONE', 'ADMIN', 'COMMANDER', 'FIREFIGHTER') then
    raise exception 'ROLE_NOT_ASSIGNABLE';
  end if;

  select grant_row.role into target_global_role
  from public.access_grants grant_row where grant_row.user_id = target_user for update;
  if target_global_role is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;

  select organization.id into target_organization
  from public.organizations organization
  where organization.code = normalized_code and organization.active = true;
  if target_organization is null then raise exception 'ORGANIZATION_NOT_FOUND'; end if;

  select membership.role, membership.active
    into old_membership_role, old_membership_active
  from public.organization_memberships membership
  where membership.organization_id = target_organization
    and membership.user_id = target_user
  for update;

  new_membership_active := normalized_role <> 'NONE';

  -- Whether the membership row is actually about to change. The trigger writes
  -- nothing for a write that changes nothing, so asserting on a no-op would
  -- turn a harmless call into an outage. Standing down an account that has no
  -- membership, or re-assigning the role it already holds, are both no-ops.
  membership_changes :=
    (new_membership_active
      and (old_membership_role is null
           or old_membership_role is distinct from normalized_role
           or coalesce(old_membership_active, false) = false))
    or (not new_membership_active
        and old_membership_role is not null
        and coalesce(old_membership_active, false) = true);

  select count(*) into membership_audit_before
  from public.organization_membership_audit
  where organization_id = target_organization and target_user_id = target_user;

  if new_membership_active then
    insert into public.organization_memberships(
      organization_id, user_id, role, active, granted_by, granted_at)
    values (target_organization, target_user, normalized_role, true, auth.uid(), now())
    on conflict (organization_id, user_id) do update
      set role = excluded.role,
          active = true,
          granted_by = excluded.granted_by,
          granted_at = excluded.granted_at;
  elsif old_membership_role is not null then
    update public.organization_memberships
       set active = false, granted_by = auth.uid(), granted_at = now()
     where organization_id = target_organization and user_id = target_user;
  end if;

  -- The same tripwire as `owner_set_role`, for the same reason: this function
  -- also gave up its own audit insert, so without an assertion a disabled
  -- trigger would let a service assignment change quietly. Both functions fail
  -- closed or neither should, and leaving them inconsistent would mean the
  -- weaker one is the one nobody remembers.
  if membership_changes then
    select count(*) into membership_audit_after
    from public.organization_membership_audit
    where organization_id = target_organization and target_user_id = target_user;

    if membership_audit_after = membership_audit_before then
      raise exception 'AUDIT_NOT_WRITTEN';
    end if;
  end if;

  -- Ordinary DVD membership is still mirrored to the compatibility grant. The
  -- owner is the one exception: mirroring there would write FIREFIGHTER - or
  -- CITIZEN on stand-down - over the only OWNER row.
  if normalized_code = 'DVD' and target_global_role <> 'OWNER' then
    next_global_role := case when new_membership_active then normalized_role else 'CITIZEN' end;

    select count(*) into role_audit_before
    from public.role_audit where target_user_id = target_user;

    update public.access_grants
       set role = next_global_role, granted_by = auth.uid(), granted_at = now()
     where user_id = target_user;

    -- The mirror writes a SECOND audited fact - the global role - and it needs
    -- its own assertion. Auditing the service change while the grant change
    -- went unrecorded would be the more dangerous half going unnoticed.
    if target_global_role is distinct from next_global_role then
      select count(*) into role_audit_after
      from public.role_audit where target_user_id = target_user;

      if role_audit_after = role_audit_before then
        raise exception 'AUDIT_NOT_WRITTEN';
      end if;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Narrow who can write the audit tables directly.
-- ---------------------------------------------------------------------------
--
-- `authenticated` already held SELECT only, so the application and every signed
-- in person were never able to write these. `service_role` held full DML, which
-- means a leaked service key could fabricate history. The triggers above are
-- `security definer` and run as the table owner, so they keep working.
--
-- This raises the bar; it does not close the door. The SQL editor runs as a
-- superuser and bypasses every grant here.
revoke insert, update, delete on public.role_audit from service_role;
revoke insert, update, delete on public.organization_membership_audit from service_role;

-- ---------------------------------------------------------------------------
-- 6. No new function is callable over the REST API.
-- ---------------------------------------------------------------------------
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and this project's
-- default privileges also grant it to `anon`, `authenticated` and
-- `service_role`. A trigger function is invoked by the trigger, never by a
-- caller, so nobody needs EXECUTE on it - and leaving it would put
-- `audit_access_grant_role` on `/rest/v1/rpc` for anybody at all.
--
-- `audit_actor()` is revoked from the same roles for the same reason: it is an
-- internal helper, and it is `security definer`.
revoke all on function public.audit_actor() from public, anon, authenticated, service_role;
revoke all on function public.audit_access_grant_role() from public, anon, authenticated, service_role;
revoke all on function public.audit_organization_membership() from public, anon, authenticated, service_role;
