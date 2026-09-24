-- ===========================================================================
-- 202609250028 - a command may only touch a call-out in its own service
--
-- Still P4b. `202609250027` isolated the four intervention tables and their
-- eight commands. Four OTHER `security definer` commands write records that
-- hang off an intervention, and none of them is reached by a policy:
--
--   attendance_check_in        attendance_intervals
--   set_journey_progress       intervention_journey, and its history
--   record_vehicle_departure   vehicle_movements
--   submit_response            intervention_responses, and its revisions
--
-- Those tables belong to P4c and P4d. The question "may you touch THIS
-- call-out" does not: it is about `interventions`, which is P4b's, and P4b is
-- what made SZS call-outs exist for them to be pointed at. A phase closes the
-- boundary it opens.
--
-- ---------------------------------------------------------------------------
-- What was reachable, measured on a schema at 202609250027
-- ---------------------------------------------------------------------------
--
-- 1. `attendance_check_in` asked `is_dvd_staff()` and that the call-out was
--    open, and nothing about either service. A DVD commander could check a DVD
--    member in on an SZS call-out; the interval then took its
--    `organization_id` from the intervention, so an SZS-owned attendance row
--    named a DVD member.
--
-- 2. `set_journey_progress` resolved the caller with `current_member_id()` -
--    the DVD shim - while `is_recipient_of` now resolves in the call-out's own
--    service. For somebody holding a member record in each, those are two
--    different people: the SZS record passed the recipient check and the DVD
--    record was written onto the SZS call-out. Measured, not argued:
--
--      set_journey_progress on the SZS call-out   OK
--      intervention_journey.member_id             the DVD member record
--      intervention_journey.organization_id       SZS
--
-- 3. `record_vehicle_departure` asked `is_dvd_staff()` and nothing about the
--    vehicle's service or the call-out's. A DVD vehicle could be sent to an
--    SZS incident.
--
-- 4. `submit_response` is NOT exploitable, and the reason is worth recording
--    because it is one line away from being so: it looks the recipient up
--    INLINE against `acting_member` rather than calling `is_recipient_of`, so
--    the member it checks and the member it writes are always the same one.
--    It is still DVD-blind - an SZS recipient cannot answer their own call-out
--    at all, because `current_member_id()` has no SZS answer - but that fails
--    CLOSED, writes nothing, and belongs to P4c along with the table. It is
--    deliberately untouched here, and asserted to be unchanged.
--
-- ---------------------------------------------------------------------------
-- The smallest guard
-- ---------------------------------------------------------------------------
--
-- Each command already looks its intervention up. It now reads the service
-- with it and asks two questions instead of one:
--
--   is the CALLER staff in that service              -> STAFF_REQUIRED
--   does the row being written belong there too      -> ORGANIZATION_MISMATCH
--
-- The two are separate on purpose. The installation owner is staff everywhere,
-- so for them the first never fires and the second is what catches a DVD
-- member being checked in on an SZS call-out.
--
-- `is_staff_anywhere()` is asked first, before the intervention is read, so a
-- caller with no operational standing is refused without learning whether the
-- id exists - and so `STAFF_REQUIRED` keeps being the answer the existing
-- suspended and unapproved assertions expect.
--
-- No signature changes, so nothing here can become an ambiguous overload, and
-- `202609130006a` does not re-create any of these four.
--
-- ---------------------------------------------------------------------------
-- What this does NOT decide
-- ---------------------------------------------------------------------------
--
-- Whether a DVD vehicle may ever attend an SZS incident. `202609240022` settled
-- that a movement belongs to the service owning the VEHICLE, and that is
-- untouched: this only refuses attaching a vehicle to a call-out of a
-- different service, which is the conservative reading. Joint-service
-- behaviour is P7's, once Q1-Q8 are answered.
-- ===========================================================================

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
  intervention_status text;
  intervention_organization uuid;
  acting_service uuid;
  self_member uuid;
  acting_member uuid;
  new_interval uuid;
  interval_source text;
begin
  -- Staff is the floor for every path through this function, and it is checked
  -- FIRST so the refusal is honest. Since `current_member_id()` requires an
  -- effective role, a withdrawn account would otherwise be told it has no
  -- member record - when what it has lost is standing, not a roster entry.
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  -- A call-out that does not exist keeps the refusal order it has always had:
  -- the checks below answer before `INTERVENTION_NOT_FOUND` is reached.
  if intervention_organization is not null
     and not public.is_staff_in(intervention_organization) then
    raise exception 'STAFF_REQUIRED';
  end if;

  acting_service := coalesce(
    intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);
  self_member := public.current_member_id_in(acting_service);
  acting_member := coalesce(target_member, self_member);
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  -- Checking somebody else in is a command action, in THAT service.
  if target_member is not null and target_member is distinct from self_member
     and not public.is_command_in(acting_service) then
    raise exception 'COMMAND_REQUIRED';
  end if;

  -- And the person being checked in has to serve in the service that ran the
  -- call-out. Separate from the caller's own standing: the installation owner
  -- is staff in both and would otherwise sail past this.
  if intervention_organization is not null and not exists (
    select 1 from public.members
    where id = acting_member and organization_id = intervention_organization
  ) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  -- Provenance is decided here, from the authenticated identity, and is never
  -- a parameter: a client must not be able to label its own claim as though a
  -- commander had recorded it.
  interval_source := case
    when acting_member = self_member then 'SELF_DECLARED'
    else 'COMMAND_RECORDED'
  end;

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

create or replace function public.set_journey_progress(
  target_intervention uuid,
  requested_progress text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid;
  intervention_status text;
  intervention_organization uuid;
  previous text;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  if intervention_organization is not null
     and not public.is_staff_in(intervention_organization) then
    raise exception 'STAFF_REQUIRED';
  end if;

  -- THE fix for this command: resolved in the call-out's own service, so the
  -- member written and the member `is_recipient_of` checks are the same person.
  acting_member := public.current_member_id_in(
    coalesce(intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid));
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  if requested_progress is null or requested_progress not in
     ('KRECEM', 'U_PUTU', 'NA_LICU_MJESTA', 'ODUSTAJEM') then
    raise exception 'INVALID_PROGRESS';
  end if;

  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
    raise exception 'INTERVENTION_NOT_OPEN';
  end if;

  if not public.is_recipient_of(target_intervention) then
    raise exception 'NOT_A_RECIPIENT';
  end if;

  select progress into previous
  from public.intervention_journey
  where intervention_id = target_intervention and member_id = acting_member
  for update;

  insert into public.intervention_journey(
    intervention_id, member_id, progress, updated_at, updated_by)
  values (target_intervention, acting_member, requested_progress, now(), auth.uid())
  on conflict (intervention_id, member_id) do update
    set progress = excluded.progress,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  if previous is distinct from requested_progress then
    insert into public.intervention_journey_history(
      intervention_id, member_id, previous_progress, next_progress, changed_by)
    values (target_intervention, acting_member, previous, requested_progress, auth.uid());

    insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
    values (target_intervention, 'JOURNEY_PROGRESS_SET',
            jsonb_build_object('member_id', acting_member,
                               'from', previous, 'to', requested_progress),
            auth.uid());
  end if;
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
  vehicle_organization uuid;
  intervention_status text;
  intervention_organization uuid;
  new_movement uuid;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select active, organization_id into vehicle_active, vehicle_organization
  from public.vehicles where id = target_vehicle;
  if vehicle_active is null then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if not vehicle_active then raise exception 'VEHICLE_NOT_IN_SERVICE'; end if;
  if not public.is_staff_in(vehicle_organization) then raise exception 'STAFF_REQUIRED'; end if;

  if target_intervention is not null then
    select status, organization_id into intervention_status, intervention_organization
    from public.interventions where id = target_intervention;
    if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
    if not public.is_staff_in(intervention_organization) then raise exception 'STAFF_REQUIRED'; end if;
    -- A vehicle answers its own service's call-outs. Whether it may ever answer
    -- the other's is a joint-service question Q1-Q8 have not been answered for,
    -- so this refuses rather than deciding it. The movement's OWNERSHIP is
    -- unchanged and still follows the vehicle, as 202609240022 settled.
    if vehicle_organization is distinct from intervention_organization then
      raise exception 'ORGANIZATION_MISMATCH';
    end if;
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
