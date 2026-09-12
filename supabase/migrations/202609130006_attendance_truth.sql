-- ===========================================================================
-- ATTENDANCE TRUTH, AND THE TWO REMAINING WRITE GAPS
--
-- The defect this closes. `202609090002` built attendance as "the primary
-- capability" and then let a self-declared claim count as participation:
--
--   1. `attendance_check_in(intervention)` with no target member requires only
--      `is_dvd_staff()`, so a FIREFIGHTER creates their own interval.
--   2. The row lands `verified = false`, which looks like a safeguard.
--   3. `attendance_totals()` never filtered on `verified`. It summed every
--      closed interval.
--
-- So "a member actually attended" - then one of nine facts this schema exists to
-- keep separate, and now deliberately split into two - was in practice "a member
-- said they were there". Worse,
-- `verified = true` was set in exactly one place: as a SIDE EFFECT of
-- `attendance_correct()`. Confirmation was not a decision anybody made; it was
-- something that happened to a record when a commander fixed its times. Nothing
-- read the column at all.
--
-- The design chosen, of the two the owner offered: **intervals with an explicit
-- source and confirmation state**, rather than a separate claims table. It keeps
-- the cross-intervention overlap exclusion constraint (which is the hard part
-- and already correct), keeps several intervals per member, and leaves history
-- and CSV reading one table instead of unioning two.
--
-- Two facts, kept separate on purpose:
--
--   `source`  - WHO ASSERTED IT. Self-declared, or recorded by command.
--   verification state - WHETHER COMMAND HAS CONFIRMED IT. Pending, confirmed
--                        or rejected.
--
-- They are independent. A commander recording somebody else's arrival is
-- `COMMAND_RECORDED` and still unconfirmed until confirmed; that is deliberate,
-- because "I wrote it down" and "I stand behind it" are different claims.
--
-- Nothing is deleted and no fact is rewritten: a rejected claim stays on the
-- record as rejected, with a reason, and simply stops counting.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance
--
-- `UNKNOWN` exists only for rows written before this migration. It is not a
-- value any command can produce, and it is honest: those rows were created by
-- `attendance_check_in` without recording whether the caller was the member or
-- a commander acting for them, and that information is not recoverable. It
-- counts as unconfirmed, like any other unconfirmed row.
-- ---------------------------------------------------------------------------

alter table public.attendance_intervals
  add column if not exists source text not null default 'UNKNOWN';

alter table public.attendance_intervals
  drop constraint if exists attendance_source_check;
alter table public.attendance_intervals
  add constraint attendance_source_check
  check (source in ('SELF_DECLARED', 'COMMAND_RECORDED', 'UNKNOWN'));

comment on column public.attendance_intervals.source is
  'Who asserted this interval. UNKNOWN only on rows predating 202609130006.';

-- ---------------------------------------------------------------------------
-- 2. Rejection
--
-- `verified` already carries "confirmed". A boolean cannot also carry
-- "explicitly rejected", and deleting a rejected claim would erase the fact
-- that somebody made it. Three states out of the existing column plus these:
--
--   PENDING    verified = false and rejected_at is null
--   CONFIRMED  verified = true
--   REJECTED   rejected_at is not null
-- ---------------------------------------------------------------------------

alter table public.attendance_intervals
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id),
  add column if not exists rejection_reason text;

alter table public.attendance_intervals
  drop constraint if exists attendance_rejection_fields;
alter table public.attendance_intervals
  add constraint attendance_rejection_fields check (
    (rejected_at is null) = (rejected_by is null)
    and (rejected_at is null) = (rejection_reason is null)
    and (rejection_reason is null or char_length(rejection_reason) between 2 and 500));

-- A record cannot be both stood behind and repudiated.
alter table public.attendance_intervals
  drop constraint if exists attendance_not_both_states;
alter table public.attendance_intervals
  add constraint attendance_not_both_states
  check (not (verified and rejected_at is not null));

create index if not exists attendance_pending_confirmation_idx
  on public.attendance_intervals (intervention_id)
  where verified = false and rejected_at is null;

-- ---------------------------------------------------------------------------
-- 3. A self-declared check-in says so
--
-- Same authority as before - a member may still record their own arrival, which
-- is the point of a mobile application in a field. What changes is that the row
-- now states who asserted it, and `attendance_totals()` no longer treats that
-- assertion as confirmed participation.
-- ---------------------------------------------------------------------------

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
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  -- Checking somebody else in is a command action.
  if target_member is not null and target_member is distinct from public.current_member_id()
     and not public.is_dvd_command() then
    raise exception 'COMMAND_REQUIRED';
  end if;
  if target_member is null and not public.is_dvd_staff() then
    raise exception 'STAFF_REQUIRED';
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

-- ---------------------------------------------------------------------------
-- 4. Correcting is no longer confirming
--
-- Identical to the previous version except that it no longer sets `verified`.
-- A commander fixing a forgotten checkout time has corrected the record, not
-- vouched for it, and conflating the two is how an unconfirmed claim silently
-- became participation. Confirmation is now its own command below.
-- ---------------------------------------------------------------------------

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
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;

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

-- ---------------------------------------------------------------------------
-- 5. Confirmation and rejection, as deliberate acts
--
-- A reason is required to REJECT and optional to CONFIRM, deliberately. A
-- rejection overrides what a member stated about their own presence and must be
-- explainable; confirmation is the expected outcome, and demanding boilerplate
-- from a commander doing thirty of them after an incident would produce thirty
-- meaningless strings. Both are audited with actor and server time either way.
--
-- An open interval can be confirmed: "this person was here" does not require
-- them to have left yet. Duration still only counts once the interval closes.
-- ---------------------------------------------------------------------------

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

-- Withdrawing a confirmation, so a mistaken confirm is not permanent. Audited
-- like everything else, and it returns the row to PENDING rather than to
-- rejected: unsaying "I stand behind this" is not the same as saying "this did
-- not happen".
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
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(clean_reason) < 2 or char_length(clean_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals
  where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;
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

-- ---------------------------------------------------------------------------
-- 6. Totals that cannot launder a claim into participation
--
-- The return type changes, so this is a drop and recreate - `create or replace`
-- cannot alter a function's output columns - and the execute grant must be
-- restored below.
--
-- `confirmed_seconds` is the only figure that may be reported as participation.
-- `unverified_seconds` is shown beside it so a commander can see what is
-- waiting on them, and rejected intervals are counted but contribute no time.
-- Duration is still never stored: it is summed from server timestamps here.
-- ---------------------------------------------------------------------------

drop function if exists public.attendance_totals(timestamptz, timestamptz);

create function public.attendance_totals(
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

comment on function public.attendance_totals(timestamptz, timestamptz) is
  'Participation is confirmed_seconds only. Unverified and rejected are reported separately and never summed into it.';

-- ---------------------------------------------------------------------------
-- 7. Opening an intervention is not answering it
--
-- `intervention_acknowledgements` has existed since `202609090002` with a read
-- policy and no way to write a row, so "opened" was unrecordable. It is one of
-- the separate facts in ACCESS_MODEL.md and the commander needs it: somebody who has not even
-- opened the call-out is a different problem from somebody who opened it and
-- has not answered.
--
-- Idempotent, and it creates nothing else. Opening is not a response.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 8. Vehicle movements
--
-- Same gap again: the table, its overlap exclusion constraint and its read
-- policy have existed since `202609090002` with no write path at all.
--
-- Staff authority, not command: at the station, whoever sees the vehicle leave
-- records it, and making that wait for a commander would produce a record
-- written later from memory. A movement never touches attendance, and no
-- member's response ever moves a vehicle.
-- ---------------------------------------------------------------------------

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

create or replace function public.record_vehicle_return(target_movement uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.vehicle_movements;
begin
  if not public.is_dvd_staff() then raise exception 'STAFF_REQUIRED'; end if;

  select * into before_row from public.vehicle_movements
  where id = target_movement for update;
  if before_row.id is null then raise exception 'MOVEMENT_NOT_FOUND'; end if;
  if before_row.returned_at is not null then raise exception 'VEHICLE_ALREADY_RETURNED'; end if;

  update public.vehicle_movements
  set returned_at = now(), returned_by = auth.uid()
  where id = target_movement;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, 'VEHICLE_RETURNED',
          jsonb_build_object('vehicle_id', before_row.vehicle_id,
                             'movement_id', target_movement),
          auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges
--
-- No new table, so Supabase's default-privileges trap does not apply here - but
-- `revoke ... from public` still does: PostgreSQL grants EXECUTE on every new
-- function to PUBLIC, and `anon` inherits it. That was found on the real
-- project, not reasoned about, and it is why `202609110004` exists.
--
-- `attendance_totals` is re-granted because dropping the function dropped its
-- grant with it.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.attendance_confirm(uuid, text)',
    'public.attendance_reject(uuid, text)',
    'public.attendance_unconfirm(uuid, text)',
    'public.acknowledge_intervention(uuid)',
    'public.record_vehicle_departure(uuid, uuid, text)',
    'public.record_vehicle_return(uuid)',
    'public.attendance_totals(timestamptz, timestamptz)',
    'public.attendance_check_in(uuid, uuid, text, text, uuid)',
    'public.attendance_correct(uuid, timestamptz, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
