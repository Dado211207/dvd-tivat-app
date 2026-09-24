-- ===========================================================================
-- 202609240024 - the registry belongs to a service
--
-- P4a of docs/MULTI_ORG_PLAN.md, the first of the six policy PRs. Seven read
-- policies over `members`, `groups`, `group_members`, `vehicles`,
-- `member_availability` and `member_availability_history`, and the thirteen
-- `security definer` commands that write them.
--
-- ---------------------------------------------------------------------------
-- Why the policies are only half of it
-- ---------------------------------------------------------------------------
--
-- Every one of these tables is `enable row level security` WITHOUT
-- `force row level security`, and every writer here is `security definer`
-- owned by `postgres`. A table's owner bypasses its own policies unless FORCE
-- is set, so these commands read and write the registry with RLS switched off.
--
-- Rewriting the seven policies therefore closes the READ path and leaves every
-- WRITE path exactly as open as it was. `is_dvd_admin()` asks "may you
-- administer the society"; after P2 there are two societies, and nothing in
-- these functions has ever asked WHICH. An administrator of either could
-- rename, stand down, relink or regroup the other's rows, and no policy could
-- stop them. That is what the second half of this migration is for.
--
-- ---------------------------------------------------------------------------
-- How a command decides which service it is acting in
-- ---------------------------------------------------------------------------
--
-- Two different questions, deliberately answered two different ways:
--
--   EDIT    the row already knows. The service is read from the STORED row and
--           never from the caller, so there is nothing to forge and no new
--           parameter to add. Every one of the nine edits below keeps its
--           signature EXACTLY and gains a check against its own row.
--
--   CREATE  there is no row yet, so the service has to be NAMED. That needs a
--           parameter, and a parameter cannot be added to an existing function
--           without either changing its signature or creating an overload that
--           makes every current call ambiguous. So the four creates gain a
--           SEPARATE `*_in` command that takes the service first, and the
--           original becomes a one-line DVD wrapper over it. The old path keeps
--           its exact signature, its grants and its behaviour; the new one is
--           how a service-aware client says which service it means.
--
-- Naming a service you do not administer is refused exactly as it would be for
-- anyone else who does not administer it, so the argument is not a way in.
--
-- The order inside each edit matters and is not arbitrary. The "are you an
-- administrator at all" check runs BEFORE the row is looked up, for two
-- reasons: it is what the schema does today, so `ADMIN_REQUIRED` keeps being
-- the answer a firefighter gets for a row that does not exist; and looking the
-- row up first would let anyone probe which ids are real.
--
-- ---------------------------------------------------------------------------
-- Two refusals, because they are two different mistakes
-- ---------------------------------------------------------------------------
--
--   ADMIN_REQUIRED         you are not an administrator of the service in
--                          question. Unchanged from today for every caller who
--                          administers nothing.
--   ORGANIZATION_MISMATCH  you ARE an administrator, of a different service
--                          than the row you named. The same code P2's triggers
--                          already raise for the same class of mistake.
--
-- ---------------------------------------------------------------------------
-- What this does NOT do
-- ---------------------------------------------------------------------------
--
-- * No function is dropped, so no grant is disturbed and no signature moves.
--   That is not only tidiness: `202609130006a` re-creates three of these at
--   their old text, and a changed signature here would leave the two versions
--   coexisting as an ambiguous overload the moment that file was replayed out
--   of order.
-- * The transitional DVD default on `members`, `groups` and `vehicles` STAYS.
--   Every create below now names its service explicitly, so the default is no
--   longer load-bearing for them - but `interventions` still carries one and is
--   P4b's, and dropping three of the four here would leave the schema in a
--   state no phase describes. It goes when the fourth can go with it.
-- * `registry_audit` is untouched: it is P4f's table, and this migration writes
--   it exactly as before.
-- * `eligible_recipients`, `publish_intervention`, `serves_with` and
--   `record_vehicle_departure` also read these tables from `security definer`
--   bodies. They belong to P4b and P4d and are deliberately left alone.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Is the caller an administrator of anything?
-- ---------------------------------------------------------------------------
--
-- Asked before any row is read, so somebody with no registry authority at all
-- is refused without learning whether the id they passed exists. The
-- installation owner administers every service (D9), so they are always true
-- here without holding a membership anywhere.

create or replace function public.is_admin_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_account_is_usable() and (
    public.is_installation_owner() or exists (
      select 1
      from public.organization_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = auth.uid()
        and membership.active = true
        and organization.active = true
        and membership.role = 'ADMIN'
    )
  )
$$;

comment on function public.is_admin_anywhere() is
  'Administrator of at least one service. Used to refuse a caller with no '
  'registry authority before any row is read, so ids cannot be probed.';

revoke all on function public.is_admin_anywhere() from public, anon;
grant execute on function public.is_admin_anywhere() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The seven read policies
-- ---------------------------------------------------------------------------
--
-- Each moves from "are you DVD staff" to "are you staff OF THE SERVICE THIS ROW
-- BELONGS TO". For a single-service installation the two are the same question,
-- which is what P3's equivalence gate established against real production data.
--
-- `is_staff_in` and `is_command_in` answer true in every service for the
-- installation owner, who holds no membership anywhere - so the owner keeps
-- both registries without one having to be invented for them.

alter policy members_staff_read on public.members
  using (public.is_staff_in(organization_id));

alter policy groups_staff_read on public.groups
  using (public.is_staff_in(organization_id));

alter policy group_members_staff_read on public.group_members
  using (public.is_staff_in(organization_id));

alter policy vehicles_staff_read on public.vehicles
  using (public.is_staff_in(organization_id));

alter policy member_availability_staff_read on public.member_availability
  using (public.is_staff_in(organization_id));

alter policy member_availability_history_command_read on public.member_availability_history
  using (public.is_command_in(organization_id));

-- The self-read is the one that could not have been written before P2. A person
-- may hold a member record in each service, so "is this row mine" has to be
-- asked of the row's own service; `current_member_id()` could only ever answer
-- for one of them.
alter policy member_availability_history_self_read on public.member_availability_history
  using (member_id = public.current_member_id_in(organization_id));

-- ---------------------------------------------------------------------------
-- 3. The creates, which have to be told the service
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_member_in(
  target_organization uuid,
  requested_full_name text,
  requested_specialties text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(requested_full_name, ''));
  new_id uuid;
begin
  if target_organization is null then raise exception 'ORGANIZATION_REQUIRED'; end if;
  if not public.is_admin_in(target_organization) then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'FULL_NAME_REQUIRED'; end if;

  insert into public.members(full_name, specialties, organization_id)
  values (clean_name, coalesce(requested_specialties, '{}'), target_organization)
  returning id into new_id;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', new_id, 'MEMBER_CREATED',
          jsonb_build_object('full_name', clean_name), auth.uid());

  return new_id;
end;
$$;

create or replace function public.admin_create_group_in(
  target_organization uuid,
  requested_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(requested_name, ''));
  new_id uuid;
begin
  if target_organization is null then raise exception 'ORGANIZATION_REQUIRED'; end if;
  if not public.is_admin_in(target_organization) then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'NAME_REQUIRED'; end if;
  -- Scoped to the service, because `groups_organization_name_key` is. The check
  -- was installation-wide, so one service could take a name from the other.
  if exists (
    select 1 from public.groups
    where lower(name) = lower(clean_name) and organization_id = target_organization
  ) then
    raise exception 'GROUP_NAME_TAKEN';
  end if;

  insert into public.groups(name, organization_id)
  values (clean_name, target_organization) returning id into new_id;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('GROUP', new_id, 'GROUP_CREATED',
          jsonb_build_object('name', clean_name), auth.uid());

  return new_id;
end;
$$;

create or replace function public.admin_create_vehicle_in(
  target_organization uuid,
  requested_callsign text,
  requested_name text,
  requested_kind text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_callsign text := btrim(coalesce(requested_callsign, ''));
  clean_name text := btrim(coalesce(requested_name, ''));
  clean_kind text := btrim(coalesce(requested_kind, ''));
  new_id uuid;
begin
  if target_organization is null then raise exception 'ORGANIZATION_REQUIRED'; end if;
  if not public.is_admin_in(target_organization) then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_callsign) < 1 then raise exception 'CALLSIGN_REQUIRED'; end if;
  if char_length(clean_name) < 1 or char_length(clean_kind) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;
  -- Scoped, as `vehicles_organization_callsign_key` is.
  if exists (
    select 1 from public.vehicles
    where lower(callsign) = lower(clean_callsign) and organization_id = target_organization
  ) then
    raise exception 'CALLSIGN_TAKEN';
  end if;

  insert into public.vehicles(callsign, name, kind, organization_id)
  values (clean_callsign, clean_name, clean_kind, target_organization)
  returning id into new_id;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('VEHICLE', new_id, 'VEHICLE_CREATED',
          jsonb_build_object('callsign', clean_callsign, 'name', clean_name, 'kind', clean_kind),
          auth.uid());

  return new_id;
end;
$$;

-- A member's own availability is not an administrator's command, but it names
-- its service for the same reason a create does: after P2 a person may hold a
-- member record in each, so it has to be told which one it is speaking for.
create or replace function public.set_own_availability_in(
  target_organization uuid,
  requested_available boolean,
  requested_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid;
  clean_note text := nullif(btrim(coalesce(requested_note, '')), '');
  previous boolean;
begin
  if target_organization is null then raise exception 'ORGANIZATION_REQUIRED'; end if;
  if not public.is_staff_in(target_organization) then raise exception 'STAFF_REQUIRED'; end if;
  acting_member := public.current_member_id_in(target_organization);
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if requested_available is null then raise exception 'AVAILABILITY_REQUIRED'; end if;
  if clean_note is not null and char_length(clean_note) > 200 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select available into previous
  from public.member_availability where member_id = acting_member for update;

  insert into public.member_availability(member_id, available, note, changed_at, changed_by)
  values (acting_member, requested_available, clean_note, now(), auth.uid())
  on conflict (member_id) do update
    set available = excluded.available,
        note = excluded.note,
        changed_at = excluded.changed_at,
        changed_by = excluded.changed_by;

  -- Re-stating the same availability is not a change and writes no history row.
  -- Otherwise a screen that saves on every render would bury the real changes.
  if previous is distinct from requested_available then
    insert into public.member_availability_history(
      member_id, previous_available, next_available, note, changed_by)
    values (acting_member, previous, requested_available, clean_note, auth.uid());
  end if;
end;
$$;

comment on function public.admin_create_member_in(uuid, text, text[]) is
  'Adds a member to the named service. The service is named rather than derived '
  'because there is no row yet to derive it from.';
comment on function public.admin_create_group_in(uuid, text) is
  'Adds a group to the named service. Names are unique within a service, not '
  'across the installation.';
comment on function public.admin_create_vehicle_in(uuid, text, text, text) is
  'Adds a vehicle to the named service. Callsigns are unique within a service.';
comment on function public.set_own_availability_in(uuid, boolean, text) is
  'General availability in one service, which is NOT a response to any '
  'intervention. Takes no member parameter: it can only ever speak for you.';

revoke all on function public.admin_create_member_in(uuid, text, text[]) from public, anon;
revoke all on function public.admin_create_group_in(uuid, text) from public, anon;
revoke all on function public.admin_create_vehicle_in(uuid, text, text, text) from public, anon;
revoke all on function public.set_own_availability_in(uuid, boolean, text) from public, anon;

grant execute on function public.admin_create_member_in(uuid, text, text[]) to authenticated, service_role;
grant execute on function public.admin_create_group_in(uuid, text) to authenticated, service_role;
grant execute on function public.admin_create_vehicle_in(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.set_own_availability_in(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The old create signatures, now DVD wrappers
-- ---------------------------------------------------------------------------
--
-- Exactly the signatures the client calls today, so nothing on the DVD side
-- changes. `create or replace` keeps their grants and their comments.

create or replace function public.admin_create_member(
  requested_full_name text,
  requested_specialties text[] default '{}'::text[]
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.admin_create_member_in(
    '00000000-0000-4000-8000-000000000001'::uuid, requested_full_name, requested_specialties)
$$;

create or replace function public.admin_create_group(requested_name text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.admin_create_group_in(
    '00000000-0000-4000-8000-000000000001'::uuid, requested_name)
$$;

create or replace function public.admin_create_vehicle(
  requested_callsign text,
  requested_name text,
  requested_kind text
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.admin_create_vehicle_in(
    '00000000-0000-4000-8000-000000000001'::uuid,
    requested_callsign, requested_name, requested_kind)
$$;

create or replace function public.set_own_availability(
  requested_available boolean,
  requested_note text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.set_own_availability_in(
    '00000000-0000-4000-8000-000000000001'::uuid, requested_available, requested_note)
$$;

-- ---------------------------------------------------------------------------
-- 5. The member edits
-- ---------------------------------------------------------------------------
--
-- Same signatures, same refusals, same audit rows. What is new in each is four
-- lines: the caller must administer something, the row is read WITH its
-- service, and that service must be one they administer.

create or replace function public.admin_update_member(
  target_member uuid,
  requested_full_name text,
  requested_specialties text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(requested_full_name, ''));
  before_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'FULL_NAME_REQUIRED'; end if;

  select * into before_row from public.members where id = target_member for update;
  if before_row is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if not public.is_admin_in(before_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  update public.members
  set full_name = clean_name,
      specialties = coalesce(requested_specialties, '{}'),
      updated_at = now()
  where id = target_member;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', target_member, 'MEMBER_UPDATED',
          jsonb_build_object(
            'previous_full_name', before_row.full_name,
            'next_full_name', clean_name,
            'previous_specialties', to_jsonb(before_row.specialties),
            'next_specialties', to_jsonb(coalesce(requested_specialties, '{}'::text[]))),
          auth.uid());
end;
$$;

create or replace function public.admin_set_member_active(
  target_member uuid,
  requested_active boolean,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  member_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active, organization_id into member_row
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if not public.is_admin_in(member_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  update public.members set active = requested_active, updated_at = now()
  where id = target_member;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', member_row.active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$$;

create or replace function public.admin_link_member_account(
  target_member uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_row record;
  existing_member uuid;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;

  -- FOUND rather than a NULL check: `user_id` is legitimately NULL for a member
  -- who has no account yet, so the value cannot distinguish "no such member"
  -- from "member not linked". FOUND is set by the SELECT itself.
  select user_id, organization_id into member_row
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if not public.is_admin_in(member_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  -- Both directions are one-to-one. Reporting them separately matters: "this
  -- person already has an account" and "this account is already somebody else"
  -- need different corrections from the administrator.
  if member_row.user_id is not null and member_row.user_id <> target_user then
    raise exception 'MEMBER_ALREADY_LINKED';
  end if;

  -- Per SERVICE, matching `members_organization_user_key`. P2 made that
  -- constraint per-service exactly so one person may serve in both; an
  -- installation-wide check here would have made the second link impossible.
  select id into existing_member
  from public.members
  where user_id = target_user
    and organization_id = member_row.organization_id
    and id <> target_member;
  if existing_member is not null then raise exception 'ACCOUNT_ALREADY_LINKED'; end if;

  -- Already linked to this same account: a retry, not a second link.
  if member_row.user_id = target_user then return; end if;

  update public.members set user_id = target_user, updated_at = now()
  where id = target_member;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACCOUNT_LINKED',
          jsonb_build_object('user_id', target_user), auth.uid());
end;
$$;

create or replace function public.admin_unlink_member_account(
  target_member uuid,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  member_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select user_id, organization_id into member_row
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if not public.is_admin_in(member_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  -- Already unlinked: nothing to record.
  if member_row.user_id is null then return; end if;

  update public.members set user_id = null, updated_at = now() where id = target_member;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACCOUNT_UNLINKED',
          jsonb_build_object('previous_user_id', member_row.user_id), clean_reason, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The group edits
-- ---------------------------------------------------------------------------

create or replace function public.admin_rename_group(
  target_group uuid,
  requested_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(requested_name, ''));
  group_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'NAME_REQUIRED'; end if;

  select name, organization_id into group_row
  from public.groups where id = target_group for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if not public.is_admin_in(group_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if exists (
    select 1 from public.groups
    where lower(name) = lower(clean_name)
      and organization_id = group_row.organization_id
      and id <> target_group
  ) then raise exception 'GROUP_NAME_TAKEN'; end if;

  update public.groups set name = clean_name where id = target_group;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('GROUP', target_group, 'GROUP_RENAMED',
          jsonb_build_object('previous_name', group_row.name, 'next_name', clean_name),
          auth.uid());
end;
$$;

create or replace function public.admin_set_group_active(
  target_group uuid,
  requested_active boolean,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  group_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active, organization_id into group_row
  from public.groups where id = target_group for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if not public.is_admin_in(group_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  update public.groups set active = requested_active where id = target_group;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('GROUP', target_group, 'GROUP_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', group_row.active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$$;

create or replace function public.admin_set_group_members(
  target_group uuid,
  member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested uuid[] := coalesce(member_ids, '{}');
  group_organization uuid;
  added uuid[];
  removed uuid[];
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;

  select organization_id into group_organization
  from public.groups where id = target_group for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if not public.is_admin_in(group_organization) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  -- Every requested member must exist. Silently dropping an unknown id would
  -- leave the administrator believing they had assigned somebody they had not.
  if exists (
    select 1 from unnest(requested) as requested_id
    where not exists (select 1 from public.members where id = requested_id)
  ) then raise exception 'MEMBER_NOT_FOUND'; end if;

  -- And every one of them must serve in THIS group's service. P2's
  -- `enforce_group_member_organization` would refuse the insert anyway; saying
  -- so here means the administrator is told which mistake they made, and says
  -- it BEFORE the delete below has removed anybody.
  if exists (
    select 1 from unnest(requested) as requested_id
    join public.members member_row on member_row.id = requested_id
    where member_row.organization_id is distinct from group_organization
  ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

  select coalesce(array_agg(candidate), '{}') into added
  from unnest(requested) as candidate
  where not exists (
    select 1 from public.group_members
    where group_id = target_group and member_id = candidate);

  select coalesce(array_agg(existing.member_id), '{}') into removed
  from public.group_members existing
  where existing.group_id = target_group and not (existing.member_id = any(requested));

  delete from public.group_members
  where group_id = target_group and not (member_id = any(requested));

  insert into public.group_members(group_id, member_id)
  select target_group, candidate from unnest(requested) as candidate
  on conflict do nothing;

  if array_length(added, 1) is not null or array_length(removed, 1) is not null then
    insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
    values ('GROUP', target_group, 'GROUP_MEMBERS_CHANGED',
            jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed)),
            auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The vehicle edits
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_vehicle(
  target_vehicle uuid,
  requested_callsign text,
  requested_name text,
  requested_kind text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_callsign text := btrim(coalesce(requested_callsign, ''));
  clean_name text := btrim(coalesce(requested_name, ''));
  clean_kind text := btrim(coalesce(requested_kind, ''));
  before_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_callsign) < 1 then raise exception 'CALLSIGN_REQUIRED'; end if;
  if char_length(clean_name) < 1 or char_length(clean_kind) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  select * into before_row from public.vehicles where id = target_vehicle for update;
  if before_row is null then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if not public.is_admin_in(before_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if exists (
    select 1 from public.vehicles
    where lower(callsign) = lower(clean_callsign)
      and organization_id = before_row.organization_id
      and id <> target_vehicle
  ) then raise exception 'CALLSIGN_TAKEN'; end if;

  update public.vehicles
  set callsign = clean_callsign, name = clean_name, kind = clean_kind
  where id = target_vehicle;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('VEHICLE', target_vehicle, 'VEHICLE_UPDATED',
          jsonb_build_object(
            'previous_callsign', before_row.callsign, 'next_callsign', clean_callsign,
            'previous_name', before_row.name, 'next_name', clean_name,
            'previous_kind', before_row.kind, 'next_kind', clean_kind),
          auth.uid());
end;
$$;

create or replace function public.admin_set_vehicle_active(
  target_vehicle uuid,
  requested_active boolean,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  vehicle_row record;
begin
  if not public.is_admin_anywhere() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active, organization_id into vehicle_row
  from public.vehicles where id = target_vehicle for update;
  if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if not public.is_admin_in(vehicle_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  update public.vehicles set active = requested_active where id = target_vehicle;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('VEHICLE', target_vehicle, 'VEHICLE_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', vehicle_row.active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$$;
