-- ===========================================================================
-- ORGANISATIONAL WRITE PATHS
--
-- The gap this closes. `202609090002` built a complete response system - publish
-- a call-out, receive it, answer it, record attendance - and gave it no way to
-- create anything. `publish_intervention` takes an intervention that must
-- ALREADY exist in DRAFT, and nothing in the database could produce one.
-- `members`, `groups`, `group_members` and `vehicles` had no write path at all.
--
-- The test suite did not notice because its own helper inserts a draft as the
-- SUPERUSER, outside `asUser`, so the missing privilege never showed up in a
-- hundred passing tests. That helper is changed in this slice to go through the
-- real command, which is what makes these functions load-bearing rather than
-- decorative.
--
-- Everything here follows the established shape: a `security definer` function
-- with a fixed `search_path`, its own authority check against `auth.uid()`, an
-- audit row for every state change, and no direct INSERT/UPDATE/DELETE privilege
-- granted to any client role.
--
-- NOTHING IS EVER DELETED. Members, groups and vehicles are deactivated with a
-- reason, never removed: a member who left the society in 2024 must still resolve
-- on the attendance record of an intervention they attended in 2023. This also
-- keeps the promise made in ACCESS_MODEL.md that no client role holds DELETE
-- anywhere.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Administrative authority
--
-- ACCESS_MODEL.md already says an ADMIN "manages organisational records" while a
-- COMMANDER runs interventions. That distinction had no predicate to stand on,
-- so it existed only in prose. This is it.
--
-- Deliberately NOT the same as `is_dvd_command()`: a COMMANDER publishes
-- call-outs but does not edit the roster, and an ADMIN maintains the roster but
-- is also trusted with command (they hold it through `is_dvd_command()` already).
-- ---------------------------------------------------------------------------

create or replace function public.is_dvd_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_dvd_role() in ('OWNER', 'ADMIN'), false)
$$;

comment on function public.is_dvd_admin() is
  'Authority to maintain organisational records: members, groups, vehicles.';

-- ---------------------------------------------------------------------------
-- 2. The organisational audit trail
--
-- Same purpose as `role_audit` and `account_status_audit`: a state change that
-- leaves no record is a state change nobody can explain later.
--
-- `entity_id` carries no foreign key on purpose - it points at one of three
-- tables, and the alternative (three near-identical audit tables, or three
-- nullable columns with a check constraint) buys nothing here. `entity_kind`
-- says which table it means, and nothing is ever deleted from those tables, so
-- the reference cannot dangle.
-- ---------------------------------------------------------------------------

create table public.organisation_audit (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind in ('MEMBER', 'GROUP', 'VEHICLE')),
  entity_id uuid not null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  detail jsonb not null default '{}'::jsonb,
  reason text check (reason is null or char_length(reason) between 2 and 500),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create index organisation_audit_entity_idx
  on public.organisation_audit (entity_kind, entity_id, changed_at desc);

alter table public.organisation_audit enable row level security;

create policy organisation_audit_admin_read on public.organisation_audit for select
  using (public.is_dvd_admin());

-- ---------------------------------------------------------------------------
-- 3. Members
--
-- A member is an operational person in the society. It carries NO authority -
-- that is always read from the account - but it is what an intervention is
-- addressed to, and what attendance is recorded against.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_member(
  requested_full_name text,
  requested_specialties text[] default '{}'
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
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'FULL_NAME_REQUIRED'; end if;

  insert into public.members(full_name, specialties)
  values (clean_name, coalesce(requested_specialties, '{}'))
  returning id into new_id;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', new_id, 'MEMBER_CREATED',
          jsonb_build_object('full_name', clean_name), auth.uid());

  return new_id;
end;
$$;

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
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'FULL_NAME_REQUIRED'; end if;

  select * into before_row from public.members where id = target_member for update;
  if before_row is null then raise exception 'MEMBER_NOT_FOUND'; end if;

  update public.members
  set full_name = clean_name,
      specialties = coalesce(requested_specialties, '{}'),
      updated_at = now()
  where id = target_member;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', target_member, 'MEMBER_UPDATED',
          jsonb_build_object(
            'previous_full_name', before_row.full_name,
            'next_full_name', clean_name,
            'previous_specialties', to_jsonb(before_row.specialties),
            'next_specialties', to_jsonb(coalesce(requested_specialties, '{}'::text[]))),
          auth.uid());
end;
$$;

-- Deactivation is the closest thing to deletion this system has, and it is not
-- cosmetic: `current_member_id()` resolves only for an ACTIVE member, so this
-- removes somebody's operational identity on their very next request. It
-- therefore requires a reason, exactly as suspending an account does.
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
  before_active boolean;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active into before_active from public.members where id = target_member for update;
  if before_active is null then raise exception 'MEMBER_NOT_FOUND'; end if;

  update public.members set active = requested_active, updated_at = now()
  where id = target_member;

  insert into public.organisation_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', before_active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 3.1 Linking an account to a member
--
-- This is the join that makes the whole response system reachable. Until a
-- member row carries a `user_id`, `current_member_id()` returns NULL for that
-- person and `submit_response` refuses them with MEMBER_RECORD_REQUIRED - which
-- is every approved account today, because nothing could write this column.
--
-- Linking confers NO authority. Authority is read from `access_grants` and
-- nowhere else; this only answers "which person is this account".
-- ---------------------------------------------------------------------------

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
  existing_user uuid;
  existing_member uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  -- FOUND rather than a NULL check: `user_id` is legitimately NULL for a member
  -- who has no account yet, so the value cannot distinguish "no such member"
  -- from "member not linked". FOUND is set by the SELECT itself.
  select user_id into existing_user
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;

  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  -- Both directions are one-to-one. Reporting them separately matters: "this
  -- person already has an account" and "this account is already somebody else"
  -- need different corrections from the administrator.
  if existing_user is not null and existing_user <> target_user then
    raise exception 'MEMBER_ALREADY_LINKED';
  end if;

  select id into existing_member
  from public.members where user_id = target_user and id <> target_member;
  if existing_member is not null then raise exception 'ACCOUNT_ALREADY_LINKED'; end if;

  -- Already linked to this same account: a retry, not a second link.
  if existing_user = target_user then return; end if;

  update public.members set user_id = target_user, updated_at = now()
  where id = target_member;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
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
  existing_user uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select user_id into existing_user
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  -- Already unlinked: nothing to record.
  if existing_user is null then return; end if;

  update public.members set user_id = null, updated_at = now() where id = target_member;

  insert into public.organisation_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACCOUNT_UNLINKED',
          jsonb_build_object('previous_user_id', existing_user), clean_reason, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Groups
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_group(requested_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(requested_name, ''));
  new_id uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if exists (select 1 from public.groups where lower(name) = lower(clean_name)) then
    raise exception 'GROUP_NAME_TAKEN';
  end if;

  insert into public.groups(name) values (clean_name) returning id into new_id;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('GROUP', new_id, 'GROUP_CREATED',
          jsonb_build_object('name', clean_name), auth.uid());

  return new_id;
end;
$$;

create or replace function public.admin_rename_group(target_group uuid, requested_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(requested_name, ''));
  before_name text;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'NAME_REQUIRED'; end if;

  select name into before_name from public.groups where id = target_group for update;
  if before_name is null then raise exception 'GROUP_NOT_FOUND'; end if;

  if exists (
    select 1 from public.groups where lower(name) = lower(clean_name) and id <> target_group
  ) then raise exception 'GROUP_NAME_TAKEN'; end if;

  update public.groups set name = clean_name where id = target_group;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('GROUP', target_group, 'GROUP_RENAMED',
          jsonb_build_object('previous_name', before_name, 'next_name', clean_name), auth.uid());
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
  before_active boolean;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active into before_active from public.groups where id = target_group for update;
  if before_active is null then raise exception 'GROUP_NOT_FOUND'; end if;

  update public.groups set active = requested_active where id = target_group;

  insert into public.organisation_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('GROUP', target_group, 'GROUP_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', before_active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$$;

-- Membership is replaced as a whole rather than added and removed one row at a
-- time: the administrator is editing a list, and a partial failure halfway
-- through that list is a worse outcome than refusing the whole edit. The audit
-- records what actually changed, not the whole list, so reading the trail does
-- not require diffing snapshots by hand.
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
  group_exists boolean;
  added uuid[];
  removed uuid[];
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  select true into group_exists from public.groups where id = target_group for update;
  if group_exists is null then raise exception 'GROUP_NOT_FOUND'; end if;

  -- Every requested member must exist. Silently dropping an unknown id would
  -- leave the administrator believing they had assigned somebody they had not.
  if exists (
    select 1 from unnest(requested) as requested_id
    where not exists (select 1 from public.members where id = requested_id)
  ) then raise exception 'MEMBER_NOT_FOUND'; end if;

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
    insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
    values ('GROUP', target_group, 'GROUP_MEMBERS_CHANGED',
            jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed)),
            auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Vehicles
--
-- The owner wants to enter the society's real vehicles through the application
-- rather than a seed script, which is the whole reason this exists. Real
-- registration plates and other sensitive vehicle details are NOT part of this
-- schema and must not be added without the owner's decision.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_vehicle(
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
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_callsign) < 1 then raise exception 'CALLSIGN_REQUIRED'; end if;
  if char_length(clean_name) < 1 or char_length(clean_kind) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;
  if exists (select 1 from public.vehicles where lower(callsign) = lower(clean_callsign)) then
    raise exception 'CALLSIGN_TAKEN';
  end if;

  insert into public.vehicles(callsign, name, kind)
  values (clean_callsign, clean_name, clean_kind)
  returning id into new_id;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('VEHICLE', new_id, 'VEHICLE_CREATED',
          jsonb_build_object('callsign', clean_callsign, 'name', clean_name, 'kind', clean_kind),
          auth.uid());

  return new_id;
end;
$$;

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
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_callsign) < 1 then raise exception 'CALLSIGN_REQUIRED'; end if;
  if char_length(clean_name) < 1 or char_length(clean_kind) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  select * into before_row from public.vehicles where id = target_vehicle for update;
  if before_row is null then raise exception 'VEHICLE_NOT_FOUND'; end if;

  if exists (
    select 1 from public.vehicles
    where lower(callsign) = lower(clean_callsign) and id <> target_vehicle
  ) then raise exception 'CALLSIGN_TAKEN'; end if;

  update public.vehicles
  set callsign = clean_callsign, name = clean_name, kind = clean_kind
  where id = target_vehicle;

  insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
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
  before_active boolean;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active into before_active from public.vehicles where id = target_vehicle for update;
  if before_active is null then raise exception 'VEHICLE_NOT_FOUND'; end if;

  update public.vehicles set active = requested_active where id = target_vehicle;

  insert into public.organisation_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('VEHICLE', target_vehicle, 'VEHICLE_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', before_active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Intervention drafts
--
-- The missing first step of the call-out. A DRAFT is command-only and is not a
-- call-out: nobody is notified, and no member can see it (ACCESS_MODEL.md §6).
-- `publish_intervention` turns it into one, and only then.
--
-- Idempotent on `(created_by, idempotency_key)`, matching `publish_intervention`:
-- a commander whose connection drops mid-tap must not end up with two drafts of
-- the same incident.
-- ---------------------------------------------------------------------------

create or replace function public.create_intervention_draft(
  requested_kind text,
  requested_title text,
  requested_instructions text,
  requested_location text,
  -- `requested_` is not decoration: an unprefixed `idempotency_key` is ambiguous
  -- against the column of the same name inside this function's own body.
  requested_idempotency_key text,
  requested_other_kind_note text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_coordinate_source text default null,
  requested_assembly_point text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_title text := btrim(coalesce(requested_title, ''));
  clean_instructions text := btrim(coalesce(requested_instructions, ''));
  clean_location text := btrim(coalesce(requested_location, ''));
  clean_note text := nullif(btrim(coalesce(requested_other_kind_note, '')), '');
  clean_assembly text := nullif(btrim(coalesce(requested_assembly_point, '')), '');
  clean_key text := btrim(coalesce(requested_idempotency_key, ''));
  existing_id uuid;
  new_id uuid;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if clean_key = '' then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  -- A retry returns the draft that already exists rather than a second one.
  select id into existing_id from public.interventions
  where created_by = auth.uid() and interventions.idempotency_key = clean_key;
  if existing_id is not null then return existing_id; end if;

  if requested_kind is null or requested_kind not in
     ('POZAR', 'SAOBRACAJNA_NEZGODA', 'TEHNICKA_POMOC', 'VJEZBA', 'TEST', 'DRUGO') then
    raise exception 'INVALID_KIND';
  end if;
  if requested_kind = 'DRUGO' and clean_note is null then
    raise exception 'KIND_NOTE_REQUIRED';
  end if;
  if char_length(clean_title) < 3 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(clean_instructions) < 3 then raise exception 'INSTRUCTIONS_REQUIRED'; end if;
  -- A typed place is always required. A bare coordinate pair is not something a
  -- crew can act on at 03:00, which is why the table demands it too.
  if char_length(clean_location) < 2 then raise exception 'LOCATION_REQUIRED'; end if;

  if (requested_latitude is null) <> (requested_longitude is null) then
    raise exception 'INVALID_COORDINATES';
  end if;
  if requested_latitude is not null and (
       requested_latitude not between -90 and 90
       or requested_longitude not between -180 and 180
       or requested_coordinate_source is null
       or requested_coordinate_source not in ('MAP_PIN', 'TYPED', 'DEVICE')) then
    raise exception 'INVALID_COORDINATES';
  end if;

  insert into public.interventions(
    kind, other_kind_note, title, instructions, incident_location,
    latitude, longitude, coordinate_source, coordinate_captured_at,
    assembly_point, status, created_by, idempotency_key)
  values (
    requested_kind,
    case when requested_kind = 'DRUGO' then clean_note else null end,
    clean_title, clean_instructions, clean_location,
    requested_latitude, requested_longitude,
    case when requested_latitude is null then null else requested_coordinate_source end,
    -- Server time, never the caller's: a client must not be able to backdate
    -- when a coordinate was captured.
    case when requested_latitude is null then null else now() end,
    clean_assembly, 'DRAFT', auth.uid(), clean_key)
  returning id into new_id;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (new_id, 'INTERVENTION_DRAFTED',
          jsonb_build_object('kind', requested_kind, 'has_coordinates',
                             requested_latitude is not null),
          auth.uid());

  return new_id;
end;
$$;

-- Editing before publication. After publication the operationally important
-- edits become `intervention_updates` rows instead, so that what recipients
-- already acted on is never silently rewritten - which is why this refuses
-- anything that is no longer a DRAFT.
create or replace function public.update_intervention_draft(
  target_intervention uuid,
  requested_title text,
  requested_instructions text,
  requested_location text,
  expected_version integer,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_coordinate_source text default null,
  requested_assembly_point text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_title text := btrim(coalesce(requested_title, ''));
  clean_instructions text := btrim(coalesce(requested_instructions, ''));
  clean_location text := btrim(coalesce(requested_location, ''));
  clean_assembly text := nullif(btrim(coalesce(requested_assembly_point, '')), '');
  current_row record;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;

  select * into current_row from public.interventions
  where id = target_intervention for update;
  if current_row is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if current_row.status <> 'DRAFT' then raise exception 'INTERVENTION_NOT_DRAFT'; end if;
  if current_row.version <> expected_version then raise exception 'VERSION_CONFLICT'; end if;

  if char_length(clean_title) < 3 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(clean_instructions) < 3 then raise exception 'INSTRUCTIONS_REQUIRED'; end if;
  if char_length(clean_location) < 2 then raise exception 'LOCATION_REQUIRED'; end if;

  if (requested_latitude is null) <> (requested_longitude is null) then
    raise exception 'INVALID_COORDINATES';
  end if;
  if requested_latitude is not null and (
       requested_latitude not between -90 and 90
       or requested_longitude not between -180 and 180
       or requested_coordinate_source is null
       or requested_coordinate_source not in ('MAP_PIN', 'TYPED', 'DEVICE')) then
    raise exception 'INVALID_COORDINATES';
  end if;

  update public.interventions
  set title = clean_title,
      instructions = clean_instructions,
      incident_location = clean_location,
      latitude = requested_latitude,
      longitude = requested_longitude,
      coordinate_source =
        case when requested_latitude is null then null else requested_coordinate_source end,
      coordinate_captured_at =
        case
          when requested_latitude is null then null
          -- Keep the original capture time when the pin has not moved.
          when current_row.latitude is not distinct from requested_latitude
           and current_row.longitude is not distinct from requested_longitude
            then current_row.coordinate_captured_at
          else now()
        end,
      assembly_point = clean_assembly,
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_DRAFT_UPDATED',
          jsonb_build_object('version', current_row.version + 1), auth.uid());
end;
$$;

-- A draft nobody published is abandoned work, not history. It is CANCELLED
-- rather than deleted, so the audit trail of who drafted what survives.
create or replace function public.discard_intervention_draft(
  target_intervention uuid,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  current_status text;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select status into current_status from public.interventions
  where id = target_intervention for update;
  if current_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if current_status <> 'DRAFT' then raise exception 'INTERVENTION_NOT_DRAFT'; end if;

  update public.interventions
  set status = 'CANCELLED',
      -- The table requires published_at whenever status is not DRAFT, and
      -- requires closed_at with a reason for CANCELLED. A discarded draft was
      -- never published, so both timestamps record the same moment: the only
      -- thing that ever happened to it.
      published_at = now(),
      closed_at = now(),
      closed_by = auth.uid(),
      close_reason = clean_reason,
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_DRAFT_DISCARDED',
          jsonb_build_object('reason', clean_reason), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges
--
-- Read access to the new audit table for signed-in clients (RLS then decides
-- which rows), execute on the new commands, and nothing whatsoever for `anon`.
--
-- `revoke ... from public` is not optional: PostgreSQL grants EXECUTE on a new
-- function to PUBLIC by default, and `anon` inherits it. That was found on the
-- real project rather than reasoned about, and it is why `202609110004` exists.
-- ---------------------------------------------------------------------------

-- REVOKE BEFORE GRANT, and from BOTH client roles. A Supabase project ships
-- with `alter default privileges in schema public grant all on tables to anon,
-- authenticated, service_role`, so this table arrives already holding INSERT,
-- UPDATE, DELETE and TRUNCATE for both of them. Adding `select` on top of that
-- changes nothing; only the revoke does. This is the identical mistake
-- `202609090002` made and `202609110003` had to correct, caught here by
-- *"never grants a client role a privilege with no policy behind it"* - which is
-- why the stub reproduces the platform's default grants rather than trusting a
-- bare PostgreSQL instance where those privileges were never there to take.
revoke all on public.organisation_audit from anon;
revoke all on public.organisation_audit from authenticated;
grant select on public.organisation_audit to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.is_dvd_admin()',
    'public.admin_create_member(text, text[])',
    'public.admin_update_member(uuid, text, text[])',
    'public.admin_set_member_active(uuid, boolean, text)',
    'public.admin_link_member_account(uuid, uuid)',
    'public.admin_unlink_member_account(uuid, text)',
    'public.admin_create_group(text)',
    'public.admin_rename_group(uuid, text)',
    'public.admin_set_group_active(uuid, boolean, text)',
    'public.admin_set_group_members(uuid, uuid[])',
    'public.admin_create_vehicle(text, text, text)',
    'public.admin_update_vehicle(uuid, text, text, text)',
    'public.admin_set_vehicle_active(uuid, boolean, text)',
    'public.create_intervention_draft(text, text, text, text, text, text, double precision, double precision, text, text)',
    'public.update_intervention_draft(uuid, text, text, text, integer, double precision, double precision, text, text)',
    'public.discard_intervention_draft(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
