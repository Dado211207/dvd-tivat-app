-- 202609290041_joint_participation.sql
--
-- P7 / joint cross-service call-outs — participation and scoped reads (D20, D21).
-- Migration 040 gave a call-out reach into another service (its recipients). This
-- migration lets those recipient-service members ACT on it under their own service,
-- lets each service command only its OWN participants, and scopes every read so
-- neither service sees the other's individual participant rows.
--
--   D20  the publisher alone commands the incident lifecycle (already true — status
--        and closure gate on interventions.organization_id); each service confirms
--        only its own members' attendance; a recipient-service member responds,
--        progresses and checks in under their own member record and service.
--   D21  both services see the shared incident + their own participants; NEITHER
--        sees the other's responses, journeys, attendance or member-linked audit.
--
-- Additive and a no-op for every single-service call-out that exists today: on a
-- single-service call-out a participant's service equals the call-out's service, so
-- re-deriving responses/journey organization_id from the member changes no existing
-- row, is_recipient_in(intervention, own-service) equals the old is_recipient_of,
-- and keying attendance off credited_organization_id equals keying off
-- organization_id (they are equal until a joint call-out exists). The
-- production-derived equivalence gate must pass through THIS migration before
-- release.

-- ===========================================================================
-- 1. is_recipient_in: recipient of a call-out IN a specific service
-- ===========================================================================
--
-- is_recipient_of answers "is the caller a recipient of this call-out, in any
-- service". For a JOINT call-out that is not enough to scope a read: a DVD member
-- paged by an SZS call-out is a recipient (is_recipient_of = true), but must still
-- not see the SZS participants' rows. is_recipient_in adds the service: the caller
-- is a recipient of this call-out THROUGH a member record in `target_organization`.
-- A per-service participant read (below) then shows a row only when the caller is a
-- recipient in that row's own service.

create or replace function public.is_recipient_in(
  target_intervention uuid,
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
    from public.intervention_recipients recipient
    where recipient.intervention_id = target_intervention
      and recipient.organization_id = target_organization
      and recipient.member_id = public.current_member_id_in(target_organization)
  )
$$;

comment on function public.is_recipient_in(uuid, uuid) is
  'Whether the caller is a recipient of the call-out through a member record in the '
  'given service. Used by the participant-read policies (D21) so a joint-call-out '
  'recipient sees only their own service''s participants, never the other service''s.';

revoke all on function public.is_recipient_in(uuid, uuid) from public, anon;
grant execute on function public.is_recipient_in(uuid, uuid) to authenticated;

-- ===========================================================================
-- 2. Responses: the row's service is the responder's own; scope the recipient read
-- ===========================================================================
--
-- intervention_responses.organization_id was denormalised from the call-out. On a
-- joint call-out a DVD member's answer must be a DVD row — so a DVD commander sees
-- and counts it (D20) and a DVD recipient peer sees it while an SZS one does not
-- (D21). Re-derive it from the responder's member. A no-op for every existing row
-- (responder's service = call-out's service today).

drop trigger enforce_organization on public.intervention_responses;
create trigger enforce_organization before insert or update on public.intervention_responses
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');

-- Was: is_recipient_of(intervention_id) — every recipient, of either service, saw
-- every answer. Now: only a recipient in the answer's OWN service. Single-service
-- is unchanged (row service = caller's service = the one they are a recipient in).
alter policy responses_recipient_read on public.intervention_responses
  using (public.is_recipient_in(intervention_id, organization_id));

-- ===========================================================================
-- 3. Journey (and its history): row service is the member's; scope the recipient read
-- ===========================================================================

drop trigger enforce_organization on public.intervention_journey;
create trigger enforce_organization before insert or update on public.intervention_journey
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');

drop trigger enforce_organization on public.intervention_journey_history;
create trigger enforce_organization before insert or update on public.intervention_journey_history
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');

alter policy intervention_journey_recipient_read on public.intervention_journey
  using (public.is_recipient_in(intervention_id, organization_id));

-- ===========================================================================
-- 4. Attendance: two services on one row (§6.3), so scope by credited service
-- ===========================================================================
--
-- attendance_intervals keeps its §6.3 shape: organization_id is the call-out's
-- service (whose intervention), credited_organization_id is the member's own
-- service (whose participation, D15/migration 039). Command, self and recipient
-- reads, and the confirm/reject/unconfirm/correct authority, must all follow the
-- MEMBER — so they key off credited_organization_id. On a single-service call-out
-- the two columns are equal, so this changes nothing there; on a joint call-out a
-- DVD member's interval is credited to DVD, so DVD command confirms it and DVD
-- recipients (not SZS) see it.

alter policy attendance_command_read on public.attendance_intervals
  using (public.is_command_in(credited_organization_id));
alter policy attendance_self_read on public.attendance_intervals
  using (member_id = public.current_member_id_in(credited_organization_id));
alter policy attendance_recipient_read on public.attendance_intervals
  using (public.is_recipient_in(intervention_id, credited_organization_id));

-- Corrections and correction-requests inherit their service from the interval.
-- Until now that was the interval's organization_id (the call-out's service); make
-- it the interval's credited service, so a DVD member's correction is DVD's — DVD
-- command sees and decides it (D20). A no-op for single-service rows.
create or replace function public.enforce_organization_from_interval_credit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  derived uuid;
begin
  if new.interval_id is null then
    if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
      raise exception 'ORGANIZATION_MISMATCH';
    end if;
    return new;
  end if;
  select credited_organization_id into derived
    from public.attendance_intervals where id = new.interval_id;
  if derived is null then
    return new; -- the foreign key will refuse a missing interval more clearly.
  end if;
  if new.organization_id is null then
    new.organization_id := derived;
  elsif new.organization_id is distinct from derived then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  return new;
end;
$$;

-- A trigger function is never called by a client; keep it off every client role,
-- as every other enforce_* trigger function is (a bare PUBLIC execute would let
-- anon call it over /rest/v1/rpc).
revoke all on function public.enforce_organization_from_interval_credit() from public, anon, authenticated;

drop trigger enforce_organization on public.attendance_corrections;
create trigger enforce_organization before insert or update on public.attendance_corrections
  for each row execute function public.enforce_organization_from_interval_credit();

drop trigger enforce_organization on public.attendance_correction_requests;
create trigger enforce_organization before insert or update on public.attendance_correction_requests
  for each row execute function public.enforce_organization_from_interval_credit();

-- ===========================================================================
-- 5. Operational audit: attribute member actions to the member's service
-- ===========================================================================
--
-- operational_audit has no member column: its organization_id is denormalised from
-- the call-out (the publisher's service). On a joint call-out that would file a DVD
-- member's check-in under SZS, where the SZS commander would read it — a
-- cross-service leak of a DVD individual's action (D21). So the member-action
-- commands below now stamp each such audit row with the ACTING MEMBER's service,
-- and this trigger trusts a service the command supplies while still deriving one
-- for the incident-level rows (publish, status, closure) that pass none. Only
-- security-definer commands can write this table (authenticated holds SELECT only),
-- so trusting the supplied service opens no forgery path.

create or replace function public.enforce_audit_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  derived uuid;
begin
  if tg_op = 'UPDATE' then
    -- Append-only: the one permitted update nulls intervention_id on cascade.
    if new.organization_id is distinct from old.organization_id then
      raise exception 'ORGANIZATION_MISMATCH';
    end if;
    return new;
  end if;
  if new.organization_id is null then
    if new.intervention_id is not null then
      select organization_id into derived
        from public.interventions where id = new.intervention_id;
    end if;
    new.organization_id := coalesce(derived, '00000000-0000-4000-8000-000000000001');
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_audit_organization() from public, anon, authenticated;

drop trigger enforce_organization on public.operational_audit;
create trigger enforce_organization before insert or update on public.operational_audit
  for each row execute function public.enforce_audit_organization();

-- Scope the recipient audit read to the caller's own service, matching the row's
-- service. A joint-call-out recipient sees their own service's audit rows only.
alter policy operational_audit_recipient_read on public.operational_audit
  using (intervention_id is not null and public.is_recipient_in(intervention_id, organization_id));

-- The chronology reader carried the same broad recipient branch. Scope it too, so
-- a recipient reading a joint call-out's chronology sees only their own service's
-- events (command of each service still sees its own via is_command_in).
create or replace function public.intervention_audit(target_intervention uuid)
returns table(event_id uuid, occurred_at timestamptz, event_type text, detail jsonb, actor_name text, actor_is_you boolean)
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
    and (public.is_command_in(entry.organization_id)
         or public.is_recipient_in(target_intervention, entry.organization_id))
  order by entry.occurred_at, entry.id
$$;

-- ===========================================================================
-- 6. submit_response answers as the member the call-out was sent to (D20)
-- ===========================================================================
--
-- The answer is written against the caller's OWN recipient row — on a joint
-- call-out that is their recipient-service member (a DVD member answers an SZS
-- call-out as their DVD member). When the caller holds no recipient row the command
-- falls back to the pre-P7 resolution in the call-out's own service, which
-- preserves the exact refusal order: a caller with no member there is refused
-- MEMBER_RECORD_REQUIRED before any status or recipient check (learning nothing
-- about a call-out they cannot read); a member of that service who was not paged
-- reaches NOT_A_RECIPIENT after the status checks.

create or replace function public.submit_response(
  target_intervention uuid,
  requested_answer text,
  requested_eta integer,
  requested_direct boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid;
  acting_org uuid;
  intervention_status text;
  intervention_organization uuid;
  existing record;
  effective_eta integer;
  effective_direct boolean;
  new_id uuid;
begin
  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  select recipient.member_id, recipient.organization_id
    into acting_member, acting_org
  from public.intervention_recipients recipient
  where recipient.intervention_id = target_intervention
    and recipient.member_id = public.current_member_id_in(recipient.organization_id)
  order by (recipient.organization_id = intervention_organization) desc
  limit 1;

  if acting_member is null then
    acting_org := coalesce(intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);
    acting_member := public.current_member_id_in(acting_org);
    if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  end if;

  if requested_answer not in ('DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU') then
    raise exception 'INVALID_ANSWER';
  end if;

  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
    raise exception 'INTERVENTION_NOT_OPEN';
  end if;

  if not exists (
    select 1 from public.intervention_recipients
    where intervention_id = target_intervention and member_id = acting_member
  ) then
    raise exception 'NOT_A_RECIPIENT';
  end if;

  effective_eta := case when requested_answer = 'DOLAZIM_KASNIJE' then requested_eta else null end;
  if requested_answer = 'DOLAZIM_KASNIJE'
     and (effective_eta is null or effective_eta not in (15, 30, 60)) then
    raise exception 'ETA_REQUIRED';
  end if;
  effective_direct := case when requested_answer = 'NE_MOGU' then false
                           else coalesce(requested_direct, false) end;

  select * into existing from public.intervention_responses
  where intervention_id = target_intervention and member_id = acting_member for update;

  if existing.id is null then
    insert into public.intervention_responses(
      intervention_id, member_id, answer, eta_minutes, direct_to_location)
    values (target_intervention, acting_member, requested_answer, effective_eta, effective_direct)
    returning id into new_id;

    insert into public.intervention_response_revisions(
      response_id, revision, answer, eta_minutes, direct_to_location)
    values (new_id, 1, requested_answer, effective_eta, effective_direct);
    return;
  end if;

  if existing.answer = requested_answer
     and existing.eta_minutes is not distinct from effective_eta
     and existing.direct_to_location = effective_direct then
    return;
  end if;

  update public.intervention_responses
  set answer = requested_answer,
      eta_minutes = effective_eta,
      direct_to_location = effective_direct,
      updated_at = now(),
      revision = revision + 1
  where id = existing.id;

  insert into public.intervention_response_revisions(
    response_id, revision, answer, eta_minutes, direct_to_location)
  values (existing.id, existing.revision + 1, requested_answer, effective_eta, effective_direct);
end;
$$;

-- ===========================================================================
-- 7. set_journey_progress progresses as the member the call-out was sent to (D20)
-- ===========================================================================

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
  acting_org uuid;
  intervention_status text;
  intervention_organization uuid;
  previous text;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  select recipient.member_id, recipient.organization_id into acting_member, acting_org
  from public.intervention_recipients recipient
  where recipient.intervention_id = target_intervention
    and recipient.member_id = public.current_member_id_in(recipient.organization_id)
  order by (recipient.organization_id = intervention_organization) desc
  limit 1;

  if acting_member is not null then
    -- A paged member acts in their own service; they must still be staff there.
    if not public.is_staff_in(acting_org) then raise exception 'STAFF_REQUIRED'; end if;
  else
    -- Pre-P7 fallback in the call-out's own service. Keeps STAFF_REQUIRED ahead of
    -- MEMBER_RECORD_REQUIRED, as before, for a caller who does not serve it.
    acting_org := coalesce(intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);
    if intervention_organization is not null and not public.is_staff_in(intervention_organization) then
      raise exception 'STAFF_REQUIRED';
    end if;
    acting_member := public.current_member_id_in(acting_org);
    if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  end if;

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

    insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
    values (target_intervention, acting_org, 'JOURNEY_PROGRESS_SET',
            jsonb_build_object('member_id', acting_member,
                               'from', previous, 'to', requested_progress),
            auth.uid());
  end if;
end;
$$;

-- ===========================================================================
-- 8. attendance_check_in / _out act in the member's own service (D20)
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
  self_service uuid;
  self_member uuid;
  acting_service uuid;
  acting_member uuid;
  new_interval uuid;
  interval_source text;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  -- The caller's own participant service on this call-out: their recipient row's
  -- service if paged (joint-aware), else the call-out's own service (pre-P7).
  select recipient.organization_id into self_service
  from public.intervention_recipients recipient
  where recipient.intervention_id = target_intervention
    and recipient.member_id = public.current_member_id_in(recipient.organization_id)
  order by (recipient.organization_id = intervention_organization) desc
  limit 1;
  self_service := coalesce(self_service, intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);

  -- Self records in their own service; command records in the target member's.
  if target_member is null then
    acting_service := self_service;
  else
    select organization_id into acting_service from public.members where id = target_member;
    acting_service := coalesce(acting_service, self_service);
  end if;

  if not public.is_staff_in(acting_service) then raise exception 'STAFF_REQUIRED'; end if;

  self_member := public.current_member_id_in(self_service);
  acting_member := coalesce(target_member, self_member);
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  if target_member is not null and target_member is distinct from self_member
     and not public.is_command_in(acting_service) then
    raise exception 'COMMAND_REQUIRED';
  end if;

  -- The member belongs to the acting service, and that service is one the call-out
  -- targets (its own publishing service or an additional recipient service, D19).
  if not exists (
    select 1 from public.members
    where id = acting_member and organization_id = acting_service
  ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

  if intervention_organization is not null
     and acting_service is distinct from intervention_organization
     and not exists (
       select 1 from public.intervention_recipient_organizations iro
       where iro.intervention_id = target_intervention and iro.organization_id = acting_service
     ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

  if requested_vehicle is not null and not exists (
    select 1 from public.vehicles
    where id = requested_vehicle and organization_id = acting_service
  ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

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

  insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
  values (target_intervention, acting_service, 'ATTENDANCE_CHECK_IN',
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
  self_service uuid;
  self_member uuid;
  acting_service uuid;
  acting_member uuid;
  open_interval uuid;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select organization_id into intervention_organization
  from public.interventions where id = target_intervention;

  select recipient.organization_id into self_service
  from public.intervention_recipients recipient
  where recipient.intervention_id = target_intervention
    and recipient.member_id = public.current_member_id_in(recipient.organization_id)
  order by (recipient.organization_id = intervention_organization) desc
  limit 1;
  self_service := coalesce(self_service, intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid);

  if target_member is null then
    acting_service := self_service;
  else
    select organization_id into acting_service from public.members where id = target_member;
    acting_service := coalesce(acting_service, self_service);
  end if;

  if not public.is_staff_in(acting_service) then raise exception 'STAFF_REQUIRED'; end if;

  self_member := public.current_member_id_in(self_service);
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

  insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
  values (target_intervention, acting_service, 'ATTENDANCE_CHECK_OUT',
          jsonb_build_object('member_id', acting_member), auth.uid());
end;
$$;

-- ===========================================================================
-- 9. Each service confirms/rejects/unconfirms/corrects only its own (D20)
-- ===========================================================================
--
-- The interval's credited service is the member's own. Gating on it means DVD
-- command decides a DVD member's attendance and SZS command an SZS member's, even
-- on the same joint call-out. The member-linked audit each writes is stamped with
-- that same credited service, so it stays within it (D21). All a no-op on a
-- single-service call-out, where credited = organization_id.

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
  if not public.is_command_in(before_row.credited_organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if before_row.verified then return; end if;
  if before_row.rejected_at is not null then raise exception 'INTERVAL_REJECTED'; end if;

  update public.attendance_intervals
  set verified = true, verified_by = auth.uid(), verified_at = now()
  where id = target_interval;

  insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, before_row.credited_organization_id, 'ATTENDANCE_CONFIRMED',
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
  if not public.is_command_in(before_row.credited_organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if before_row.verified then raise exception 'INTERVAL_CONFIRMED'; end if;
  if before_row.rejected_at is not null then return; end if;

  update public.attendance_intervals
  set rejected_at = now(), rejected_by = auth.uid(), rejection_reason = clean_reason
  where id = target_interval;

  insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, before_row.credited_organization_id, 'ATTENDANCE_REJECTED',
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
  if not public.is_command_in(before_row.credited_organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if not before_row.verified then return; end if;

  update public.attendance_intervals
  set verified = false, verified_by = null, verified_at = null
  where id = target_interval;

  insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, before_row.credited_organization_id, 'ATTENDANCE_UNCONFIRMED',
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
  if not public.is_command_in(before_row.credited_organization_id) then
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

  insert into public.operational_audit(intervention_id, organization_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, before_row.credited_organization_id, 'ATTENDANCE_CORRECTED',
          jsonb_build_object('interval_id', target_interval, 'reason', normalized_reason), auth.uid());
end;
$$;
