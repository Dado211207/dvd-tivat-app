-- ===========================================================================
-- 202609240023 - authority learns about services, and nothing else changes
--
-- P3 of docs/MULTI_ORG_PLAN.md. NO POLICY CHANGE. All fifty-one policies keep
-- their present text; no command changes; no client call site changes. What
-- changes is what `current_dvd_role()` reads underneath, and the entire job of
-- this phase is to prove that produces the same answers before anything is
-- allowed to depend on it.
--
-- ---------------------------------------------------------------------------
-- What it adds
-- ---------------------------------------------------------------------------
--
--   is_installation_owner()        - installation-wide, belongs to no service
--   current_role_in(uuid)          - the caller's role in one service
--   is_staff_in(uuid)              - any role there
--   is_command_in(uuid)            - OWNER, ADMIN or COMMANDER there
--   is_admin_in(uuid)              - OWNER or ADMIN there
--   current_member_id_in(uuid)     - the caller's member record in one service
--
-- Then `current_dvd_role()` becomes a shim over `current_role_in(DVD)` and
-- `current_member_id()` a shim over `current_member_id_in(DVD)`, both keeping
-- their exact signatures. `is_dvd_staff`, `is_dvd_command` and `is_dvd_owner`
-- are left alone: they are already written in terms of `current_dvd_role()` and
-- follow it for free.
--
-- ---------------------------------------------------------------------------
-- Why the shim cannot simply read memberships
-- ---------------------------------------------------------------------------
--
-- `sync_dvd_membership_from_grant` mirrors an operational grant into an active
-- DVD membership, so the two mostly agree. Two places they deliberately do not,
-- both measured on the hosted project rather than reasoned about:
--
--   grant        active  profile  DVD membership       current_dvd_role() today
--   OWNER        yes     yes      NONE                 OWNER
--   FIREFIGHTER  no      no       FIREFIGHTER active   NULL
--
-- THE FIRST IS THE LIVE INSTALLATION OWNER. The mirror deactivates an owner's
-- DVD membership on purpose, so a shim reading memberships alone would lock the
-- owner out of their own installation on the day it was applied.
--
-- The second is a suspended account. The mirror is declared
-- `after insert or update OF ROLE`, so it never fires when `active` changes:
-- suspension leaves the membership standing and only the account-level gate
-- stops it. That gate is not belt-and-braces, it is the only thing there.
--
-- So authority resolves in three steps, and all three are load-bearing:
--
--   1. the account must be usable at all - a grant that exists, is active, and
--      a finished profile. This is installation-wide and survives P5.
--   2. the installation owner is the owner everywhere, member or not.
--   3. anyone else holds what their ACTIVE membership in that service says.
--
-- ---------------------------------------------------------------------------
-- The equivalence this rests on, stated plainly
-- ---------------------------------------------------------------------------
--
-- For DVD, step 3 reads the membership where the old function read the grant.
-- Those agree for every account on the hosted project today, and the mirror is
-- what keeps them agreeing. `organisation_authority.test.ts` asserts the
-- invariant directly rather than trusting it, so a later change that lets the
-- two drift is caught rather than discovered by somebody losing access.
--
-- P5 is where the grant's role stops carrying authority at all and this
-- equivalence stops mattering. Until then it does, and it is checked.
--
-- ---------------------------------------------------------------------------
-- What this phase deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- No policy is rewritten - that is P4, and it is the large one. No command
-- learns a service parameter. No client code changes. The parentless
-- `operational_audit` write restriction recorded in 202609240022's header stays
-- open; it is an authority question about who may write, which is P4's.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The account-level gate
-- ---------------------------------------------------------------------------
--
-- Suspension and half-finished registration are properties of the ACCOUNT, not
-- of any service, and they must stay that way: an account suspended by the
-- installation owner is suspended everywhere, and no membership overrides it.

create or replace function public.current_account_is_usable()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.access_grants grant_row
    join public.profiles profile on profile.user_id = grant_row.user_id
    where grant_row.user_id = auth.uid()
      and grant_row.active = true
      and profile.profile_complete = true
  )
$$;

comment on function public.current_account_is_usable() is
  'The account exists, is not suspended and finished registration. Says nothing '
  'about which service the person serves in, or whether they serve at all.';

-- ---------------------------------------------------------------------------
-- 2. The installation owner
-- ---------------------------------------------------------------------------
--
-- D9: one owner administers both services. The owner is not a member of either
-- - the mirror deactivates an owner's DVD membership deliberately - so this
-- reads the grant, which is the one place installation-wide facts live.

create or replace function public.is_installation_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.access_grants grant_row
    join public.profiles profile on profile.user_id = grant_row.user_id
    where grant_row.user_id = auth.uid()
      and grant_row.active = true
      and profile.profile_complete = true
      and grant_row.role = 'OWNER'
  )
$$;

comment on function public.is_installation_owner() is
  'The single installation owner (D9). Installation-wide: true regardless of '
  'which services the account belongs to, including none.';

-- ---------------------------------------------------------------------------
-- 3. Authority within one service
-- ---------------------------------------------------------------------------

create or replace function public.current_role_in(target_organization uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.current_account_is_usable() then null
    when public.is_installation_owner() then 'OWNER'
    else (
      select membership.role
      from public.organization_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where membership.organization_id = target_organization
        and membership.user_id = auth.uid()
        and membership.active = true
        and organization.active = true
        and membership.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
    )
  end
$$;

comment on function public.current_role_in(uuid) is
  'The caller''s role in one service, or NULL. The installation owner is OWNER '
  'in every service without being a member of any.';

create or replace function public.is_staff_in(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_role_in(target_organization)
      in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'), false)
$$;

create or replace function public.is_command_in(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_role_in(target_organization) in ('OWNER', 'ADMIN', 'COMMANDER'), false)
$$;

create or replace function public.is_admin_in(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_role_in(target_organization) in ('OWNER', 'ADMIN'), false)
$$;

comment on function public.is_staff_in(uuid) is 'Any operational role in that service.';
comment on function public.is_command_in(uuid) is
  'May publish, change status, close and verify attendance in that service.';
comment on function public.is_admin_in(uuid) is
  'May maintain that service''s members, groups and vehicles.';

-- ---------------------------------------------------------------------------
-- 4. Identity within one service
-- ---------------------------------------------------------------------------
--
-- 202609240022 made `members` unique per service so one person can hold a
-- record in each, which is exactly what left the old `current_member_id()` able
-- to match two rows and return an arbitrary one. This is the phase that closes
-- it, as that migration's header said it had to be.

create or replace function public.current_member_id_in(target_organization uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member_row.id
  from public.members member_row
  where member_row.user_id = auth.uid()
    and member_row.organization_id = target_organization
    and member_row.active = true
    -- Authority and identity are not separable: a withdrawn, unapproved or
    -- half-registered account is nobody operationally, whatever the roster
    -- still says about the person.
    and public.current_role_in(target_organization) is not null
$$;

comment on function public.current_member_id_in(uuid) is
  'The caller''s member record in one service, or NULL. Exactly one row per '
  'service by the unique constraint 202609240022 introduced.';

-- ---------------------------------------------------------------------------
-- 5. The shims
-- ---------------------------------------------------------------------------
--
-- Same names, same signatures, same answers. Every policy and command in the
-- schema keeps calling these and resolves through the new path without knowing.

create or replace function public.current_dvd_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_in('00000000-0000-4000-8000-000000000001')
$$;

comment on function public.current_dvd_role() is
  'Compatibility shim over current_role_in(DVD). Kept so the fifty-one existing '
  'policies need no edit in this phase; P4 replaces the call sites.';

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_member_id_in('00000000-0000-4000-8000-000000000001')
$$;

comment on function public.current_member_id() is
  'Compatibility shim over current_member_id_in(DVD). Deterministic now that a '
  'person may hold a member record in each service.';

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
--
-- The same shape as every other function here: nothing for `public` or `anon`,
-- execute for `authenticated`, and each one checks the caller itself. The two
-- shims already hold their grants from the migrations that created them;
-- `create or replace` leaves those untouched, so only the new functions are
-- granted here.

revoke all on function public.current_account_is_usable() from public, anon;
revoke all on function public.is_installation_owner() from public, anon;
revoke all on function public.current_role_in(uuid) from public, anon;
revoke all on function public.is_staff_in(uuid) from public, anon;
revoke all on function public.is_command_in(uuid) from public, anon;
revoke all on function public.is_admin_in(uuid) from public, anon;
revoke all on function public.current_member_id_in(uuid) from public, anon;

grant execute on function public.current_account_is_usable() to authenticated;
grant execute on function public.is_installation_owner() to authenticated;
grant execute on function public.current_role_in(uuid) to authenticated;
grant execute on function public.is_staff_in(uuid) to authenticated;
grant execute on function public.is_command_in(uuid) to authenticated;
grant execute on function public.is_admin_in(uuid) to authenticated;
grant execute on function public.current_member_id_in(uuid) to authenticated;
