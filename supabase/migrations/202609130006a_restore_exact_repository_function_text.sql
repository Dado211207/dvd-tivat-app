-- ===========================================================================
-- 202609130006a - the second apply that only ever existed on the server
--
-- NO BEHAVIOUR CHANGE. Thirteen functions are re-created with the bodies
-- 202609090002, 202609120005 and 202609130006 already define. On a replay from
-- zero this file is a no-op: it is those three migrations' own text, extracted
-- from them verbatim rather than retyped.
--
-- ---------------------------------------------------------------------------
-- Why it exists
-- ---------------------------------------------------------------------------
--
-- The hosted project carries a migration this repository never had:
--
--   version 20260912201050  restore_exact_repository_function_text  24503 chars
--
-- Its own opening comment says what it was for:
--
--   "Re-applies 13 function bodies with the EXACT text of the repository
--    files, so the hosted schema fingerprint matches a local PostgreSQL byte
--    for byte. The earlier apply stripped inline comments [...]"
--
-- The same mistake as 202609230020, eleven days earlier and never reconciled:
-- an apply that carried the right SQL with the in-body comments removed, then a
-- correction that was run against the server and never committed. That is how
-- it sat unnoticed - a correction to drift is itself invisible drift when it
-- lives only on the server.
--
-- ---------------------------------------------------------------------------
-- Why 006a and NOT the end of the list
-- ---------------------------------------------------------------------------
--
-- On the hosted project this ran between 202609130006 (attendance_truth) and
-- 202609140007 (availability_and_journey). Numbering it last would not be a
-- harmless reordering - it would break three commands.
--
-- 202609230019 re-creates `admin_link_member_account`, `admin_set_group_members`
-- and `admin_unlink_member_account` so they write to `registry_audit` instead
-- of the renamed-away `organisation_audit`. Three of the thirteen functions
-- below are those three, at their pre-rename text. Applied after 019 they would
-- put `public.organisation_audit` back into the bodies, and PL/pgSQL only
-- re-parses a body when it runs, so nothing would fail until somebody added a
-- member, edited a group or linked an account - and then all three would.
--
-- At 006a it is what it was on the server: a no-op that 019 later supersedes.
--
-- ---------------------------------------------------------------------------
-- What was checked, on the hosted project and locally
-- ---------------------------------------------------------------------------
--
-- Of the thirteen, ten are defined nowhere after 006 and three are re-created
-- by 019. Comparing md5(prosrc) of all thirteen between the hosted project and
-- a local replay of this repository:
--
--   ten functions                           identical, byte for byte
--   the three that 019 re-creates           differ by exactly 4 characters
--                                           each - the length of `organisation`
--                                           minus `registry`
--
-- So the hosted bodies are this repository's text, and the only divergence is
-- the rename that 019 is supposed to have made. Nothing else moved.
-- ===========================================================================

create or replace function public.acknowledge_intervention(target_intervention uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := public.current_member_id();
  intervention_status text;
begin
  -- Staff first, and deliberately before the member-record check. Being a
  -- recipient is not authority: a withdrawn account whose member row is still
  -- on an old recipient list must be refused for the honest reason, and
  -- `MEMBER_RECORD_REQUIRED` would be a lie - they have one.
  if not public.is_dvd_staff() then raise exception 'STAFF_REQUIRED'; end if;
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if not public.is_recipient_of(target_intervention) then
    raise exception 'NOT_A_RECIPIENT';
  end if;

  select status into intervention_status
  from public.interventions where id = target_intervention;
  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status = 'DRAFT' then raise exception 'INTERVENTION_NOT_PUBLISHED'; end if;

  -- The FIRST opening is the interesting one. Re-opening the screen must not
  -- move the timestamp, or "when did they see it" stops being answerable.
  insert into public.intervention_acknowledgements(intervention_id, member_id)
  values (target_intervention, acting_member)
  on conflict (intervention_id, member_id) do nothing;
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

create or replace function public.attendance_check_in(
  target_intervention uuid,
  target_member uuid default null,
  requested_crew text default null,
  requested_task_role text default null,
  requested_vehicle uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := coalesce(target_member, public.current_member_id());
  intervention_status text;
  new_interval uuid;
  interval_source text;
begin
  -- Staff is the floor for every path through this function, and it is checked
  -- FIRST so the refusal is honest. Since section 9 made `current_member_id()`
  -- require an effective role, a withdrawn account reaches the member-record
  -- check with NULL and would otherwise be told it has no member record - when
  -- what it has lost is standing, not a roster entry.
  if not public.is_dvd_staff() then raise exception 'STAFF_REQUIRED'; end if;
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  -- Checking somebody else in is a command action.
  if target_member is not null and target_member is distinct from public.current_member_id()
     and not public.is_dvd_command() then
    raise exception 'COMMAND_REQUIRED';
  end if;

  -- Provenance is decided here, from the authenticated identity, and is never
  -- a parameter: a client must not be able to label its own claim as though a
  -- commander had recorded it.
  interval_source := case
    when acting_member = public.current_member_id() then 'SELF_DECLARED'
    else 'COMMAND_RECORDED'
  end;

  select status into intervention_status
  from public.interventions where id = target_intervention;
  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
    raise exception 'INTERVENTION_NOT_OPEN';
  end if;

  -- The exclusion constraint refuses an overlap; translate it into a clear error.
  begin
    insert into public.attendance_intervals(
      intervention_id, member_id, started_at, crew, task_role, vehicle_id,
      recorded_by, source)
    values (target_intervention, acting_member, now(),
            requested_crew, requested_task_role, requested_vehicle,
            auth.uid(), interval_source)
    returning id into new_interval;
  exception when exclusion_violation then
    raise exception 'ALREADY_CHECKED_IN';
  end;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'ATTENDANCE_CHECK_IN',
          jsonb_build_object('member_id', acting_member, 'source', interval_source),
          auth.uid());

  return new_interval;
end;
$$;

create or replace function public.attendance_confirm(
  target_interval uuid,
  requested_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.attendance_intervals;
  clean_note text := nullif(trim(coalesce(requested_note, '')), '');
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;

  select * into before_row from public.attendance_intervals
  where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;

  -- Already confirmed: a retry, not a second confirmation.
  if before_row.verified then return; end if;
  if before_row.rejected_at is not null then raise exception 'INTERVAL_REJECTED'; end if;

  update public.attendance_intervals
  set verified = true, verified_by = auth.uid(), verified_at = now()
  where id = target_interval;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, 'ATTENDANCE_CONFIRMED',
          jsonb_build_object(
            'interval_id', target_interval,
            'member_id', before_row.member_id,
            'source', before_row.source,
            'note', clean_note),
          auth.uid());
end;
$$;

create or replace function public.attendance_reject(
  target_interval uuid,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.attendance_intervals;
  clean_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(clean_reason) < 2 or char_length(clean_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals
  where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;

  -- Rejecting a record a commander has already stood behind would be a
  -- contradiction rather than a correction. Withdraw the confirmation first.
  if before_row.verified then raise exception 'INTERVAL_CONFIRMED'; end if;
  if before_row.rejected_at is not null then return; end if;

  update public.attendance_intervals
  set rejected_at = now(), rejected_by = auth.uid(), rejection_reason = clean_reason
  where id = target_interval;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, 'ATTENDANCE_REJECTED',
          jsonb_build_object(
            'interval_id', target_interval,
            'member_id', before_row.member_id,
            'source', before_row.source,
            'reason', clean_reason),
          auth.uid());
end;
$$;

create or replace function public.attendance_totals(
  from_ts timestamptz default '-infinity',
  to_ts timestamptz default 'infinity'
)
returns table (
  member_id uuid,
  full_name text,
  confirmed_intervals bigint,
  confirmed_seconds numeric,
  unverified_intervals bigint,
  unverified_seconds numeric,
  open_intervals bigint,
  rejected_intervals bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.full_name,
    -- Confirmed and closed: the only participation figure.
    count(*) filter (where a.verified and a.ended_at is not null),
    coalesce(sum(extract(epoch from (a.ended_at - a.started_at)))
             filter (where a.verified and a.ended_at is not null), 0),
    -- Closed but neither confirmed nor rejected: awaiting a commander.
    count(*) filter (
      where not a.verified and a.rejected_at is null and a.ended_at is not null),
    coalesce(sum(extract(epoch from (a.ended_at - a.started_at)))
             filter (where not a.verified and a.rejected_at is null
                       and a.ended_at is not null), 0),
    -- Still running, whatever its confirmation state. Contributes no time.
    count(*) filter (where a.ended_at is null and a.rejected_at is null),
    count(*) filter (where a.rejected_at is not null)
  from public.members m
  join public.attendance_intervals a on a.member_id = m.id
  where a.started_at >= from_ts and a.started_at <= to_ts
  group by m.id, m.full_name
$$;

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

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member_row.id
  from public.members member_row
  where member_row.user_id = auth.uid()
    and member_row.active = true
    -- Authority and identity are no longer separable: a withdrawn, unapproved
    -- or half-registered account is nobody operationally, whatever the roster
    -- still says about the person.
    and public.current_dvd_role() is not null
$$;

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

create or replace function public.record_vehicle_departure(
  target_vehicle uuid,
  target_intervention uuid default null,
  requested_purpose text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_purpose text := nullif(trim(coalesce(requested_purpose, '')), '');
  vehicle_active boolean;
  intervention_status text;
  new_movement uuid;
begin
  if not public.is_dvd_staff() then raise exception 'STAFF_REQUIRED'; end if;

  select active into vehicle_active from public.vehicles where id = target_vehicle;
  if vehicle_active is null then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if not vehicle_active then raise exception 'VEHICLE_NOT_IN_SERVICE'; end if;

  if target_intervention is not null then
    select status into intervention_status
    from public.interventions where id = target_intervention;
    if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
    if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
      raise exception 'INTERVENTION_NOT_OPEN';
    end if;
  end if;

  begin
    insert into public.vehicle_movements(
      vehicle_id, intervention_id, purpose, departed_at, departed_by)
    values (target_vehicle, target_intervention, clean_purpose, now(), auth.uid())
    returning id into new_movement;
  exception when exclusion_violation then
    -- One vehicle cannot be out twice. Say which problem it is.
    raise exception 'VEHICLE_ALREADY_OUT';
  end;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'VEHICLE_DEPARTED',
          jsonb_build_object('vehicle_id', target_vehicle, 'movement_id', new_movement),
          auth.uid());

  return new_movement;
end;
$$;

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
