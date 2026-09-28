-- ===========================================================================
-- 202609270039 - attendance is credited to the participant's OWN service
--
-- P6 of docs/MULTI_ORG_PLAN.md, the schema half of Q5, answered by the owner on
-- 2026-09-27:
--
--   "On a future joint intervention, attendance hours are credited to the
--    participant's own service, not automatically to the service that published
--    the intervention, and never twice."
--
-- The additive column this needs already exists. 202609240022 added
-- `attendance_intervals.credited_organization_id` (plan section 6.3), backfilled
-- it to each row's `organization_id`, made it NOT NULL, and 202609250031 froze
-- it at insert (ATTENDANCE_IDENTITY_FIXED). So the schema gate - carry the column
-- before any history exists, never migrate live attendance later - is already
-- met. What 022 left open, in its own words, was HOW the column is filled:
-- "Credited to whoever ran the call-out until section 6.3 gives it its own rule."
--
-- This migration gives it that rule: the credited service is the service of the
-- MEMBER whose attendance it is, read from the stored member record, never from
-- the call-out and never from anything a caller sends.
--
-- ---------------------------------------------------------------------------
-- Why this is a no-op for every row that exists today, and why it must be now
-- ---------------------------------------------------------------------------
--
-- Today every attendance interval is a DVD member on a DVD call-out: an interval's
-- member can only be one because they were an eligible recipient, and eligibility
-- is service-scoped (P4b). So the member's service and the call-out's service are
-- the same value, and switching the source from one to the other changes no row's
-- credited service and no participation total. `attendance_totals()` is unchanged:
-- it is already per-member, and by D13 a member record belongs to exactly one
-- service, so per-member totals are per-service.
--
-- The two only diverge on a joint intervention - a DVD member on an SZS call-out -
-- which is P7. Q5 "is not reversible once records exist" (plan section 7): if P6
-- shipped the "credited to whoever ran the call-out" rule and SZS/joint history
-- were written under it, correcting the rule in P7 would mean rewriting live,
-- frozen attendance records. Fixing the rule now, while the two services still
-- coincide on every row, is the additive, no-migration-later path the plan's
-- section 6.3 chose the column for. It records the decision; it does not build
-- joint call-outs (P7) - none can exist for it to affect.
--
-- ---------------------------------------------------------------------------
-- The rule, and the boundary it is read from
-- ---------------------------------------------------------------------------
--
-- `derive_credited_organization_id()` now sets credited from the interval's
-- member's `organization_id`, ALWAYS - it no longer copies `organization_id`, and
-- it no longer honours a value the row arrived with. That closes the one way it
-- could have become a client claim: an INSERT that named its own credited service
-- was previously kept as-is (the trigger only filled a null); now it is
-- overwritten from the member. The member's service is itself fixed at creation
-- (`refuse_organization_change` on `members`, 022) and the interval's member and
-- credited service are fixed once written (ATTENDANCE_IDENTITY_FIXED, 031), so the
-- invariant "credited = the interval's member's service" holds for INSERT, cannot
-- be moved by UPDATE, and no parent change can reach it.
--
-- The trigger is SECURITY DEFINER (unchanged), so its read of `members` is not
-- subject to the caller's RLS; the only writer of attendance intervals is the
-- SECURITY DEFINER command `attendance_check_in`, and the member it reads is the
-- one the command already resolved.
-- ===========================================================================

create or replace function public.derive_credited_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_organization uuid;
begin
  -- The participant's OWN service, from the stored member record - not the
  -- call-out's service, and not whatever the row arrived carrying.
  select organization_id into member_organization
    from public.members
   where id = new.member_id;

  if member_organization is null then
    -- member_id is NOT NULL with a foreign key, so this cannot happen for a real
    -- insert; failing loudly beats writing an interval credited to nobody.
    raise exception 'ATTENDANCE_MEMBER_UNKNOWN';
  end if;

  new.credited_organization_id := member_organization;
  return new;
end;
$$;

comment on function public.derive_credited_organization_id() is
  'Sets attendance credit to the participant''s own service, read from the '
  'member record (never the call-out, never a caller-provided value). P6/Q5 '
  'schema decision (owner, 2026-09-27); a no-op while the two coincide, correct '
  'in advance for the P7 joint case.';

revoke all on function public.derive_credited_organization_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The existing rows already satisfy the invariant; assert it rather than rewrite
-- frozen credit. (Every current interval is a DVD member on a DVD call-out, so
-- 022's `credited = organization_id` backfill already equals the member's
-- service. A rewrite would in any case be refused by 031's freeze.)
-- ---------------------------------------------------------------------------
do $$
declare
  wrong bigint;
begin
  select count(*) into wrong
    from public.attendance_intervals a
    join public.members m on m.id = a.member_id
   where a.credited_organization_id is distinct from m.organization_id;

  if wrong > 0 then
    raise exception 'ATTENDANCE_CREDIT_BACKFILL_MISMATCH: % row(s) credited to a service other than their member''s', wrong;
  end if;
end;
$$;
