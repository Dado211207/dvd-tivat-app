-- ===========================================================================
-- 202609230021 - the third stripped-comment apply, put back
--
-- NO BEHAVIOUR CHANGE. One function is re-created with the body 202609150010
-- already defines. On a replay from zero this file is a no-op: 202609150010 is
-- the only migration that defines `intervention_audit`, and this is its text.
--
-- ---------------------------------------------------------------------------
-- How it was found, which is the point
-- ---------------------------------------------------------------------------
--
-- The first two of these - 202609130006a and 202609230020 - were found by hand,
-- eleven days apart, by somebody who happened to be looking. This one was found
-- by `scripts/check-migration-drift.mjs` on its first run against the hosted
-- project, which is the whole reason that script exists:
--
--   intervention_audit() differs: hosted body 428 characters, this repository 684
--
-- The 256 characters are exactly the four-line comment above the `order by`.
-- Every other character of the body matched, so the chronology has always read
-- the same; what was lost is the ability to compare the two sides by function
-- text, which is how the next divergence gets noticed.
--
-- ---------------------------------------------------------------------------
-- Ordering
-- ---------------------------------------------------------------------------
--
-- Numbered last, and safely so: no migration after 202609150010 touches this
-- function, so applying its 010 text at the end changes nothing a replay would
-- otherwise produce. That is NOT true of 202609130006a, which has to sit where
-- it ran - see its header.
--
-- Applied to the hosted project as `restore_intervention_audit_exact_text`
-- (version 20260923180117) before this file was committed, and the file is
-- named for that entry so the drift check can match the two by name.
--
--   before   md5 968efd30bc040e45700f2acdc12eef53   428 characters
--   after    md5 da58b663eccf1d234a50c40bf2467783   684 characters
--   local    md5 da58b663eccf1d234a50c40bf2467783   684 characters
--
-- `create or replace` keeps the existing privileges and comment, and both were
-- confirmed unchanged afterwards: the execute grants still read
-- `postgres=X/postgres authenticated=X/postgres service_role=X/postgres`.
-- ===========================================================================

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
    and (public.is_dvd_command() or public.is_recipient_of(target_intervention))
  -- Deterministic: two events written inside one transaction share `occurred_at`
  -- to the microsecond, and an archive whose lines shuffle between two readings
  -- of the same record is not a record. The id breaks the tie the same way
  -- every time.
  order by entry.occurred_at, entry.id
$$;
