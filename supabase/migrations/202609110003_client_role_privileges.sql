-- DVD Tivat: least privilege for the client-facing database roles.
--
-- WHY THIS EXISTS.
--
-- A Supabase project ships with
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- so every table created by 202609090001 and 202609090002 arrives on a real
-- project with INSERT, UPDATE, DELETE and TRUNCATE already granted to
-- `authenticated`. 202609090002 revoked everything from `anon`, but for
-- `authenticated` it only ADDED `select` - it never took the write privileges
-- away, because on a bare PostgreSQL instance they were never there to take.
--
-- The consequence is that on the hosted project the rule "every operational
-- write goes through a security definer command" rested on ONE layer: the
-- absence of a permissive write policy. That is thinner than it should be, and
-- for one command it is not a layer at all - PostgreSQL does not apply row
-- level security to TRUNCATE.
--
-- This migration restores the intended two layers: a client role holds only the
-- privileges its policies actually need, and row level security then decides
-- which rows. Both must agree before anything is written.
--
-- `service_role` (the secret key, server side only) and the project owner are
-- deliberately untouched: `service_role` already bypasses row level security by
-- design and exists precisely for trusted server work.
--
-- Project-wide `alter default privileges` is deliberately NOT changed here. It
-- is a setting for the whole project, including tables the owner may create from
-- the dashboard, and silently changing it would surprise them later. Instead the
-- rule is enforced where it belongs - in the test suite, which fails if any
-- table in `public` ever grants a client role more than the list below.

-- ---------------------------------------------------------------------------
-- 1. Take everything back from both client roles.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Grant back exactly what the policies need, and nothing else.
-- ---------------------------------------------------------------------------

-- Reads. Every table in `public` carries at least one SELECT policy, so the
-- grant is uniform and row level security decides the rows. An unapproved or
-- suspended account still sees nothing: `current_dvd_role()` returns NULL for
-- it and every policy is written against that.
grant select on all tables in schema public to authenticated;

-- Writes. Exactly three INSERT policies exist in the whole schema, and these are
-- the only three direct writes a client may attempt. Each is a request or a
-- self-scoped record that changes no operational fact by itself; everything that
-- does change one goes through a security definer command instead.
grant insert on public.attendance_correction_requests to authenticated;  -- ask for your OWN interval to be corrected
grant insert on public.citizen_reports to authenticated;                 -- abandoned research path, kept consistent
grant insert on public.report_media to authenticated;                    -- image row for your own unverified report

-- `anon` is granted nothing at all, here or anywhere: an unauthenticated caller
-- has no readable table and no callable operational command.

-- ---------------------------------------------------------------------------
-- 3. Sequences.
-- ---------------------------------------------------------------------------

-- Nothing in this schema uses a sequence - every key is a uuid - so there is no
-- sequence privilege to grant. Stated rather than left to inference, because a
-- future serial column would need its own decision.
