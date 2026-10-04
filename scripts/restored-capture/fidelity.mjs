/**
 * Does a restored copy represent the production snapshot it was dumped from?
 *
 * The P4 capture impersonates every account, which no read-only credential on
 * a live database can do (db-tests/capture_role_privileges.test.ts). So the
 * capture runs on a restored copy, and production is asked only what a
 * dump-only role can answer without impersonating anyone - in the SAME
 * snapshot pg_dump reads:
 *
 *   schema_fingerprint  functions, policies, triggers, columns, constraints,
 *                       indexes and table ACLs of `public`
 *   export_digest       per-table digest of the pseudonymised rows
 *   applied_migrations  the hosted migration ledger
 *   column_acls         column-level grants in `public`
 *   environment         what `public` relies on outside it: the auth.uid()
 *                       family, the API roles' attributes, the auth.users
 *                       columns the capture reads, the extensions installed
 *                       in public/extensions, whether object owners bypass
 *                       RLS, and the server's major version
 *
 * That is the source attestation. The copy's own capture must reproduce every
 * part of it, or nothing measured on the copy is evidence about production.
 * Account behaviour is not attested: it is a function of the schema, the rows
 * and the environment, which are, and the gate then requires its own copy to
 * reproduce the restored copy's behaviour account by account.
 *
 * The attestation SQL is derived from scripts/p4-equivalence-production.sql
 * rather than restated, so the two cannot drift apart.
 */

import { createHash } from 'node:crypto';

export const DUMP_ROLE = 'dvd_release_dump';

const LOOP = /\n {2}for k in 0 \.\. n - 1 loop\n[\s\S]*?\n {2}end loop;\n/;
const COUNT = "  perform set_config('gate.n', n::text, true);";
const TABLE_ACL = "array_to_string(c.relacl, ' ')";

/**
 * The capture SQL without its impersonation loop, with the dump role's own
 * grants left out of the table ACLs it fingerprints.
 *
 * The dump role reads `public` through grants on every table, which change
 * those tables' ACLs on production; the restored copy never receives them (the
 * dump is filtered, below). An ACL that held nothing but the dump role's
 * grant on top of the owner's default reads as the default it was before.
 */
export function attestationSql(captureSql, role = DUMP_ROLE) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('unexpected dump role name');
  const loops = captureSql.match(new RegExp(LOOP.source, 'g')) ?? [];
  const acls = captureSql.split(TABLE_ACL).length - 1;
  if (loops.length !== 1 || !captureSql.includes(COUNT) || acls !== 1) {
    throw new Error('scripts/p4-equivalence-production.sql changed shape; update restored-capture/fidelity.mjs with it');
  }
  const stripped = `(select array_to_string(case
      when kept is null then null
      when kept = acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner) then null
      else kept end, ' ')
    from (select case when c.relacl is null then null
      else array(select x from unnest(c.relacl) x where x::text !~ '^"?${role}"?=') end as kept) k)`;
  return captureSql
    .replace(LOOP, '\n')
    .replace(COUNT, "  perform set_config('gate.n', '0', true);")
    .replace(TABLE_ACL, stripped);
}

/** What `public` depends on outside itself. One row, `environment`. */
export const ENVIRONMENT_SQL = `select jsonb_build_object(
  'server_major', current_setting('server_version_num')::int / 10000,
  'auth_functions', (select coalesce(jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        pg_get_functiondef(p.oid)), '{}')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth' and p.proname in ('uid', 'role', 'jwt', 'email')),
  'api_roles', (select coalesce(jsonb_object_agg(rolname, jsonb_build_object(
        'bypassrls', rolbypassrls, 'inherit', rolinherit, 'superuser', rolsuper)), '{}')
      from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
  'auth_users_columns', (select coalesce(jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull)
        order by a.attname), '[]')
      from pg_attribute a where a.attrelid = 'auth.users'::regclass
       and a.attname in ('id', 'email_confirmed_at', 'created_at') and not a.attisdropped),
  'auth_users', (select count(*) from auth.users),
  -- pg_dump of one schema never creates extensions; the copy needs the ones
  -- public's objects can use (btree_gist for an exclusion constraint, pgcrypto).
  'extensions', (select coalesce(jsonb_object_agg(e.extname, jsonb_build_object('schema', n.nspname, 'version', e.extversion)), '{}')
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname in ('public', 'extensions')),
  'owners_bypass_rls', (select coalesce(jsonb_object_agg(r.rolname, r.rolbypassrls or r.rolsuper), '{}')
      from pg_roles r where r.oid in (
        select c.relowner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
        union select p.proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'))
) as environment`;

/** Owners keep their names; whether they bypass RLS is what behaviour depends on. */
export function comparableEnvironment(environment) {
  return {
    server_major: environment.server_major,
    auth_functions: environment.auth_functions,
    api_roles: Object.fromEntries(Object.entries(environment.api_roles ?? {})
      .map(([name, a]) => [name, { bypassrls: a.bypassrls || a.superuser, inherit: a.inherit }])),
    auth_users_columns: environment.auth_users_columns,
    auth_users: Number(environment.auth_users),
    // Name and schema decide what public's objects resolve to; a different
    // packaged version of the same contrib extension does not.
    extensions: Object.fromEntries(Object.entries(environment.extensions ?? {}).map(([name, e]) => [name, e.schema])),
    owners_bypass_rls: environment.owners_bypass_rls,
  };
}

const stable = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

export const digestOf = (value) => createHash('sha256').update(stable(value)).digest('hex');

/** The part of an attestation a capture file carries. No rows, no identifiers. */
export function attestationRecord({ attestation, environment, takenAt, source }) {
  return {
    taken_at: takenAt,
    source,
    dump_role: DUMP_ROLE,
    read_only: attestation.read_only,
    applied_migrations: attestation.applied_migrations,
    schema_fingerprint: attestation.schema_fingerprint,
    column_acls: String(attestation.column_acls),
    export_digest: attestation.export_digest,
    environment_digest: digestOf(comparableEnvironment(environment)),
  };
}

/**
 * Every way `capture` (taken on the copy) differs from the attestation (taken
 * on production). Names categories and tables only - never rows.
 */
export function differences(record, capture, copyEnvironment = null) {
  const out = [];
  if (record.read_only !== 'on') out.push('the source attestation was not taken in a read-only transaction');
  if (capture.read_only !== 'on') out.push('the copy capture was not taken in a read-only transaction');
  if (stable(record.applied_migrations) !== stable(capture.applied_migrations)) out.push('applied_migrations');
  for (const category of new Set([...Object.keys(record.schema_fingerprint ?? {}), ...Object.keys(capture.schema_fingerprint ?? {})])) {
    if (stable(record.schema_fingerprint?.[category]) !== stable(capture.schema_fingerprint?.[category])) out.push(`schema_fingerprint.${category}`);
  }
  for (const table of new Set([...Object.keys(record.export_digest ?? {}), ...Object.keys(capture.export_digest ?? {})])) {
    if (record.export_digest?.[table] !== capture.export_digest?.[table]) out.push(`export_digest.${table}`);
  }
  if (String(record.column_acls) !== String(capture.column_acls)) out.push('column_acls');
  if (copyEnvironment && record.environment_digest !== digestOf(comparableEnvironment(copyEnvironment))) out.push('environment');
  return out;
}
