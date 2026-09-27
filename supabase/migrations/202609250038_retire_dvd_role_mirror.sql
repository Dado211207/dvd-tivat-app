-- ===========================================================================
-- 202609250038 (P5) - retire the DVD role mirror; membership is the only
--                     statement of operational authority
--
-- Follows the merged P4 stack (022-032) and the P4f follow-ups (033-037), none
-- of which it changes.
--
-- ---------------------------------------------------------------------------
-- What the mirror was
-- ---------------------------------------------------------------------------
--
-- Two copies of "who serves in DVD, and in what role" were kept in step:
--   - `access_grants.role` (the pre-multi-service global role), and
--   - the DVD row of `organization_memberships` (the tenant-aware authority
--     that P3's `current_role_in()` actually reads).
-- A trigger, `sync_dvd_membership_after_grant` -> `sync_dvd_membership_from_grant()`,
-- wrote the membership from the grant; the tail of
-- `owner_set_organization_membership()` wrote the grant back from the DVD
-- membership. `owner_set_role()` set the grant, and the trigger turned that into
-- the membership.
--
-- Authority already resolves through membership (P3): `current_role_in()` reads
-- `organization_memberships`, and no row-level-security policy reads
-- `access_grants.role`. The grant's operational value is therefore a second copy
-- that can only agree or disagree with the authority - never add to it. This
-- migration removes the copy.
--
-- ---------------------------------------------------------------------------
-- What changes
-- ---------------------------------------------------------------------------
--
--   - The mirror trigger and its function are dropped. A change to
--     `access_grants.role` no longer moves anybody's operational access.
--   - `owner_set_organization_membership()` loses its DVD-to-grant mirror block
--     (and the role_audit tripwire that guarded that second write). It still
--     writes the membership and still asserts the membership audit row - the
--     tripwire of 202609220017 - so a disabled audit trigger still fails closed.
--   - `owner_set_role()` becomes baseline-only: it assigns PENDING or CITIZEN,
--     the installation-wide "no operational role anywhere" values, and refuses
--     the operational roles, which are now assigned only through
--     `owner_set_organization_membership()`. Its own audit tripwire is kept.
--
-- `access_grants` now carries only what is genuinely installation-wide: `active`
-- (suspension, which still removes access in both services through
-- `current_account_is_usable()`) and `role = 'OWNER'` (the installation owner,
-- read by `is_installation_owner()`). CITIZEN/PENDING remain the baseline.
--
-- Existing rows are left as they are: every operational account already has the
-- matching active membership the mirror wrote, so nobody loses access, and the
-- residual operational value in `access_grants.role` is now inert. It is not
-- rewritten here - that would be a data change with no reader to serve.
--
-- ---------------------------------------------------------------------------
-- Not changed
-- ---------------------------------------------------------------------------
--
--   - The owner: `is_installation_owner()` / `is_dvd_owner()` still read
--     `access_grants.role = 'OWNER'`; the owner keeps full access with no
--     membership row, and still needs a service member record to act as a
--     firefighter.
--   - Suspension, profile-completeness, and every command's authority check.
--   - The joint-service product rules; the P6 SZS interface is not built here.
-- ===========================================================================

-- 1. Drop the mirror. The trigger depends on the function, so it goes first.
drop trigger if exists sync_dvd_membership_after_grant on public.access_grants;
drop function if exists public.sync_dvd_membership_from_grant();

-- 2. owner_set_organization_membership without the DVD-to-grant mirror block.
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
  membership_audit_before bigint;
  membership_audit_after bigint;
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

  -- The audit tripwire of 202609220017: this function gave up its own audit
  -- insert to the trigger, so without an assertion a disabled trigger would let
  -- a service assignment change quietly.
  if membership_changes then
    select count(*) into membership_audit_after
    from public.organization_membership_audit
    where organization_id = target_organization and target_user_id = target_user;

    if membership_audit_after = membership_audit_before then
      raise exception 'AUDIT_NOT_WRITTEN';
    end if;
  end if;

  -- The DVD-to-grant mirror is gone: membership is the authority, and the grant
  -- is no longer a second copy of the operational role to keep in step.
end;
$$;

comment on function public.owner_set_organization_membership(uuid, text, text) is
  'Assigns or stands down a service membership - the sole statement of '
  'operational authority. Writes only organization_memberships (audited by its '
  'trigger, asserted here); it no longer mirrors the DVD role into access_grants.';

-- 3. owner_set_role becomes baseline-only: PENDING or CITIZEN, never an
--    operational role (that is owner_set_organization_membership's now).
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
  -- Operational authority is a service membership now; this function keeps only
  -- the installation-wide baseline. OWNER is set by the bootstrap runbook, never
  -- here, and is refused as a target below like any non-baseline value.
  if requested_role not in ('PENDING', 'CITIZEN') then
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

comment on function public.owner_set_role(uuid, text) is
  'Sets the installation-wide baseline grant (PENDING or CITIZEN) only. An '
  'operational role is a service membership, assigned through '
  'owner_set_organization_membership(); this function refuses one, and no longer '
  'feeds a mirror. Changing access_grants.role no longer moves operational access.';
