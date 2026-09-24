-- ===========================================================================
-- Read-only export of the authority-relevant state, for the P3 equivalence gate
--
-- docs/MULTI_ORG_PLAN.md section 11 makes one thing the precondition for the
-- whole policy rewrite: P3's equivalence test has to run against a copy of
-- production, because a fixture cannot prove anything about the accounts that
-- actually exist. This query produces that copy's input.
--
-- ---------------------------------------------------------------------------
-- What it reads, and what it deliberately does not
-- ---------------------------------------------------------------------------
--
-- The authority functions are pure functions of a small, known set of columns:
--
--   access_grants             user_id, role, active
--   profiles                  user_id, profile_complete
--   organization_memberships  organization_id, user_id, role, active
--   organizations             id, active
--   members                   id, user_id, organization_id, active
--
-- So that is all this exports. Names, e-mail addresses, phone numbers and dates
-- of birth are NEVER read - for the optional ones the query reads only whether
-- a value is present, because presence is what registration state is made of
-- and the value itself cannot change any function's answer. The gate script
-- substitutes obviously synthetic values on the way in.
--
-- Account and member identifiers are replaced by a dense sequence, so the
-- export carries no production identifier at all. Organisation identifiers are
-- kept verbatim, and have to be: `current_dvd_role()` hard-codes the DVD uuid,
-- so remapping it would test a different question.
--
-- ---------------------------------------------------------------------------
-- How to use it
-- ---------------------------------------------------------------------------
--
--   1. Run this against the hosted project with a READ-ONLY path. It performs
--      no write of any kind and needs no elevated privilege beyond reading the
--      six tables above.
--   2. Save the single returned value as a .json file OUTSIDE the repository.
--      It is pseudonymised, but it is still production-derived and section 11
--      does not ask for it to be kept. Name it `*.production-export.json`:
--      .gitignore covers that suffix, as a backstop for saving it in the tree
--      by accident rather than as permission to.
--   3. Add `production_baseline` and `hosted_function_fingerprints` to that
--      file - the two blocks at the bottom of this file produce them.
--   4. node scripts/p3-equivalence-gate.mjs <path to that file>
--
-- The gate refuses to draw a conclusion unless the copy it builds reproduces
-- `production_baseline` exactly, so a stale or partial export fails loudly
-- rather than quietly grading an easier question.
-- ===========================================================================

with m as (
  select u.id as real_id,
         row_number() over (order by u.id) as n,
         ('00000000-0000-4000-9000-' || lpad((row_number() over (order by u.id))::text, 12, '0'))::uuid as sid
  from auth.users u
),
mm as (
  select mem.id as real_id,
         row_number() over (order by mem.id) as n,
         ('00000000-0000-4000-a000-' || lpad((row_number() over (order by mem.id))::text, 12, '0'))::uuid as sid
  from public.members mem
)
select jsonb_pretty(jsonb_build_object(
  'accounts', (select jsonb_agg(jsonb_build_object('n', m.n, 'id', m.sid) order by m.n) from m),
  'organizations', (select jsonb_agg(jsonb_build_object(
        'id', o.id, 'code', o.code, 'display_name', o.display_name, 'active', o.active) order by o.code)
      from public.organizations o),
  'profiles', (select jsonb_agg(jsonb_build_object(
        'user_n', m.n, 'id', m.sid,
        'full_name_present', (p.full_name is not null),
        'phone_present', (p.phone_e164 is not null),
        'dob_present', (p.date_of_birth is not null),
        'profile_complete', p.profile_complete) order by m.n)
      from public.profiles p join m on m.real_id = p.user_id),
  'access_grants', (select jsonb_agg(jsonb_build_object(
        'user_n', m.n, 'id', m.sid, 'role', g.role, 'active', g.active,
        'granted_by_n', gb.n) order by m.n)
      from public.access_grants g join m on m.real_id = g.user_id
      left join m gb on gb.real_id = g.granted_by),
  'organization_memberships', (select jsonb_agg(jsonb_build_object(
        'organization_id', om.organization_id, 'user_n', m.n, 'user_id', m.sid,
        'role', om.role, 'active', om.active, 'granted_by_n', gb.n)
        order by om.organization_id, m.n)
      from public.organization_memberships om join m on m.real_id = om.user_id
      left join m gb on gb.real_id = om.granted_by),
  'members', (select jsonb_agg(jsonb_build_object(
        'member_n', mm.n, 'id', mm.sid, 'user_n', m.n, 'user_id', m.sid,
        'specialties', mem.specialties, 'active', mem.active) order by mm.n)
      from public.members mem join mm on mm.real_id = mem.id
      left join m on m.real_id = mem.user_id)
)) as export;

-- ---------------------------------------------------------------------------
-- production_baseline.rows
-- ---------------------------------------------------------------------------
--
-- `current_dvd_role()` and `current_member_id()` re-expressed as plain SELECTs
-- taking an explicit user id instead of auth.uid(). Same text, one substitution,
-- so what comes back is what the hosted functions themselves would answer. The
-- gate compares the copy against this; without it the copy would only be
-- checked against its own assumptions.

-- with m as (...), mm as (...)   -- the same two CTEs as above
-- select m.n as account_n,
--   (select g.role
--      from public.access_grants g
--      join public.profiles p on p.user_id = g.user_id
--     where g.user_id = m.real_id and g.active = true and p.profile_complete = true
--       and g.role in ('OWNER','ADMIN','COMMANDER','FIREFIGHTER')) as dvd_role,
--   (select mm.n
--      from public.members mem
--      join mm on mm.real_id = mem.id
--     where mem.user_id = m.real_id and mem.active = true
--       and (select g.role from public.access_grants g
--              join public.profiles p on p.user_id = g.user_id
--             where g.user_id = m.real_id and g.active = true and p.profile_complete = true
--               and g.role in ('OWNER','ADMIN','COMMANDER','FIREFIGHTER')) is not null) as member_n
-- from m order by m.n;

-- ---------------------------------------------------------------------------
-- hosted_function_fingerprints
-- ---------------------------------------------------------------------------
--
-- The copy is only worth measuring if it is running the same code. These two
-- md5s are checked before the baseline comparison, so a copy built from a
-- different migration set is caught at the point it stops being a copy.

-- select p.proname, md5(pg_get_functiondef(p.oid)) as md5
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('current_dvd_role','current_member_id')
--  order by p.proname;
