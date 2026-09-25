-- ===========================================================================
-- 202609250031 - attendance is asked about, and stays, in the service that
-- owns it
--
-- P4d of docs/MULTI_ORG_PLAN.md: attendance_intervals, attendance_corrections,
-- attendance_correction_requests, vehicle_movements and attendance_totals().
--
-- P4b already did most of it, and what it did is left exactly as it is:
-- every read policy on the four tables asks the row's own service (029), and
-- every attendance and vehicle command - check-in, check-out, confirm, reject,
-- unconfirm, correct, confirm-many, departure, return - asks the service of
-- the row it acts on (028, 029). attendance_totals() is caller-rights and so
-- bounded by those policies and P4a's `members` policy. None of that is
-- touched here.
--
-- ---------------------------------------------------------------------------
-- What was left, measured on a schema at 202609250030
-- ---------------------------------------------------------------------------
--
-- 1. The one direct write a member may make. `correction_requests_self_create`
--    checked the interval's member against `current_member_id()`, the DVD
--    shim: an SZS member was refused a correction to their own SZS attendance
--    (row-level security), and somebody serving in both only had their DVD
--    record. Failing closed, as 029 recorded.
--
-- 2. The same policy let the requester fill in the decision. `resolved_by`,
--    `resolved_at`, `resolution_note` and `requested_at` were theirs to set,
--    so a request could arrive already "decided" by a commander who never saw
--    it, dated a month back. Measured for a DVD member, who could do it today.
--
-- 3. What a row is about could be rewritten after the fact. The triggers P2
--    added keep `organization_id` consistent with the parent - and only that.
--    An UPDATE that moved an interval onto another call-out AND set
--    organization_id to match was accepted; so was moving it onto another
--    member, which no trigger asked about at all; so was moving a correction
--    or a request onto another interval. The row kept its history and changed
--    whose it was. No client or command performs any of these, but the plan's
--    rule since P4a is that every column deciding what a history row means is
--    settled at insert - as a database rule, not by the absence of a writer.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- 1. The request policy asks for the caller's member IN THE INTERVAL'S
--    SERVICE, read from the stored interval - never from anything the client
--    sends - and requires it to be the interval's member. `current_member_id_in`
--    also requires a usable role in that service, so a withdrawn membership or
--    a suspended account asks nothing, and the owner, who holds no member
--    record, asks nothing either. A request's service is still derived from
--    the interval by the existing trigger; a forged one is refused
--    ORGANIZATION_MISMATCH before the policy is reached.
--
--    The policy also requires the request to be what a request is: OPEN, with
--    no decision on it, timestamped by the server. A client that sends only
--    interval, author and message - the only thing any client sends - is
--    unaffected.
--
-- 2. Identity is settled at insert:
--
--      attendance_intervals            intervention_id, member_id and
--                                      credited_organization_id never change
--                                      (ATTENDANCE_IDENTITY_FIXED). Times,
--                                      verification, rejection and the vehicle
--                                      still do - the lifecycle commands and
--                                      the vehicle's ON DELETE SET NULL rely on
--                                      it.
--      attendance_corrections          append-only (CORRECTION_HISTORY_APPEND_
--                                      ONLY): it is the record of every
--                                      correction ever made.
--      attendance_correction_requests  interval, author, time and message never
--                                      change (CORRECTION_REQUEST_IDENTITY_
--                                      FIXED); the decision columns still can,
--                                      for whatever command records decisions.
--
--    `vehicle_movements` is deliberately NOT frozen: P2 settled that a movement
--    belongs to its vehicle's service, allows moving it to another vehicle of
--    the same service and re-linking its call-out, and its call-out's ON DELETE
--    SET NULL is itself an UPDATE. Those rules stand and their tests with them.
--
-- ---------------------------------------------------------------------------
-- What this does NOT decide
-- ---------------------------------------------------------------------------
--
-- Crediting. `credited_organization_id` stays equal to the call-out's service
-- for every row that can exist, and is now fixed once written; whether it may
-- ever differ - a DVD member's hours on an SZS call-out - is Q5's, unanswered.
-- No command resolves a correction request today (none ever did: no client
-- reads or writes the table); the decision columns stay open for when one is
-- built. Joint call-outs are P7's.
-- ===========================================================================

drop policy if exists correction_requests_self_create on public.attendance_correction_requests;
create policy correction_requests_self_create on public.attendance_correction_requests
  for insert
  with check (
    requested_by = auth.uid()
    -- A request, not a decision: nothing decided on it, dated by the server.
    and state = 'OPEN'
    and resolved_by is null
    and resolved_at is null
    and resolution_note is null
    and requested_at = now()
    -- Their own attendance, as the member they hold in the service it belongs
    -- to - read from the stored interval, never from the request.
    and exists (
      select 1 from public.attendance_intervals interval_row
      where interval_row.id = interval_id
        and interval_row.member_id = public.current_member_id_in(interval_row.organization_id)
    )
  );

comment on policy correction_requests_self_create on public.attendance_correction_requests is
  'A member asks for their OWN attendance to be corrected, as the member they '
  'hold in the service that owns the interval. OPEN, undecided and timestamped '
  'by the server; a commander decides.';

-- ---------------------------------------------------------------------------
-- Identity settled at insert
-- ---------------------------------------------------------------------------

create or replace function public.refuse_attendance_rebinding()
returns trigger
language plpgsql
as $$
begin
  if new.intervention_id is distinct from old.intervention_id
     or new.member_id is distinct from old.member_id
     or new.credited_organization_id is distinct from old.credited_organization_id then
    raise exception 'ATTENDANCE_IDENTITY_FIXED';
  end if;
  return new;
end;
$$;

comment on function public.refuse_attendance_rebinding() is
  'Whose attendance an interval is, on which call-out, and which service it is '
  'credited to are settled when it is written. The lifecycle moves times, '
  'verification and the vehicle; nothing moves the row to somebody else.';

create or replace function public.refuse_attendance_correction_change()
returns trigger
language plpgsql
as $$
begin
  -- No detail about which column: nothing legitimate updates or deletes here.
  raise exception 'CORRECTION_HISTORY_APPEND_ONLY';
end;
$$;

comment on function public.refuse_attendance_correction_change() is
  'An attendance correction is the record of a change to somebody''s hours. It '
  'is written once and never changed or removed - including the interval it '
  'is about, which decides the service it belongs to.';

create or replace function public.refuse_correction_request_rebinding()
returns trigger
language plpgsql
as $$
begin
  if new.interval_id is distinct from old.interval_id
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at
     or new.message is distinct from old.message then
    raise exception 'CORRECTION_REQUEST_IDENTITY_FIXED';
  end if;
  return new;
end;
$$;

comment on function public.refuse_correction_request_rebinding() is
  'Who asked, about which interval, when and what is settled when a correction '
  'request is written. Only the decision on it may be recorded later.';

revoke all on function public.refuse_attendance_rebinding() from public, anon, authenticated;
revoke all on function public.refuse_attendance_correction_change() from public, anon, authenticated;
revoke all on function public.refuse_correction_request_rebinding() from public, anon, authenticated;

drop trigger if exists refuse_rebinding on public.attendance_intervals;
create trigger refuse_rebinding
  before update on public.attendance_intervals
  for each row execute function public.refuse_attendance_rebinding();

drop trigger if exists refuse_change on public.attendance_corrections;
create trigger refuse_change
  before update or delete on public.attendance_corrections
  for each row execute function public.refuse_attendance_correction_change();

drop trigger if exists refuse_rebinding on public.attendance_correction_requests;
create trigger refuse_rebinding
  before update on public.attendance_correction_requests
  for each row execute function public.refuse_correction_request_rebinding();
