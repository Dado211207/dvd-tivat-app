-- Removes dvd_release_dump and every grant made to it. Safe to run twice.
do $drop$
begin
  if exists (select 1 from pg_roles where rolname = 'dvd_release_dump') then
    -- End its sessions first: a role with open connections cannot be dropped.
    perform pg_terminate_backend(pid) from pg_stat_activity where usename = 'dvd_release_dump';
    execute 'revoke all on all tables in schema public from dvd_release_dump';
    execute 'revoke all on all sequences in schema public from dvd_release_dump';
    execute 'revoke all on auth.users from dvd_release_dump';
    execute 'revoke all on supabase_migrations.schema_migrations from dvd_release_dump';
    execute 'revoke usage on schema public, auth, supabase_migrations from dvd_release_dump';
    execute 'drop owned by dvd_release_dump';
    execute 'drop role dvd_release_dump';
  end if;
end
$drop$;
