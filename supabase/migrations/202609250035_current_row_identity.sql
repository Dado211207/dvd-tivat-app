-- ===========================================================================
-- 202609250035 - an answer stays whose it is, where it was given, and stays;
--                so do the current journey step and availability
--
-- A follow-up to 202609250034 (the owner's retention rule of 2026-09-25: a
-- published intervention and its response history remain in the database),
-- which it does not change. Found in review of #64 at 202609250034.
--
-- ---------------------------------------------------------------------------
-- What was left, measured on a schema at 202609250034
-- (db-tests/current_row_identity.test.ts, first describe)
-- ---------------------------------------------------------------------------
--
-- 1. intervention_response_revisions is append-only, but the answer it hangs
--    from was not. submit_response() revises an answer's answer, ETA,
--    direct-travel flag, updated_at and revision number, and nothing else -
--    yet anything else could be changed by the service role or a superuser
--    session:
--
--      its member   re-attributing an answer, and with it every revision, to
--                   another member of the same service, who need never have
--                   been sent the call-out;
--      its service  moving it onto the other service's call-out and member
--                   with its label moved along, which P2's trigger accepts as
--                   consistent (it checks the label against the new call-out,
--                   and never touches the revisions). The revisions kept the
--                   old label: SZS command read the answer and none of its
--                   history, DVD command the history of an answer it could
--                   not see.
--
-- 2. Every answer submit_response() writes has a revision, which RESTRICTs
--    deleting it (202609250034). That is the command's habit, not a database
--    rule: the service role could write an answer with no revision, and it -
--    an answer on a published call-out - could then simply be deleted.
--
-- 3. intervention_journey (the current step) and member_availability (the
--    current availability) are state whose history is append-only, and could
--    be re-attributed the same way - the live board showing a member on the
--    way who never set out, the history saying somebody else did.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- 1. An answer's identity is settled when it is written: its id, call-out,
--    member, service and first-answered time (RESPONSE_IDENTITY_FIXED).
--    submit_response() still revises the answer, ETA, direct-travel flag,
--    updated_at and revision number. The service of an answer and of its
--    revisions can no longer diverge: the answer's is fixed, each revision's
--    is checked against it by P2 when written, and revisions are never
--    changed (202609250034).
--
-- 2. An answer is removed only together with its call-out (RESPONSE_RETAINED,
--    and the table is never truncated). A call-out is removed only if it was
--    never published (202609250034), so a published call-out keeps every
--    answer - with or without a revision. A draft nobody was sent may still
--    be deleted, and takes with it any answer written to it outside the
--    commands (submit_response() refuses a draft). The one case refused that
--    the owner's rule does not strictly require - deleting such an answer on
--    its own while the draft stays - is refused so the rule needs no second
--    definition of "published".
--
-- 3. The current journey step keeps its call-out, member and service
--    (JOURNEY_IDENTITY_FIXED); the current availability keeps its member and
--    service (AVAILABILITY_IDENTITY_FIXED). set_journey_progress() and
--    set_own_availability_in() only ever move the progress or availability,
--    its time and who set it.
--
-- Each rule runs after P2's `enforce_organization` (trigger names sort after
-- it), so a label contradicting the parent is still refused by P2 first
-- (ORGANIZATION_MISMATCH), exactly as before.
--
-- None of this binds the superuser, who can disable a trigger: an exceptional
-- purge stays a deliberate act outside the application, as 202609250034 says.
--
-- ---------------------------------------------------------------------------
-- What this does NOT change
-- ---------------------------------------------------------------------------
--
-- Grants. The service role keeps its privileges on the three tables: nothing
-- it runs writes them, but withdrawing them is a separate decision. It can
-- therefore still write an answer, journey step or availability outside the
-- commands, and revise an answer's content without writing a revision; it can
-- no longer move one to somebody else, another call-out or another service,
-- or delete an answer.
--
-- Deleting the current journey step or availability, which are state: their
-- history is kept whatever happens to them (202609250034).
--
-- Who may be sent a call-out, and in which service - joint call-outs are P7's.
--
-- Replay: 202609240022's backfill UPDATEs organization_id on all three tables;
-- it runs long before these rules exist and is never re-run.
-- ===========================================================================

-- 1. An answer's identity.
create or replace function public.refuse_response_rebinding()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.intervention_id is distinct from old.intervention_id
     or new.member_id is distinct from old.member_id
     or new.organization_id is distinct from old.organization_id
     or new.responded_at is distinct from old.responded_at then
    raise exception 'RESPONSE_IDENTITY_FIXED';
  end if;
  return new;
end;
$$;

comment on function public.refuse_response_rebinding() is
  'Whose answer it is, to which call-out, in which service and when it was first '
  'given are settled when it is written. submit_response() revises the answer, '
  'ETA, direct-travel flag, updated_at and revision number; nothing moves the '
  'answer, or its revisions, to somebody else.';

-- 2. An answer stays with its call-out.
create or replace function public.refuse_response_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The call-out is being deleted: the only way an answer goes. Which
  -- call-outs may be deleted - a draft nobody was ever sent - is
  -- 202609250034's rule, not decided again here. Read as the owner, so no
  -- caller's row-level security can make an existing call-out look gone.
  if tg_op = 'DELETE' and not exists (
       select 1 from public.interventions intervention
       where intervention.id = old.intervention_id
     ) then
    return old;
  end if;
  raise exception 'RESPONSE_RETAINED';
end;
$$;

comment on function public.refuse_response_delete() is
  'An answer is removed only together with its call-out, and a published call-out '
  'is never removed: its answers stay, with or without a revision. The table is '
  'never truncated.';

-- 3. The current journey step and availability.
create or replace function public.refuse_journey_rebinding()
returns trigger
language plpgsql
as $$
begin
  if new.intervention_id is distinct from old.intervention_id
     or new.member_id is distinct from old.member_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'JOURNEY_IDENTITY_FIXED';
  end if;
  return new;
end;
$$;

comment on function public.refuse_journey_rebinding() is
  'Whose journey step it is, on which call-out and in which service are settled '
  'when it is written. set_journey_progress() moves the progress, its time and '
  'who set it.';

create or replace function public.refuse_availability_rebinding()
returns trigger
language plpgsql
as $$
begin
  if new.member_id is distinct from old.member_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'AVAILABILITY_IDENTITY_FIXED';
  end if;
  return new;
end;
$$;

comment on function public.refuse_availability_rebinding() is
  'Whose availability it is, and in which service, are settled when it is '
  'written. set_own_availability_in() moves the availability, the note, its time '
  'and who set it.';

revoke all on function public.refuse_response_rebinding() from public, anon, authenticated;
revoke all on function public.refuse_response_delete() from public, anon, authenticated;
revoke all on function public.refuse_journey_rebinding() from public, anon, authenticated;
revoke all on function public.refuse_availability_rebinding() from public, anon, authenticated;

drop trigger if exists refuse_rebinding on public.intervention_responses;
create trigger refuse_rebinding
  before update on public.intervention_responses
  for each row execute function public.refuse_response_rebinding();

drop trigger if exists retain_answers on public.intervention_responses;
create trigger retain_answers
  before delete on public.intervention_responses
  for each row execute function public.refuse_response_delete();

drop trigger if exists retain_answers_truncate on public.intervention_responses;
create trigger retain_answers_truncate
  before truncate on public.intervention_responses
  for each statement execute function public.refuse_response_delete();

drop trigger if exists refuse_rebinding on public.intervention_journey;
create trigger refuse_rebinding
  before update on public.intervention_journey
  for each row execute function public.refuse_journey_rebinding();

drop trigger if exists refuse_rebinding on public.member_availability;
create trigger refuse_rebinding
  before update on public.member_availability
  for each row execute function public.refuse_availability_rebinding();
