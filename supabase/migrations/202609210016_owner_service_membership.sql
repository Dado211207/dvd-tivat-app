-- The owner of the system is also a firefighter.
--
-- OWNER records who governs this installation. It says nothing about whether
-- the person turns out to a fire, and in DVD Tivat the same person does both.
-- Three server rules stood in the way of recording that truth:
--
--   1. `owner_set_organization_membership` refused a self-target. Only an owner
--      may call it and there is exactly one owner, so "somebody else must do
--      it" meant nobody could.
--   2. It refused an OWNER target outright, to stop the DVD compatibility
--      mirror overwriting the only owner's grant. The protection was right; the
--      way it was enforced also blocked the harmless part.
--   3. `sync_dvd_membership_from_grant` deactivates DVD membership for any role
--      it does not consider operational, and OWNER is not on that list. This is
--      the one that mattered most: it fires on `update of role` whether or not
--      the value changes, so the membership would switch itself off later, with
--      nothing said and nothing in the audit to explain it.
--
-- Membership and global authority are now recorded independently. The owner's
-- grant is never written by either path, so assigning the owner to a service
-- cannot demote the only owner, and nothing about who may assign changes: the
-- `is_dvd_owner()` gate and every other account's behaviour are untouched.

create or replace function public.owner_set_organization_membership(
  target_user uuid,
  organization_code text,
  requested_role text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_code text := upper(trim(coalesce(organization_code, '')));
  normalized_role text := upper(trim(coalesce(requested_role, '')));
  target_organization uuid;
  target_global_role text;
  old_membership_role text;
  old_membership_active boolean;
  new_membership_active boolean;
  next_membership_role text;
  next_global_role text;
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
  next_membership_role := case
    when new_membership_active then normalized_role
    else null
  end;

  if new_membership_active then
    insert into public.organization_memberships(
      organization_id, user_id, role, active, granted_by, granted_at)
    values (
      target_organization, target_user, normalized_role, true, auth.uid(), now())
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

  if coalesce(old_membership_active, false) is distinct from new_membership_active
     or (new_membership_active and old_membership_role is distinct from next_membership_role) then
    insert into public.organization_membership_audit(
      organization_id, target_user_id, previous_role, next_role,
      previous_active, next_active, changed_by)
    values (
      target_organization, target_user, old_membership_role,
      next_membership_role,
      old_membership_active, new_membership_active, auth.uid());
  end if;

  -- Ordinary DVD membership is still mirrored to the compatibility grant, so
  -- nothing changes for anybody else. The owner is the one exception: mirroring
  -- there would write FIREFIGHTER - or CITIZEN on stand-down - over the only
  -- OWNER row and leave the installation with no owner at all.
  if normalized_code = 'DVD' and target_global_role <> 'OWNER' then
    next_global_role := case when new_membership_active then normalized_role else 'CITIZEN' end;
    update public.access_grants
       set role = next_global_role, granted_by = auth.uid(), granted_at = now()
     where user_id = target_user;

    if target_global_role is distinct from next_global_role then
      insert into public.role_audit(target_user_id, previous_role, next_role, changed_by)
      values (target_user, target_global_role, next_global_role, auth.uid());
    end if;
  end if;
end;
$$;

-- The trigger half of the same rule.
--
-- Without this the fix above lasts only until the next write to the owner's
-- role column: the trigger fires on `update of role` regardless of whether the
-- value changed, sees a role it does not recognise as operational, and
-- deactivates the membership. An owner's service membership is administered
-- explicitly through the function above, so the grant must not drive it.
create or replace function public.sync_dvd_membership_from_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dvd_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  if new.role = 'OWNER' then return new; end if;

  if new.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER') then
    insert into public.organization_memberships(
      organization_id, user_id, role, active, granted_by, granted_at)
    values (dvd_id, new.user_id, new.role, true, new.granted_by, new.granted_at)
    on conflict (organization_id, user_id) do update
      set role = excluded.role,
          active = true,
          granted_by = excluded.granted_by,
          granted_at = excluded.granted_at;
  else
    update public.organization_memberships
       set active = false, granted_by = new.granted_by, granted_at = new.granted_at
     where organization_id = dvd_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.owner_set_organization_membership(uuid, text, text)
  from public, anon;
grant execute on function public.owner_set_organization_membership(uuid, text, text)
  to authenticated;
revoke all on function public.sync_dvd_membership_from_grant() from public, anon, authenticated;

comment on function public.owner_set_organization_membership(uuid, text, text) is
  'Owner-only service assignment. DVD changes mirror to the compatibility grant for every account except the owner, whose global authority is recorded independently of which service they serve in.';
