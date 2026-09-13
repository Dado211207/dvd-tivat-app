-- ===========================================================================
-- 202609150010 - reading the chronology that was already being written
--
-- PURELY ADDITIVE. One new function. Nothing is dropped, altered or revoked,
-- and no existing behaviour changes.
--
-- ---------------------------------------------------------------------------
-- The finding
-- ---------------------------------------------------------------------------
--
-- The archive's chronology was assembled from CURRENT-STATE rows -
-- `intervention_journey` holds one row per member with their latest position,
-- `interventions` holds one status. So the record could show that a member was
-- "Na licu mjesta" but not that they had reported "Krecem" twenty minutes
-- earlier, and it showed no state transition at all: Okupljanje, Na terenu and
-- Pod kontrolom happened and left no line.
--
-- The obvious reading of that is "the movements are being overwritten". They
-- are not. `public.operational_audit` has recorded every one of them since the
-- schema was written - `JOURNEY_PROGRESS_SET` carries `from` and `to` for each
-- step, `INTERVENTION_STATUS_CHANGED` carries both statuses, and each row
-- carries the acting account and the server's own `occurred_at`. Nothing was
-- lost and nothing needs a new audit model.
--
-- The table simply had no reader. It also had exactly one policy -
-- `is_dvd_command()` - so a firefighter could not have read their own
-- participation history even if a screen had asked for it. Migration
-- 202609150008 added their read policy; this adds the reader.
--
-- ---------------------------------------------------------------------------
-- Why a function rather than a plain select
-- ---------------------------------------------------------------------------
--
-- An audit row names its actor by `auth.users` id, which is not something a
-- member can turn into a name: `profiles` is readable only for one's own row
-- plus what the owner may see. A chronology that says "someone changed the
-- state to Na terenu" is worth much less than one that says who, and the
-- brief is explicit that each transition must carry its actor.
--
-- So this function resolves the name server-side, under `security definer`,
-- and returns it only to somebody already entitled to the row: command, or a
-- member who was actually called to that intervention. It exposes no e-mail
-- address and no account id - just the display name already on the roster.
--
-- It is a READ. No client can write an audit row through it, or through any
-- policy, in any role. The actor is always `auth.uid()` recorded by the command
-- that did the work, never anything a browser supplied.
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

comment on function public.intervention_audit(uuid) is
  'The append-only chronology of one intervention, with each actor resolved to a display name. Readable by command and by a member who was called to it.';

revoke all on function public.intervention_audit(uuid) from public, anon;
grant execute on function public.intervention_audit(uuid) to authenticated;
