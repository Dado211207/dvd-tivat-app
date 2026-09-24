-- ===========================================================================
-- 202609250029 - everything a call-out produces belongs to its service
--
-- The last of P4b. `202609250027` isolated the four intervention tables,
-- `202609250028` stopped four commands touching another service's call-out.
-- This closes the rest of what P4b made reachable: what those commands WRITE,
-- the commands that act on what they wrote, and the two definer functions that
-- READ it without any policy in the way.
--
-- ---------------------------------------------------------------------------
-- How the list was made
-- ---------------------------------------------------------------------------
--
-- From the catalogue, because the two lists before it were made by hand and
-- each was found short by review. Every table reachable from `interventions`
-- by foreign key - fifteen, counting the five 027 already owns - then every
-- policy on them, then every client-callable function whose body names one of
-- them, then every trigger that labels their rows with a service. Whatever
-- still asked `is_dvd_*()`, `current_dvd_role()` or the DVD shim
-- `current_member_id()`, or fell back to DVD when it had no parent, is either
-- fixed below or named under "What stays in P4c-e" with the phase that owns
-- it. The test runs the same derivation, so a table or function added later is
-- caught by construction rather than by a reviewer.
--
-- ---------------------------------------------------------------------------
-- 1. Reads: ten tables, eighteen policies
-- ---------------------------------------------------------------------------
--
--   notification_outbox              publication queues a row per recipient
--   notification_delivery_attempts   what the push worker did with it
--   intervention_journey             and its history
--   attendance_intervals             who turned out, and for how long
--   attendance_corrections           every change command made to that
--   attendance_correction_requests   a member asking for one
--   vehicle_movements                which vehicle went where
--   intervention_responses           and its revisions
--
-- Fourteen of the eighteen asked `is_dvd_command()`, `is_dvd_staff()` or the
-- DVD shim. Thirteen are SELECT policies, through which a DVD-only commander
-- could read who SZS sent, who answered, who turned out, what was corrected and
-- which vehicle went; all thirteen are rewritten here. The fourteenth is the
-- correction-request INSERT, which fails closed and is left to P4d below.
-- Nothing has to be derived or backfilled: P2 gave all ten `organization_id`,
-- from the parent row by trigger. What was missing is that the policies never
-- asked.
--
-- The other four need nothing: three recipient reads written in terms of
-- `is_recipient_of`, which 027 made service-aware, and "your own correction
-- request", which is about the account rather than a service.
--
-- ---------------------------------------------------------------------------
-- 2-4. Writes: eight commands
-- ---------------------------------------------------------------------------
--
-- Seven `security definer` commands act on rows that only exist because P4b
-- let SZS check people in and send vehicles out. Each looked its row up by id
-- and asked `is_dvd_command()` or `is_dvd_staff()` and nothing else, so a DVD
-- commander could confirm, reject, unconfirm or correct SZS attendance, and a
-- DVD member could return an SZS vehicle. They now ask the same two questions
-- as the rest of the phase: is the caller staff or command IN THAT ROW'S
-- SERVICE, and does what is being pointed at belong there too.
--
-- `attendance_check_in` gains the second half for `requested_vehicle`, which
-- went into the interval unchecked - an SZS attendance row could name a DVD
-- vehicle.
--
-- And the two vehicle commands now say whose audit row they write. With no
-- call-out to derive a service from, `operational_audit` falls back to DVD
-- (`dvd-if-orphaned`), which was right while DVD was the only service. Since
-- 028 lets SZS send its own vehicle out, that filed an SZS vehicle's movement
-- under DVD: readable by DVD command, invisible to SZS command. Nothing is
-- relabelled here - the trigger refuses changing a row's service - so a row
-- written earlier keeps its label. Such rows can exist only where an SZS
-- vehicle existed, i.e. from 202609240024 on; the hosted project has none of
-- 022-029 applied, so it has none.
--
-- ---------------------------------------------------------------------------
-- 5. Reads no policy reaches: two definer functions
-- ---------------------------------------------------------------------------
--
-- `intervention_audit(id)` returned a call-out's whole chronology - location,
-- who was sent, who answered, who checked in - to anybody for whom
-- `is_dvd_command()` held, so a DVD commander could pass an SZS call-out's id.
-- It now asks exactly what the two `operational_audit` policies ask, and so
-- returns nothing a direct read of that table would not.
--
-- `is_eligible_recipient_in(member, service)` is 027's, and 027 dropped a bound
-- P0 had put there on purpose. P0's `is_eligible_recipient` answered only about
-- somebody the caller served with. 027 moved the question to the service
-- running the call-out - right - and asked nothing about the caller - wrong: any
-- signed-in account, a citizen included, could ask whether a given member of
-- either service was active, linked and serving. It now answers only somebody
-- who is staff in the service being asked about.
--
-- ---------------------------------------------------------------------------
-- What stays in P4c-e
-- ---------------------------------------------------------------------------
--
-- Only "may you see or touch this row at all" moves here. The FULL workflows
-- stay where the plan puts them, and each fails closed until then:
--
--   intervention_responses, intervention_response_revisions  P4c.
--     `submit_response` resolves the caller through `current_member_id()`, so
--     an SZS recipient cannot answer their own call-out at all. It writes
--     nothing, so no SZS row reaches these two tables yet; the policies are
--     corrected now so they are right before P4c makes rows possible.
--   intervention_journey, intervention_journey_history  P4c. Its one command,
--     `set_journey_progress`, was made service-aware by 028 and its reads are
--     scoped here, so what isolation needed of these two is done.
--   attendance_correction_requests  P4d.
--     `correction_requests_self_create` checks the interval against
--     `current_member_id()`, so an SZS member cannot ask for a correction to
--     their own SZS attendance - and, because 028 refuses a member of one
--     service on the other's call-out, no SZS request can exist. Opening the
--     request path to SZS is P4d's; its read is corrected here anyway.
--   attendance_intervals, attendance_corrections, vehicle_movements  P4d.
--     Crediting (`credited_organization_id`) and the rest of the lifecycle.
--   notification_outbox, notification_delivery_attempts  P4e - and that phase
--     carries a hazard none of this reaches: the push worker reads with the
--     SERVICE-ROLE client, which bypasses RLS entirely. No policy written here
--     constrains it. The organisation filter has to be written into the
--     worker's own queries by hand. `register_web_push_subscription` is still
--     DVD-only for the same phase: an SZS-only member cannot register a device.
--
-- `attendance_totals()` needs nothing here, and not for the reason it first
-- appears. It is NOT `security definer`, so the caller's own policies decide
-- what it aggregates - and it joins `members` as well as
-- `attendance_intervals`. P4a's `members` policy was ALREADY dropping other
-- services' people from that join before this file existed; this adds a second,
-- independent bound. The test asserts it stays caller-rights, because making it
-- `security definer` would remove both at once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The read policies
-- ---------------------------------------------------------------------------

alter policy outbox_command_read on public.notification_outbox
  using (public.is_command_in(organization_id));
alter policy outbox_self_read on public.notification_outbox
  using (member_id = public.current_member_id_in(organization_id));

alter policy delivery_attempts_command_read on public.notification_delivery_attempts
  using (public.is_command_in(organization_id));

alter policy intervention_journey_command_read on public.intervention_journey
  using (public.is_command_in(organization_id));

alter policy intervention_journey_history_command_read on public.intervention_journey_history
  using (public.is_command_in(organization_id));
alter policy intervention_journey_history_self_read on public.intervention_journey_history
  using (member_id = public.current_member_id_in(organization_id));

alter policy attendance_command_read on public.attendance_intervals
  using (public.is_command_in(organization_id));
alter policy attendance_self_read on public.attendance_intervals
  using (member_id = public.current_member_id_in(organization_id));

-- `attendance_correct` writes one of these per correction, labelled with the
-- interval's service. Missed by the hand-made list; found by the derived one.
alter policy corrections_command_read on public.attendance_corrections
  using (public.is_command_in(organization_id));

-- No SZS row can reach this table yet (see the header), and for DVD rows the
-- two predicates are the same function: `is_dvd_command()` IS
-- `is_command_in(DVD)`. Corrected now so it is right before P4d opens the
-- request path, as with the two response tables below.
alter policy correction_requests_command_read on public.attendance_correction_requests
  using (public.is_command_in(organization_id));

-- A movement belongs to the service that owns the VEHICLE - the decision
-- 202609240022 settled and this does not revisit. So the people who may see it
-- are that service's staff. P7 is where SZS is granted sight of a DVD movement
-- during a joint intervention, explicitly, rather than by leaving this open.
alter policy vehicle_movements_staff_read on public.vehicle_movements
  using (public.is_staff_in(organization_id));

alter policy responses_command_read on public.intervention_responses
  using (public.is_command_in(organization_id));

alter policy response_revisions_command_read on public.intervention_response_revisions
  using (public.is_command_in(organization_id));

-- ---------------------------------------------------------------------------
-- 2. Checking somebody in, with the vehicle checked too
-- ---------------------------------------------------------------------------
--
-- As 202609250028 left it, plus one guard: `requested_vehicle` was passed
-- straight into the interval, so an SZS attendance row could name a DVD
-- vehicle. Whether a vehicle may ever attend the other service's incident is
-- P7's question; until it is answered, it may not.

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
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  if intervention_organization is not null
     and not public.is_staff_in(intervention_organization) then
    raise exception 'STAFF_REQUIRED';
  end if;

  acting_service := coalesce(
    intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);
  self_member := public.current_member_id_in(acting_service);
  acting_member := coalesce(target_member, self_member);
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  if target_member is not null and target_member is distinct from self_member
     and not public.is_command_in(acting_service) then
    raise exception 'COMMAND_REQUIRED';
  end if;

  if intervention_organization is not null and not exists (
    select 1 from public.members
    where id = acting_member and organization_id = intervention_organization
  ) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  -- The vehicle, which went in unchecked until now.
  if requested_vehicle is not null and intervention_organization is not null and not exists (
    select 1 from public.vehicles
    where id = requested_vehicle and organization_id = intervention_organization
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

create or replace function public.attendance_check_out(
  target_intervention uuid,
  target_member uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  intervention_organization uuid;
  acting_service uuid;
  self_member uuid;
  acting_member uuid;
  open_interval uuid;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select organization_id into intervention_organization
  from public.interventions where id = target_intervention;
  if intervention_organization is not null
     and not public.is_staff_in(intervention_organization) then
    raise exception 'STAFF_REQUIRED';
  end if;

  acting_service := coalesce(
    intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);
  self_member := public.current_member_id_in(acting_service);
  acting_member := coalesce(target_member, self_member);
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if target_member is not null and target_member is distinct from self_member
     and not public.is_command_in(acting_service) then
    raise exception 'COMMAND_REQUIRED';
  end if;

  select id into open_interval
  from public.attendance_intervals
  where intervention_id = target_intervention and member_id = acting_member and ended_at is null
  order by started_at desc limit 1
  for update;

  if open_interval is null then raise exception 'NOT_CHECKED_IN'; end if;

  update public.attendance_intervals set ended_at = now() where id = open_interval;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'ATTENDANCE_CHECK_OUT',
          jsonb_build_object('member_id', acting_member), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The attendance lifecycle
-- ---------------------------------------------------------------------------
--
-- Each of these already loads the whole row, so its service is in hand; the
-- guard is one check after the not-found line. Everything else is as it was.

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
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;

  select * into before_row from public.attendance_intervals
  where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;
  if not public.is_command_in(before_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

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
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(clean_reason) < 2 or char_length(clean_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals
  where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;
  if not public.is_command_in(before_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

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

create or replace function public.attendance_unconfirm(
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
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(clean_reason) < 2 or char_length(clean_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals
  where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;
  if not public.is_command_in(before_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if not before_row.verified then return; end if;

  update public.attendance_intervals
  set verified = false, verified_by = null, verified_at = null
  where id = target_interval;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, 'ATTENDANCE_UNCONFIRMED',
          jsonb_build_object('interval_id', target_interval, 'reason', clean_reason),
          auth.uid());
end;
$$;

create or replace function public.attendance_correct(
  target_interval uuid,
  new_started_at timestamptz,
  new_ended_at timestamptz,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.attendance_intervals;
  after_row public.attendance_intervals;
  normalized_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;
  if not public.is_command_in(before_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if new_ended_at is not null and new_started_at is not null and new_ended_at <= new_started_at then
    raise exception 'INVALID_INTERVAL';
  end if;

  begin
    update public.attendance_intervals
    set started_at = coalesce(new_started_at, started_at),
        ended_at = new_ended_at
    where id = target_interval
    returning * into after_row;
  exception when exclusion_violation then
    raise exception 'CORRECTION_WOULD_OVERLAP';
  end;

  insert into public.attendance_corrections(
    interval_id, before_value, after_value, reason, corrected_by)
  values (
    target_interval,
    jsonb_build_object('started_at', before_row.started_at, 'ended_at', before_row.ended_at),
    jsonb_build_object('started_at', after_row.started_at, 'ended_at', after_row.ended_at),
    normalized_reason, auth.uid());

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, 'ATTENDANCE_CORRECTED',
          jsonb_build_object('interval_id', target_interval, 'reason', normalized_reason), auth.uid());
end;
$$;

-- Delegates to `attendance_confirm`, so the service check above covers every
-- interval in the batch. What it needs of its own is the outer gate: an SZS
-- commander must get past it to confirm their own service's intervals.
create or replace function public.attendance_confirm_many(
  target_intervals uuid[],
  requested_note text default null
)
returns table(interval_id uuid, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate uuid;
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if target_intervals is null or array_length(target_intervals, 1) is null then
    raise exception 'NO_INTERVALS';
  end if;
  -- A cap, because an unbounded array from a client is an unbounded statement.
  if array_length(target_intervals, 1) > 200 then raise exception 'TOO_MANY_INTERVALS'; end if;

  foreach candidate in array target_intervals loop
    begin
      perform public.attendance_confirm(candidate, requested_note);
      interval_id := candidate; outcome := 'CONFIRMED';
    exception when others then
      -- One unconfirmable interval must not abandon the other twenty-nine.
      -- An interval of another service now reports ORGANIZATION_MISMATCH here
      -- rather than being confirmed.
      interval_id := candidate; outcome := SQLERRM;
    end;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sending a vehicle out and bringing it back
-- ---------------------------------------------------------------------------
--
-- `record_vehicle_departure` is 028's text with one change, the service named
-- on its audit row. With a call-out, `organization_id` is left null and the
-- trigger derives it from the call-out exactly as before - 028 has already
-- refused a vehicle and call-out of different services by then. Without one,
-- the trigger fell back to DVD; the movement belongs to the vehicle's service
-- (202609240022), so its audit row now does too. For a DVD vehicle that is the
-- same answer as before.

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

  insert into public.operational_audit(
    intervention_id, event_type, detail, actor_user_id, organization_id)
  values (target_intervention, 'VEHICLE_DEPARTED',
          jsonb_build_object('vehicle_id', target_vehicle, 'movement_id', new_movement),
          auth.uid(),
          case when target_intervention is null then vehicle_organization end);

  return new_movement;
end;
$$;

create or replace function public.record_vehicle_return(target_movement uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.vehicle_movements;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select * into before_row from public.vehicle_movements
  where id = target_movement for update;
  if before_row.id is null then raise exception 'MOVEMENT_NOT_FOUND'; end if;
  -- The movement belongs to the service owning the vehicle, so that is whose
  -- staff may bring it back.
  if not public.is_staff_in(before_row.organization_id) then
    raise exception 'STAFF_REQUIRED';
  end if;
  if before_row.returned_at is not null then raise exception 'VEHICLE_ALREADY_RETURNED'; end if;

  update public.vehicle_movements
  set returned_at = now(), returned_by = auth.uid()
  where id = target_movement;

  -- As for the departure: the movement's own service when there is no call-out
  -- to derive one from, and the trigger's derivation, unchanged, when there is.
  insert into public.operational_audit(
    intervention_id, event_type, detail, actor_user_id, organization_id)
  values (before_row.intervention_id, 'VEHICLE_RETURNED',
          jsonb_build_object('vehicle_id', before_row.vehicle_id,
                             'movement_id', target_movement),
          auth.uid(),
          case when before_row.intervention_id is null then before_row.organization_id end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The two definer READERS
-- ---------------------------------------------------------------------------
--
-- A policy binds a caller-rights query and nothing else. These two read with
-- their owner's rights, so every policy above passes them by.
--
-- `intervention_audit`: the 202609230021 text, character for character, but
-- for the one predicate. `is_command_in(entry.organization_id)` is the
-- `operational_audit_command_read` policy and `is_recipient_of` the
-- `operational_audit_recipient_read` one, so the function now returns exactly
-- the rows a direct read would - the test asserts that equality for every
-- account, rather than a sample. For a DVD call-out the predicate is unchanged:
-- `is_dvd_command()` IS `is_command_in(DVD)`.
--
-- This makes 202609230021's POSITION load-bearing, as 202609130006a's already
-- is. It re-creates this function at its DVD-only text, so replayed after this
-- file it would reopen the leak. It sorts before, and the test that asserted
-- "021 is a no-op at the end of the list" now asserts both halves of that.

create or replace function public.intervention_audit(target_intervention uuid)
returns table (
  event_id uuid,
  occurred_at timestamptz,
  event_type text,
  detail jsonb,
  actor_name text,
  actor_is_you boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    entry.id,
    entry.occurred_at,
    entry.event_type,
    entry.detail,
    actor.full_name,
    entry.actor_user_id = auth.uid()
  from public.operational_audit entry
  left join public.profiles actor on actor.user_id = entry.actor_user_id
  where entry.intervention_id = target_intervention
    and (public.is_command_in(entry.organization_id) or public.is_recipient_of(target_intervention))
  -- Deterministic: two events written inside one transaction share `occurred_at`
  -- to the microsecond, and an archive whose lines shuffle between two readings
  -- of the same record is not a record. The id breaks the tie the same way
  -- every time.
  order by entry.occurred_at, entry.id
$$;

-- `is_eligible_recipient_in`: 027's text plus the caller. Nobody who may ask
-- loses the answer - `publish_intervention` requires command in that service,
-- `eligible_recipients_in` already requires staff there, and
-- `register_web_push_subscription` requires DVD standing before asking about
-- the caller's own DVD record. Anybody else is told false, as P0 told somebody
-- who did not serve with the member. That includes the service role, which has
-- no user; nothing calls it that way - the push worker applies the same
-- conditions itself, in supabase/functions/send-web-push/policy.ts.

create or replace function public.is_eligible_recipient_in(
  target_member uuid,
  target_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.members member
    join public.profiles profile on profile.user_id = member.user_id
    join public.access_grants grant_row on grant_row.user_id = member.user_id
    where member.id = target_member
      -- Only somebody who serves in that service may ask about its people.
      and public.is_staff_in(target_organization)
      and member.organization_id = target_organization
      and member.active = true
      and member.user_id is not null
      and profile.profile_complete = true
      and grant_row.active = true
      and (
        -- The installation owner turns out to incidents like anybody else and
        -- holds no membership by design.
        grant_row.role = 'OWNER'
        or exists (
          select 1
          from public.organization_memberships membership
          join public.organizations organization
            on organization.id = membership.organization_id
          where membership.user_id = member.user_id
            and membership.organization_id = target_organization
            and membership.active = true
            and organization.active = true
            and membership.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
        )
      )
  )
$$;

comment on function public.is_eligible_recipient_in(uuid, uuid) is
  'Whether this member may be sent a call-out BY THIS SERVICE. Asks the '
  'service running the call-out, not whoever happens to be calling - and '
  'answers only somebody who is staff in that service; anybody else is told '
  'false.';
