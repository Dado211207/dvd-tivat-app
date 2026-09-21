-- Let the single system owner also hold explicit service memberships.
--
-- OWNER is a global system authority. It must never be replaced by the DVD
-- compatibility role, but that does not mean the person is not also an active
-- firefighter in DVD Tivat. Service membership and global ownership are two
-- different facts and are recorded independently here.

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
  next_membership_role := case when new_membership_active then normalized_role else null end;

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

  -- Ordinary DVD membership remains mirrored to the compatibility grant.
  -- The owner's grant is deliberately untouched: assigning the owner as a DVD
  -- firefighter must not demote the only system owner.
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

revoke all on function public.owner_set_organization_membership(uuid, text, text)
  from public, anon;
grant execute on function public.owner_set_organization_membership(uuid, text, text)
  to authenticated;

comment on function public.owner_set_organization_membership(uuid, text, text) is
  'Owner-only service assignment. OWNER remains global authority while holding independent DVD/SZS memberships.';
