-- ===========================================================================
-- dvd_release_dump: the only credential the restored-copy capture needs
--
-- A short-lived login that can READ the rows and definitions the P4 capture
-- is built from, and nothing it could use to change application data:
--
--   * no membership in any role - not anon, authenticated, service_role,
--     postgres or a predefined pg_* role - so it cannot SET ROLE, inherit an
--     API role's privileges, or act as an account with forged JWT claims;
--   * SELECT only, granted object by object - not pg_read_all_data, which on
--     Supabase would also read the pg_net request queue, cron and vault;
--   * BYPASSRLS, so a dump sees every row rather than an RLS-filtered subset
--     (without it pg_dump refuses rather than under-dumping);
--   * on auth.users only the three columns the capture reads, so password
--     hashes, tokens and e-mail addresses are never readable;
--   * one transaction's worth of time: VALID UNTIL four hours after creation,
--     at most two connections (the snapshot holder and pg_dump).
--
-- What it still has comes from PUBLIC, which every login role on the project
-- has and no grant to this role can remove. scripts/restored-capture/
-- privileges.sql reports it; the capture refuses to run unless it is limited
-- to the documented pg_net platform grants (docs/P7_P8_RELEASE_PREP.md).
--
-- Run as the project owner (`postgres`) in the SQL editor. Replace
-- __SCRAM_VERIFIER__ with a SCRAM-SHA-256 verifier, never a plaintext
-- password: `node scripts/p4-restored-capture.mjs verifier` prints one and the
-- matching password once, for the environment secret only.
--
-- Afterwards, and whatever happened: scripts/restored-capture/drop-dump-role.sql
-- ===========================================================================

do $spec$
begin
  if exists (select 1 from pg_roles where rolname = 'dvd_release_dump') then
    raise exception 'dvd_release_dump already exists - run drop-dump-role.sql first';
  end if;
  if '__SCRAM_VERIFIER__' not like 'SCRAM-SHA-256$%' then
    raise exception 'replace __SCRAM_VERIFIER__ with a SCRAM-SHA-256 verifier';
  end if;
  execute format(
    'create role dvd_release_dump login noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls '
    'connection limit 2 valid until %L password %L',
    (now() + interval '4 hours')::text, '__SCRAM_VERIFIER__');
end
$spec$;

grant usage on schema public, auth, supabase_migrations to dvd_release_dump;
grant select on all tables in schema public to dvd_release_dump;
grant select on all sequences in schema public to dvd_release_dump;
grant select (id, email_confirmed_at, created_at) on auth.users to dvd_release_dump;
grant select (version, name) on supabase_migrations.schema_migrations to dvd_release_dump;

-- Conveniences, not controls: the holder can change both in its own session.
alter role dvd_release_dump set default_transaction_read_only = on;
alter role dvd_release_dump set statement_timeout = '10min';
