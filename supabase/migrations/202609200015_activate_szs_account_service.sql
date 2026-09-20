-- Activate citizen-first, multi-service account administration.
--
-- A new account is a citizen account with deliberately limited application
-- access. The owner can then assign an independent DVD role, an independent
-- SZS role, or both. Existing DVD operational tables remain DVD-scoped: an SZS
-- membership never widens access to them.

update public.organizations
   set display_name = 'Sluzba zastite i spasavanja Tivat'
 where code = 'SZS';

do $$
begin
  if not exists (
    select 1 from public.organizations
     where code = 'SZS'
       and display_name = 'Sluzba zastite i spasavanja Tivat'
       and active = true
  ) then
    raise exception 'SZS_ORGANIZATION_NOT_READY';
  end if;
end;
$$;

-- PENDING and CITIZEN had identical, non-operational authority. Use CITIZEN as
-- the truthful product state for both existing unassigned accounts and every
-- future registration. This semantic rename grants no operational permission:
-- current_dvd_role() continues to return NULL for CITIZEN.
alter table public.access_grants alter column role set default 'CITIZEN';
update public.access_grants set role = 'CITIZEN' where role = 'PENDING';

create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name text := regexp_replace(
    btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '\s+', ' ', 'g'
  );
  normalized_phone text := public.normalize_profile_phone(
    new.raw_user_meta_data ->> 'phone'
  );
  normalized_birth_date date := public.valid_profile_birth_date(
    new.raw_user_meta_data ->> 'date_of_birth'
  );
  is_complete boolean;
begin
  is_complete := char_length(normalized_name) between 4 and 100
    and position(' ' in normalized_name) > 0
    and normalized_phone is not null
    and normalized_birth_date is not null;

  insert into public.profiles(
    user_id, email, full_name, phone_e164, date_of_birth, profile_complete
  ) values (
    new.id,
    lower(new.email),
    case when is_complete then normalized_name else null end,
    case when is_complete then normalized_phone else null end,
    case when is_complete then normalized_birth_date else null end,
    is_complete
  ) on conflict (user_id) do nothing;

  insert into public.access_grants(user_id, role, active)
  values (new.id, 'CITIZEN', true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Return only the caller's active service memberships. The explicit auth.uid()
-- predicate remains in place even for the owner, whose table policy can read
-- the full directory, so this self-service command can never become a directory
-- endpoint by accident.
create or replace function public.current_organization_memberships()
returns table (
  organization_code text,
  organization_name text,
  membership_role text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select organization.code, organization.display_name, membership.role
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
   where membership.user_id = auth.uid()
     and membership.active = true
     and organization.active = true
   order by organization.code
$$;

-- One owner command still manages one service. Removing DVD membership now
-- returns the account to the limited CITIZEN state, while preserving any active
-- SZS membership. Assigning or removing SZS never changes the DVD grant.
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
  if target_user = auth.uid() then raise exception 'CANNOT_CHANGE_OWN_ROLE'; end if;
  if normalized_role not in ('NONE', 'ADMIN', 'COMMANDER', 'FIREFIGHTER') then
    raise exception 'ROLE_NOT_ASSIGNABLE';
  end if;

  select grant_row.role into target_global_role
  from public.access_grants grant_row where grant_row.user_id = target_user for update;
  if target_global_role is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if target_global_role = 'OWNER' then raise exception 'OWNER_ACCOUNT_PROTECTED'; end if;

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

  if normalized_code = 'DVD' then
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

revoke all on function public.current_organization_memberships() from public, anon;
grant execute on function public.current_organization_memberships() to authenticated;
revoke all on function public.owner_set_organization_membership(uuid, text, text) from public, anon;
grant execute on function public.owner_set_organization_membership(uuid, text, text) to authenticated;

comment on function public.current_organization_memberships() is
  'Active DVD/SZS memberships for the authenticated caller only.';
comment on function public.owner_set_organization_membership(uuid, text, text) is
  'Owner-only service assignment. DVD is mirrored to access_grants; SZS never grants DVD access.';
