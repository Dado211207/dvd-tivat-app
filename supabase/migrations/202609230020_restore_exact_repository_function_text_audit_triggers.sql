-- ===========================================================================
-- 202609230020 - put back the in-body comments that an apply stripped
--
-- NO BEHAVIOUR CHANGE. Four functions are re-created with bodies identical to
-- the ones 202609220017 already defines. On a fresh replay of the migrations
-- this file is a no-op: 202609220017 produces exactly these bodies, and this
-- re-creates them unchanged.
--
-- ---------------------------------------------------------------------------
-- Why it exists anyway
-- ---------------------------------------------------------------------------
--
-- 202609220017 was applied to the hosted project on 2026-09-23 with the correct
-- SQL but with the comments inside the function bodies removed. Nothing behaved
-- differently. What it cost is the ability to compare the live project against
-- this repository by function text, which is how schema drift gets noticed at
-- all:
--
--   function                            live    repository
--   audit_access_grant_role              367           744
--   audit_actor                           75            75   (no in-body comments)
--   audit_organization_membership        602           886
--   owner_set_organization_membership   3761          4870
--   owner_set_role                      1074          1506
--
-- `audit_actor` matching is what identified the cause: it is the one function
-- in that migration with no comments inside its body.
--
-- The correction was applied live as `restore_exact_repository_function_text_
-- audit_triggers` (version 20260923165527). This file is that same statement,
-- committed so the hosted project's migration history has a counterpart in
-- version control rather than an entry that exists only on the server.
--
-- ---------------------------------------------------------------------------
-- Ordering
-- ---------------------------------------------------------------------------
--
-- On the hosted project this ran immediately after 202609220017, BEFORE
-- 202609230018 and 202609230019. Here it is numbered last, so a replay from
-- zero applies it after both. The two orders converge: neither 18 nor 19
-- touches any of the four functions below - 18 replaces the two eligibility
-- functions and adds `serves_with`, 19 renames a table and re-creates the
-- twelve registry writers. Nothing here overlaps either set.
--
-- ---------------------------------------------------------------------------
-- A second, older entry had the same problem
-- ---------------------------------------------------------------------------
--
-- The hosted project also carries `restore_exact_repository_function_text`
-- (version 20260912201050, 2026-09-12): the same mistake, eleven days earlier.
-- It is reconciled by `202609130006a_restore_exact_repository_function_text`,
-- which is numbered where that one actually ran - between 006 and 007 - and not
-- here, because three of its thirteen functions are ones 202609230019 re-creates
-- for the registry rename. See that file for the measurement.
-- ===========================================================================

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
