-- ===========================================================================
-- 202609150008 - who may be called out, and who may read what happened
--
-- PURELY ADDITIVE. It creates one function, replaces two function BODIES
-- without touching their signatures or result columns, and adds one RLS
-- policy. It drops nothing, alters no column, and removes no privilege, so
-- the drop-and-recreate warning in docs/DATABASE.md section 3.1 does not
-- apply here.
--
-- ---------------------------------------------------------------------------
-- 1. A withdrawn member was still callable
-- ---------------------------------------------------------------------------
--
-- Found on the real hosted project during the physical device test of
-- 13 September 2026: the recipient picker offered "Bivsi Clan", the fictional
-- member whose ACCOUNT had been withdrawn by the owner.
--
-- It was not a rendering mistake. `publish_intervention` filtered recipients
-- on `members.active = true` and nothing else, so a member row that is still
-- active in the roster passed - even though the person behind it can no longer
-- sign in, holds no role, and would be refused by every command in this schema
-- the moment they tried to answer.
--
-- The consequence is worse than an untidy list. Publishing to them wrote a
-- frozen recipient row and a QUEUED outbox row, so the call-out counted
-- somebody who could never open it, and every "invited" figure was wrong.
--
-- Being callable now means the same thing as being able to act, which is the
-- only definition that cannot drift:
--
--   * an active member record,
--   * linked to an account,
--   * whose profile is complete,
--   * whose access grant is active,
--   * and whose role is one this society actually calls out.
--
-- Those are exactly the conditions `current_dvd_role()` already applies to
-- decide whether somebody has an operational role at all. Reusing them means
-- "can be called" and "can respond" can never disagree.
--
-- ELIGIBLE ROLES - a deliberate decision, not an oversight. OWNER, ADMIN,
-- COMMANDER and FIREFIGHTER are all eligible recipients. In a volunteer fire
-- society the commander and the administrator turn out to incidents like
-- everybody else; excluding them would mean the roster could not call the
-- people most likely to attend. A PENDING account holds no role and is not
-- eligible, which is the same answer the rest of the schema gives.
--
-- ---------------------------------------------------------------------------
-- 2. The people an intervention was about could not read its history
-- ---------------------------------------------------------------------------
--
-- `operational_audit` already records every event the archive needs, including
-- the two the chronology was missing: `INTERVENTION_STATUS_CHANGED` for the
-- Okupljanje/Na terenu/Pod kontrolom transitions, and `JOURNEY_PROGRESS_SET`
-- for each of Krecem, U putu and Na licu mjesta. Nothing was being overwritten
-- and no new audit model is needed - the archive simply never read the table.
--
-- It could not have read it for a firefighter anyway: the only policy on that
-- table is `is_dvd_command()`. A member who attended an intervention could
-- open its archive entry and see a chronology assembled from current-state
-- rows, which is why only their LATEST movement appeared and no state
-- transition did.
--
-- This adds a second read policy, alongside the command one rather than
-- replacing it: a member may read the audit trail of an intervention they
-- were actually called to. That is their own participation record. It grants
-- nothing about any other intervention, and it is a SELECT policy only -
-- no client may write an audit row through any policy, in any role.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Eligibility, in one place
-- ---------------------------------------------------------------------------

create or replace function public.is_eligible_recipient(target_member uuid)
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
      and member.active = true
      and member.user_id is not null
      and profile.profile_complete = true
      and grant_row.active = true
      and grant_row.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER')
  )
$$;

comment on function public.is_eligible_recipient(uuid) is
  'A member who can actually receive and answer a call-out: active record, linked account, complete profile, active grant, operational role. Publishing refuses anybody else.';

-- The list the commander picks from. Same rule, so the screen cannot offer
-- somebody the server will refuse - but the server refuses regardless, which
-- is what makes a modified client harmless.
create or replace function public.eligible_recipients()
returns table (member_id uuid, full_name text, role text, specialties text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member.id, member.full_name, grant_row.role, member.specialties
  from public.members member
  join public.profiles profile on profile.user_id = member.user_id
  join public.access_grants grant_row on grant_row.user_id = member.user_id
  where public.is_dvd_staff()
    and member.active = true
    and member.user_id is not null
    and profile.profile_complete = true
    and grant_row.active = true
    and grant_row.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER')
  order by member.full_name
$$;

comment on function public.eligible_recipients() is
  'Members who may be called out, by the same rule publish_intervention enforces.';

-- ---------------------------------------------------------------------------
-- 2. Publishing refuses an ineligible recipient
-- ---------------------------------------------------------------------------
--
-- The body changes; the signature and return type do not, so this is a
-- `create or replace` and every existing caller and grant keeps working.

create or replace function public.publish_intervention(
  target_intervention uuid,
  recipient_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  member_row record;
  frozen_count integer := 0;
  ineligible_count integer := 0;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;

  select status into current_status
  from public.interventions where id = target_intervention for update;
  if current_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;

  -- Already published: this is a retry, not a second call-out.
  if current_status <> 'DRAFT' then
    if current_status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
    return target_intervention;
  end if;

  if recipient_member_ids is null or array_length(recipient_member_ids, 1) is null then
    raise exception 'NO_RECIPIENTS';
  end if;

  -- Refuse the whole call-out rather than silently dropping somebody. A
  -- commander who selected five people and got four must be told, not left to
  -- discover it when one of them never answers. This also means a modified
  -- client that posts an ineligible id directly gets an error, not a partial
  -- publication.
  select count(*) into ineligible_count
  from unnest(recipient_member_ids) as requested(member_id)
  where not public.is_eligible_recipient(requested.member_id);

  if ineligible_count > 0 then
    raise exception 'RECIPIENT_NOT_ELIGIBLE';
  end if;

  for member_row in
    select id, full_name from public.members
    where id = any(recipient_member_ids) and active = true
  loop
    insert into public.intervention_recipients(
      intervention_id, member_id, recipient_version, member_name_at_publication)
    values (target_intervention, member_row.id, 1, member_row.full_name)
    on conflict do nothing;

    insert into public.notification_outbox(
      intervention_id, member_id, channel, state, dedupe_key)
    values (
      target_intervention, member_row.id, 'IN_APP', 'QUEUED',
      target_intervention::text || ':' || member_row.id::text || ':1')
    on conflict do nothing;

    frozen_count := frozen_count + 1;
  end loop;

  if frozen_count = 0 then raise exception 'NO_ACTIVE_RECIPIENTS'; end if;

  update public.interventions
  set status = 'PUBLISHED',
      published_at = coalesce(published_at, now()),
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (
    target_intervention,
    'INTERVENTION_PUBLISHED',
    jsonb_build_object('recipient_count', frozen_count),
    auth.uid());

  return target_intervention;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A member may read the history of an intervention they were called to
-- ---------------------------------------------------------------------------
--
-- Added ALONGSIDE `operational_audit_command_read`, which is untouched.
-- PostgreSQL ORs permissive policies, so command roles keep reading
-- everything and a recipient gains exactly their own interventions.

create policy operational_audit_recipient_read on public.operational_audit
  for select using (
    intervention_id is not null and public.is_recipient_of(intervention_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------
--
-- `anon` may execute nothing. PostgreSQL grants EXECUTE to PUBLIC by default
-- on a newly created function, and revoking from `anon` alone does not remove
-- that - the revoke must name PUBLIC.

revoke all on function public.is_eligible_recipient(uuid) from public, anon;
revoke all on function public.eligible_recipients() from public, anon;
grant execute on function public.is_eligible_recipient(uuid) to authenticated;
grant execute on function public.eligible_recipients() to authenticated;
