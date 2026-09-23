-- ===========================================================================
-- 202609230018 - a call-out may only reach the service that sent it
--
-- PURELY ADDITIVE in shape. It creates one function and replaces two function
-- BODIES without touching their signatures, result columns or privileges. It
-- drops nothing, alters no column and removes no grant, so the
-- drop-and-recreate warning in docs/DATABASE.md section 3.1 does not apply.
--
-- INDEPENDENT OF 202609220017. This migration touches only the two
-- eligibility functions; 202609220017 touches the audit triggers,
-- `owner_set_role` and `owner_set_organization_membership`. Neither reads the
-- other, so this may be applied to production on its own, before or after it,
-- in either order.
--
-- ---------------------------------------------------------------------------
-- The defect
-- ---------------------------------------------------------------------------
--
-- `is_eligible_recipient()` and `eligible_recipients()` decide who may be
-- called out. Both ask five questions - active member record, linked account,
-- complete profile, active grant, operational role - and not a sixth one:
-- WHICH SERVICE the person serves in.
--
-- With one service that was invisible. `organizations` has held two rows since
-- 202609200013, and `owner_set_organization_membership` can already assign
-- somebody to SZS. The moment the first SZS member exists:
--
--   * DVD's recipient picker offers SZS's people, and SZS's offers DVD's;
--   * `publish_intervention` accepts them, because it validates through
--     `is_eligible_recipient()`, so a call-out actually pages them;
--   * the resulting `intervention_recipients` rows freeze the other service's
--     member names into this service's permanent record.
--
-- That is the wrong direction entirely. Cross-service alerting is a feature
-- somebody has to ask for, deliberately, per call-out - not something that
-- happens because nobody wrote a WHERE clause. This migration closes it
-- BEFORE the first SZS member is added, so the leak never has data to leak.
--
-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
--
-- A caller may see, and may address a call-out to, somebody they SERVE WITH.
--
-- "Serve with" is read from `organization_memberships`, which is already the
-- truthful statement of who belongs to which service - it is written by
-- `owner_set_organization_membership` and mirrored from every grant by
-- `sync_dvd_membership_from_grant`. It carries no authority yet and this
-- migration does not give it any: nothing here reads a membership ROLE, only
-- whether two people share an active membership in the same active service.
--
-- THE INSTALLATION OWNER IS IN EVERY SERVICE, in both directions.
--
-- There is exactly one owner, enforced by a partial unique index, and that
-- account administers the whole installation: it already reads every profile,
-- every grant and every audit table. Since 202609210016 it also deliberately
-- holds NO membership row, so that assigning it a service cannot overwrite the
-- only OWNER grant - which means a plain "shares a membership" test would make
-- the owner invisible to everybody and blind to everybody.
--
-- Both directions matter and both are existing, documented behaviour:
--
--   * as CALLER, the owner keeps seeing the whole roster, as every other
--     owner-scoped read already lets it;
--   * as TARGET, the owner stays callable. 202609150008 decided that
--     deliberately - "in a volunteer fire society the commander and the
--     administrator turn out to incidents like everybody else" - and
--     db-tests/owner_firefighter.test.ts pins it.
--
-- So this migration is invisible to a single-service installation. Every
-- existing DVD account sees exactly the people it saw yesterday. What changes
-- is only what happens once a second service has members.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Do these two people serve together?
-- ---------------------------------------------------------------------------

create or replace function public.serves_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- The installation owner administers every service: it sees everybody.
    public.is_dvd_owner()
    -- ...and is seen by everybody, because it holds no membership row of its
    -- own by design, yet turns out to incidents like any other member.
    or coalesce(
         (select grant_row.role from public.access_grants grant_row
          where grant_row.user_id = target_user),
         '') = 'OWNER'
    -- Otherwise: one active membership each, in the same active service.
    or exists (
      select 1
      from public.organization_memberships mine
      join public.organization_memberships theirs
        on theirs.organization_id = mine.organization_id
      join public.organizations service
        on service.id = mine.organization_id
      where mine.user_id = auth.uid()
        and mine.active = true
        and theirs.user_id = target_user
        and theirs.active = true
        and service.active = true
    )
$$;

comment on function public.serves_with(uuid) is
  'True when the caller and the target account serve in the same active service, or either of them is the installation owner. Reads membership only, never a membership role: this grants nothing on its own.';

-- ---------------------------------------------------------------------------
-- 2. The two eligibility functions gain the missing question
-- ---------------------------------------------------------------------------
--
-- Both bodies are otherwise unchanged from 202609150008. The single added
-- clause is the `serves_with` call; everything else is reproduced exactly so
-- the diff between the two migrations is the fix and nothing else.

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
      and public.serves_with(member.user_id)
  )
$$;

comment on function public.is_eligible_recipient(uuid) is
  'A member who can actually receive and answer a call-out FROM THIS CALLER: active record, linked account, complete profile, active grant, operational role, and serving in the same service as the caller. Publishing refuses anybody else.';

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
    and public.serves_with(member.user_id)
  order by member.full_name
$$;

comment on function public.eligible_recipients() is
  'Members the CALLER may call out, by the same rule publish_intervention enforces.';

-- ---------------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------------
--
-- The two replaced functions keep the grants 202609150008 gave them; replacing
-- a body does not disturb them. `serves_with` is new and gets the same
-- treatment as the eligibility helpers it serves: reachable by a signed-in
-- caller, never by an anonymous one.

revoke all on function public.serves_with(uuid) from public, anon;
grant execute on function public.serves_with(uuid) to authenticated;
