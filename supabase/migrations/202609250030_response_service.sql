-- ===========================================================================
-- 202609250030 - an answer comes from the member the call-out was sent to
--
-- P4c of docs/MULTI_ORG_PLAN.md: responses and journey. P4b already did most
-- of it, and what it did is left exactly as it is:
--
--   intervention_journey, intervention_journey_history
--       `set_journey_progress` resolves its caller in the call-out's service
--       (202609250028); both tables' reads are scoped (202609250029).
--   intervention_responses, intervention_response_revisions
--       reads scoped (202609250029): command in the service, or a recipient of
--       the call-out; revisions to command only.
--
-- What was left is the one command that writes answers.
--
-- ---------------------------------------------------------------------------
-- What was wrong, measured on a schema at 202609250029
-- ---------------------------------------------------------------------------
--
-- `submit_response` resolved its caller through the DVD shim - the member the
-- caller holds in DVD. For an SZS call-out that is the wrong member:
--
--   an SZS-only recipient answering their own call-out   MEMBER_RECORD_REQUIRED
--   a dual-service recipient answering it                NOT_A_RECIPIENT
--
-- measured on the fixtures (db-tests/response_service.test.ts) and on a copy
-- of production (scripts/p4-equivalence-gate.mjs, section 13 of the plan).
-- Both fail CLOSED: nothing was written, and nothing could be written for the
-- wrong member, because the recipient is looked up INLINE against the member
-- about to be written rather than through `is_recipient_of`. That shape is the
-- reason 028 could leave this alone, and it is kept.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- One variable, resolved differently. The service is read from the STORED
-- call-out - never a parameter, so there is nothing to forge - and the caller's
-- member record is resolved in that service. That same member is checked
-- against the call-out's recipients and written to the answer and its
-- revision, so a record in one service can never answer for the other.
-- `current_member_id_in` requires the caller to hold a usable role in that
-- service, so a withdrawn membership or member record there refuses the answer
-- however active the other service is.
--
-- DVD is unchanged by construction. For a DVD call-out the member resolved in
-- its service IS what the shim returned, and an id that matches no call-out is
-- judged as DVD's, as every earlier version judged every id - so the refusals,
-- and their order, are the same for every DVD caller:
--
--   MEMBER_RECORD_REQUIRED, INVALID_ANSWER, INTERVENTION_NOT_FOUND,
--   INTERVENTION_NOT_OPEN, NOT_A_RECIPIENT, ETA_REQUIRED
--
-- Answer validation, the arrival bands, "NE_MOGU is never direct", the
-- unchanged-answer no-op and the revision sequence are the previous text,
-- line for line. Same signature, so no overload can appear, and no other
-- migration re-creates this function, so no replay can restore the DVD-only
-- text (both asserted in db-tests/response_service.test.ts). `create or
-- replace` keeps the grants: authenticated and service_role, never anon.
--
-- What changes for somebody outside DVD, deliberately:
--
--   an SZS recipient                     answers, as their SZS member
--   a dual-service recipient             answers each service's call-out as
--                                        that service's member
--   a DVD-only account, SZS call-out     MEMBER_RECORD_REQUIRED (was
--                                        NOT_A_RECIPIENT): it holds no member
--                                        record in the service asked about
--   an SZS member not sent the call-out  NOT_A_RECIPIENT (was
--                                        MEMBER_RECORD_REQUIRED)
--
-- ---------------------------------------------------------------------------
-- What an answer reaches - audited, not assumed
-- ---------------------------------------------------------------------------
--
-- Writes: `intervention_responses` and `intervention_response_revisions`, and
-- nothing else - no audit row, no outbox row, no delivery row (asserted by row
-- counts of every public table). Their `organization_id` is set by the
-- existing `enforce_organization_from_parent` triggers from the call-out and
-- the response, never by this function.
--
-- Reads of what it now writes for SZS: the two tables' policies (029) give an
-- SZS answer to SZS command, the installation owner, and the recipients of
-- that call-out - who are SZS members only, since one call-out cannot name two
-- services (202609250027). No `security definer` function other than this one
-- and `set_journey_progress` names any of the four P4c tables, the push worker
-- does not read them, and Realtime applies the same policies. So this opens no
-- table beyond its own two, and there is no further boundary to close here.
--
-- ---------------------------------------------------------------------------
-- What this does NOT decide
-- ---------------------------------------------------------------------------
--
-- Corrections (P4d), push delivery (P4e), any screen (P6) and joint call-outs
-- (P7, once Q1-Q8 are answered).
-- ===========================================================================

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
  intervention_status text;
  intervention_organization uuid;
  existing record;
  effective_eta integer;
  effective_direct boolean;
  new_id uuid;
begin
  -- The service comes from the stored call-out. An id that matches none is
  -- judged as DVD's, which is how every id was judged before there were two.
  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  -- THE change: the caller's member record in that service. This one variable
  -- is what the recipient check below asks about and what is written, so the
  -- member checked and the member written are always the same person.
  acting_member := public.current_member_id_in(
    coalesce(intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid));

  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
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
  -- `x not in (...)` is NULL when x is NULL, so the null case must be tested
  -- explicitly. Without it a missing arrival band fell through to the table
  -- constraint and the caller got an opaque error instead of a clear reason.
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

  -- Re-sending an unchanged answer is not a change and writes no revision.
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
