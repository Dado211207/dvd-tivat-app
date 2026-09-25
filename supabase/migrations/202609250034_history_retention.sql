-- ===========================================================================
-- 202609250034 - a published call-out, and the history written under it, stay
--
-- The owner's rule (2026-09-25): a published intervention and its response
-- history remain in the database. A published call-out is closed or
-- cancelled, never hard-deleted through ordinary database operations. A draft
-- nobody was ever sent may still be deleted.
--
-- A follow-up to P4f (202609250033), which made the audit tables append-only
-- and left three history tables for a separately reviewed change.
--
-- ---------------------------------------------------------------------------
-- What was left, measured on a schema at 202609250033
-- ---------------------------------------------------------------------------
--
-- 1. member_availability_history, intervention_journey_history and
--    intervention_response_revisions are each written only by INSERT, by one
--    `security definer` command - set_own_availability_in, set_journey_progress,
--    submit_response. Nothing else writes them. But:
--
--      - the service role held every privilege on all three: it could rewrite
--        an availability change, a journey step or an answer, delete them,
--        truncate them, or write a journey step nobody took;
--      - a superuser session could do the same by accident;
--      - a row could be moved onto another service's call-out or member, as
--        long as its label moved with it - P2's trigger checks that a label
--        matches its parent, not that the row stays where it was written.
--
-- 2. Deleting an answer erased its revisions: intervention_response_revisions
--    went with its response (ON DELETE CASCADE).
--
-- 3. A published call-out with nothing under it that RESTRICTs - nobody has
--    set out yet, say - could simply be deleted, and with it its recipient
--    list, its answers and their revisions (all ON DELETE CASCADE). One with
--    journey progress could not, but only because intervention_journey
--    happened to RESTRICT.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- 1. The three histories refuse UPDATE and DELETE (AUDIT_APPEND_ONLY) and
--    TRUNCATE, with P4f's own functions, in strict form: no referential
--    action reaches them any more (2), so there is no exception to make. P2's
--    `enforce_organization` trigger on each is unchanged and still answers a
--    contradicting label first, on insert and on update.
--
-- 2. intervention_response_revisions.response_id is ON DELETE RESTRICT. An
--    answer with revisions cannot be deleted; its revisions are never erased
--    with it. Every answer has at least one revision (submit_response writes
--    one with the first answer), so in practice no answer can be deleted.
--
-- 3. The service role keeps SELECT on all three and loses INSERT, UPDATE,
--    DELETE and TRUNCATE, as P4f did for the audit tables. Nothing it runs
--    writes history; the commands, owned by postgres, still do.
--
-- 4. A published call-out cannot be deleted (PUBLISHED_INTERVENTION_RETAINED),
--    and the table cannot be truncated. What counts as published is decided
--    from every trace publication leaves, any one of which retains it:
--
--      status       anything but DRAFT and CANCELLED is past publication
--      published_by recorded by publish_intervention since 202609150012 - but
--                   NOT by 202609150008's version, which published two of
--                   production's five call-outs
--      recipients   the frozen list publish_intervention writes, every version
--      audit        the INTERVENTION_PUBLISHED row every version writes, which
--                   P4f made append-only: the service role can clear a
--                   publisher, reset a status and delete a recipient list,
--                   but cannot remove this
--
--    So a DRAFT, and a draft discarded before publication (CANCELLED by
--    discard_intervention_draft, with no publisher, no recipients and no
--    publication in the audit), may still be deleted. Nothing else may.
--
-- None of this binds the superuser, who can disable a trigger. An exceptional
-- purge - removing demo data from production, say - is a deliberate act
-- outside the application, needing its own decision: it disables named
-- triggers, deletes, and puts them back. No command here or anywhere in the
-- schema deletes a call-out, an answer or any history (asserted by
-- db-tests/history_retention.test.ts).
--
-- ---------------------------------------------------------------------------
-- What this does NOT change
-- ---------------------------------------------------------------------------
--
-- intervention_responses (the current answer), intervention_journey (the
-- current step) and member_availability (the current availability) still
-- change: they are state, and their history is the tables above. Closing and
-- cancelling are unchanged. The recipient list, the alerts and their delivery
-- attempts are outside this rule; deleting any of them cannot make a
-- published call-out deletable (4).
--
-- Replay: 202609240022's backfill UPDATEs all three tables; it runs long
-- before these rules exist and is never re-run.
-- ===========================================================================

-- 1. No rewrite, no removal, no truncation.
drop trigger if exists refuse_change on public.member_availability_history;
create trigger refuse_change
  before update or delete on public.member_availability_history
  for each row execute function public.refuse_audit_change();

drop trigger if exists refuse_change on public.intervention_journey_history;
create trigger refuse_change
  before update or delete on public.intervention_journey_history
  for each row execute function public.refuse_audit_change();

drop trigger if exists refuse_change on public.intervention_response_revisions;
create trigger refuse_change
  before update or delete on public.intervention_response_revisions
  for each row execute function public.refuse_audit_change();

drop trigger if exists refuse_truncate on public.member_availability_history;
create trigger refuse_truncate before truncate on public.member_availability_history
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.intervention_journey_history;
create trigger refuse_truncate before truncate on public.intervention_journey_history
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.intervention_response_revisions;
create trigger refuse_truncate before truncate on public.intervention_response_revisions
  for each statement execute function public.refuse_audit_truncate();

-- 2. An answer's revisions are never erased with it.
alter table public.intervention_response_revisions
  drop constraint if exists intervention_response_revisions_response_id_fkey;
alter table public.intervention_response_revisions
  add constraint intervention_response_revisions_response_id_fkey
  foreign key (response_id) references public.intervention_responses(id) on delete restrict;

-- 3. History is written by the commands; the service role only reads it.
revoke insert, update, delete, truncate on public.member_availability_history from service_role;
revoke insert, update, delete, truncate on public.intervention_journey_history from service_role;
revoke insert, update, delete, truncate on public.intervention_response_revisions from service_role;

comment on table public.member_availability_history is
  'Every change of a member''s availability, written by set_own_availability_in(). '
  'Append-only by rule (refuse_audit_change).';
comment on table public.intervention_journey_history is
  'Every step of a member''s journey to a call-out, written by set_journey_progress(). '
  'Append-only by rule (refuse_audit_change).';
comment on table public.intervention_response_revisions is
  'Every answer a member gave to a call-out, written by submit_response(). '
  'Append-only by rule (refuse_audit_change); an answer with revisions cannot be deleted.';

-- 4. A published call-out stays.
create or replace function public.refuse_published_intervention_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Never published: a draft, or a draft discarded before anybody was sent it.
  -- Any trace of publication - its status, its publisher, its recipient list,
  -- its publication in the append-only audit - keeps it.
  if tg_op = 'DELETE'
     and old.status in ('DRAFT', 'CANCELLED')
     and old.published_by is null
     and not exists (
       select 1 from public.intervention_recipients recipient
       where recipient.intervention_id = old.id
     )
     and not exists (
       select 1 from public.operational_audit event
       where event.intervention_id = old.id
         and event.event_type = 'INTERVENTION_PUBLISHED'
     ) then
    return old;
  end if;
  raise exception 'PUBLISHED_INTERVENTION_RETAINED';
end;
$$;

comment on function public.refuse_published_intervention_delete() is
  'A published call-out is closed or cancelled, never deleted: it and everything '
  'written under it stay. A draft nobody was ever sent may go. The table is never '
  'truncated.';

revoke all on function public.refuse_published_intervention_delete() from public, anon, authenticated;

drop trigger if exists retain_published on public.interventions;
create trigger retain_published
  before delete on public.interventions
  for each row execute function public.refuse_published_intervention_delete();

drop trigger if exists retain_published_truncate on public.interventions;
create trigger retain_published_truncate
  before truncate on public.interventions
  for each statement execute function public.refuse_published_intervention_delete();
