-- ===========================================================================
-- Effective privileges of one role ($1), as one jsonb row.
--
-- Everything the role can do through its own grants, its memberships and
-- PUBLIC. An object counts only if the role can also reach its schema
-- (USAGE): cron.job_run_details grants DELETE to PUBLIC on Supabase, but
-- PUBLIC has no USAGE on cron, so it is not reachable.
--
-- scripts/restored-capture/privileges.mjs classifies the result; this file
-- only measures. Works on PostgreSQL 16 and 17 (MAINTAIN is 17 only).
-- ===========================================================================
with
target as (select oid, * from pg_roles where rolname = $1),
nsp as (
  select n.oid, n.nspname,
         has_schema_privilege($1, n.oid, 'USAGE') as can_use,
         has_schema_privilege($1, n.oid, 'CREATE') as can_create
    from pg_namespace n
   where n.nspname !~ '^pg_(toast|temp)'),
privs as (
  select unnest(case when current_setting('server_version_num')::int >= 170000
    then array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']
    else array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'] end) as p),
rels as (
  select c.oid, nsp.nspname, c.relname, c.relkind
    from pg_class c join nsp on nsp.oid = c.relnamespace
   where nsp.can_use and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')),
table_writes as (
  select nspname || '.' || relname || ':' || p as item
    from rels cross join privs
   where relkind <> 'S' and has_table_privilege($1, rels.oid, p)),
column_writes as (
  select nspname || '.' || relname || ':column ' || p as item
    from rels cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) v(p)
   where relkind in ('r', 'p', 'v', 'f')
     and not has_table_privilege($1, rels.oid, p)
     and has_any_column_privilege($1, rels.oid, p)),
sequence_writes as (
  select nspname || '.' || relname || ':' || p as item
    from rels cross join (values ('USAGE'), ('UPDATE')) v(p)
   where relkind = 'S' and has_sequence_privilege($1, rels.oid, p)),
reads as (
  select nspname || '.' || relname as item
    from rels where has_any_column_privilege($1, rels.oid, 'SELECT') and relkind <> 'S'),
functions as (
  select nsp.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
         p.prosecdef, p.provolatile, nsp.nspname
    from pg_proc p join nsp on nsp.oid = p.pronamespace
   where nsp.can_use and has_function_privilege($1, p.oid, 'EXECUTE'))
select jsonb_build_object(
  'role', $1,
  'exists', exists (select 1 from target),
  'server_major', current_setting('server_version_num')::int / 10000,
  'attributes', (select jsonb_build_object(
      'superuser', rolsuper, 'createrole', rolcreaterole, 'createdb', rolcreatedb,
      'replication', rolreplication, 'bypassrls', rolbypassrls, 'login', rolcanlogin,
      'inherit', rolinherit, 'connection_limit', rolconnlimit,
      'valid_until', rolvaliduntil) from target),
  -- Any role it is a member of, by any route (MEMBER covers SET and USAGE).
  'member_of', (select coalesce(jsonb_agg(r.rolname order by r.rolname), '[]')
      from pg_roles r where r.rolname <> $1 and pg_has_role($1, r.oid, 'MEMBER')),
  'table_writes', (select coalesce(jsonb_agg(item order by item), '[]') from table_writes),
  'column_writes', (select coalesce(jsonb_agg(item order by item), '[]') from column_writes),
  'sequence_writes', (select coalesce(jsonb_agg(item order by item), '[]') from sequence_writes),
  'create_in_schemas', (select coalesce(jsonb_agg(nspname order by nspname), '[]') from nsp where can_create),
  'database', jsonb_build_object(
      'create', has_database_privilege($1, current_database(), 'CREATE'),
      'temporary', has_database_privilege($1, current_database(), 'TEMPORARY')),
  'security_definer_functions', (select coalesce(jsonb_agg(item order by item), '[]') from functions where prosecdef),
  'volatile_invoker_functions_by_schema', (select coalesce(jsonb_object_agg(nspname, n), '{}')
      from (select nspname, count(*) n from functions where not prosecdef and provolatile = 'v' group by nspname) x),
  'readable', (select coalesce(jsonb_agg(item order by item), '[]') from reads),
  'lo_compat_privileges', current_setting('lo_compat_privileges')
) as report;
