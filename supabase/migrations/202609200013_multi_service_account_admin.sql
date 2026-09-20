-- Multi-service account administration.
--
-- This is deliberately additive. Existing operational tables remain DVD Tivat
-- data; an SZS membership does not grant access to them. The membership model
-- records who belongs to which service and with which role, while the existing
-- access_grants row remains the compatibility authority for the DVD workspace.

create table public.organizations (
  id uuid primary key,
  code text not null unique check (code ~ '^[A-Z0-9_]{2,20}$'),
  display_name text not null check (char_length(display_name) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.organizations(id, code, display_name)
values
  ('00000000-0000-4000-8000-000000000001', 'DVD', 'DVD Tivat'),
  ('00000000-0000-4000-8000-000000000002', 'SZS', 'Sluzba zastite i spasavanja')
on conflict (code) do update set display_name = excluded.display_name;

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')),
  active boolean not null default true,
  granted_by uuid references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_idx
  on public.organization_memberships(user_id, active);

create table public.organization_membership_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  previous_role text,
  next_role text,
  previous_active boolean,
  next_active boolean not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

-- Existing approved accounts belong to the existing DVD workspace. No SZS
-- membership is inferred or copied from DVD data.
insert into public.organization_memberships(
  organization_id, user_id, role, active, granted_by, granted_at)
select organization.id, grant_row.user_id, grant_row.role, true,
       grant_row.granted_by, grant_row.granted_at
from public.access_grants grant_row
cross join public.organizations organization
where organization.code = 'DVD'
  and grant_row.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
on conflict (organization_id, user_id) do nothing;

-- Keep the old DVD role command and one-time owner/bootstrap SQL compatible
-- with the new directory. Account suspension is deliberately separate: it
-- blocks the whole account without erasing which service the person belongs to.
create or replace function public.sync_dvd_membership_from_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dvd_id uuid := '00000000-0000-4000-8000-000000000001';
begin
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

create trigger sync_dvd_membership_after_grant
after insert or update of role on public.access_grants
for each row execute function public.sync_dvd_membership_from_grant();

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_membership_audit enable row level security;

create policy organizations_authenticated_read on public.organizations for select
  to authenticated using (true);
create policy memberships_self_read on public.organization_memberships for select
  to authenticated using (user_id = auth.uid());
create policy memberships_owner_read on public.organization_memberships for select
  to authenticated using (public.is_dvd_owner());
create policy membership_audit_owner_read on public.organization_membership_audit for select
  to authenticated using (public.is_dvd_owner());

-- One owner command manages one service membership. NONE means no active
-- membership. For DVD only, the compatibility grant is changed in the same
-- transaction so the old operational policies and the new admin panel cannot
-- disagree. SZS membership never grants access to DVD records.
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

  if old_membership_role is distinct from case when new_membership_active then normalized_role else old_membership_role end
     or coalesce(old_membership_active, false) is distinct from new_membership_active then
    insert into public.organization_membership_audit(
      organization_id, target_user_id, previous_role, next_role,
      previous_active, next_active, changed_by)
    values (
      target_organization, target_user, old_membership_role,
      case when new_membership_active then normalized_role else null end,
      old_membership_active, new_membership_active, auth.uid());
  end if;

  if normalized_code = 'DVD' then
    next_global_role := case when new_membership_active then normalized_role else 'PENDING' end;
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

revoke all on public.organizations from public, anon, authenticated;
revoke all on public.organization_memberships from public, anon, authenticated;
revoke all on public.organization_membership_audit from public, anon, authenticated;
grant select on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.organization_membership_audit to authenticated;

revoke all on function public.owner_set_organization_membership(uuid, text, text) from public, anon;
grant execute on function public.owner_set_organization_membership(uuid, text, text) to authenticated;
revoke all on function public.sync_dvd_membership_from_grant() from public, anon, authenticated;

comment on table public.organization_memberships is
  'Organization-scoped account roles. SZS membership does not grant access to DVD operational records.';
comment on function public.owner_set_organization_membership(uuid, text, text) is
  'Owner-only organization membership assignment; DVD changes are mirrored to the compatibility grant.';
