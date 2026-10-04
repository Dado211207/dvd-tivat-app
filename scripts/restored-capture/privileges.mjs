/**
 * Is a role fit to be the dump credential? scripts/restored-capture/privileges.sql
 * measures what it can do; this decides.
 *
 * A PROBLEM is anything that could change application data, act as another
 * role, or read beyond what the dump needs. Any problem refuses the dump.
 *
 * PLATFORM is what every login role receives from PUBLIC through Supabase's
 * extensions and is harmless: reading pg_stat_statements, which hides other
 * roles' query text from a role without pg_read_all_stats.
 *
 * pg_net's queue is NOT platform. On the hosted projects PUBLIC holds ALL on
 * net.http_request_queue and net._http_response (measured 2026-10-04 on the
 * isolated project, and read-only on production). TRIGGER there lets any login
 * role run its own code as `postgres` when the push cron enqueues; SELECT and
 * UPDATE expose and redirect the push-worker secret. Each is a problem, and
 * scripts/restored-capture/harden-pg-net.sql must be applied before the dump
 * role is created.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRIVILEGES_SQL = readFileSync(resolve(HERE, 'privileges.sql'), 'utf8');

export const PLATFORM_WRITES = new Set();
export const PLATFORM_READS = new Set(['extensions.pg_stat_statements', 'extensions.pg_stat_statements_info']);

/**
 * Built into PostgreSQL for every role: the system catalogs are readable, and
 * pg_settings is an updatable view whose UPDATE is the same as SET - it
 * changes only the caller's own session.
 */
export const BUILT_IN_WRITES = new Set(['pg_catalog.pg_settings:UPDATE']);
export const builtInRead = (item) => item.startsWith('pg_catalog.') || item.startsWith('information_schema.');

/** What the dump reads, and so what the role must be able to read. */
export function expectedRead(item) {
  return item.startsWith('public.') || item === 'auth.users' || item === 'supabase_migrations.schema_migrations';
}

export async function privilegeReport(client, role) {
  const { rows } = await client.query(PRIVILEGES_SQL, [role]);
  return rows[0].report;
}

export function classify(report) {
  const problems = [];
  const platform = [];
  const builtIn = { catalogReads: 0, sessionSettings: false };
  if (!report.exists) return { ok: false, problems: [`role ${report.role} does not exist`], platform, builtIn };
  const a = report.attributes;
  for (const attribute of ['superuser', 'createrole', 'createdb', 'replication']) {
    if (a[attribute]) problems.push(`attribute ${attribute}`);
  }
  if (!a.login) problems.push('cannot log in');
  if (!a.bypassrls) problems.push('does not bypass RLS, so a dump would be refused or incomplete');
  for (const role of report.member_of) problems.push(`member of ${role}`);
  for (const item of [...report.table_writes, ...report.sequence_writes]) {
    if (BUILT_IN_WRITES.has(item)) builtIn.sessionSettings = true;
    else (PLATFORM_WRITES.has(item) ? platform : problems).push(`write ${item}`);
  }
  for (const item of report.column_writes) problems.push(`write ${item}`);
  for (const schema of report.create_in_schemas) problems.push(`CREATE in schema ${schema}`);
  if (report.database.create) problems.push('CREATE on the database');
  for (const fn of report.security_definer_functions) problems.push(`executes security definer ${fn}`);
  for (const item of report.readable) {
    if (expectedRead(item)) continue;
    if (builtInRead(item)) {
      builtIn.catalogReads += 1;
      continue;
    }
    (PLATFORM_READS.has(item) ? platform : problems).push(`read ${item}`);
  }
  for (const needed of ['auth.users', 'supabase_migrations.schema_migrations']) {
    if (!report.readable.includes(needed)) problems.push(`cannot read ${needed}`);
  }
  return { ok: problems.length === 0, problems, platform, builtIn };
}
