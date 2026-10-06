/**
 * What release-preflight.sh's local restore may load, and proof of what it did.
 *
 * The encrypted archive keeps the complete dump. The separate local restore
 * target, a Supabase Postgres whose pg_cron and pg_net would run anything they
 * are given, never receives operational platform data: pg_cron's jobs carry the
 * push worker's endpoint and credentials, pg_net's queue holds requests that
 * would be sent, and supabase_functions logs database webhooks, which send
 * through pg_net. (pg_dump leaves extension-owned tables out of the data
 * dump anyway; this is the check that keeps it that way.)
 *
 *   node scripts/restore-accounting.mjs split <data.sql> <restore.sql> <accounting.json>
 *       Copy the data dump without any cron/net data, and record every table's
 *       row count and whether it is restored. Refuses any statement it does not
 *       understand that touches those schemas.
 *   node scripts/restore-accounting.mjs roles <roles.sql> <restore.sql> <accounting.json>
 *       Copy the roles dump without the parameter grants Supabase's own image
 *       makes to its platform roles (`GRANT SET ON PARAMETER ... TO
 *       "supabase_..."`), which the target's postgres may not repeat - only
 *       after checking, on DVD_RESTORE_TARGET_URL, that the target already holds
 *       each one exactly. They are recorded in the accounting.
 *   node scripts/restore-accounting.mjs count <file.sql>
 *       Print `schema.table=rows` for every COPY block in the file.
 *   node scripts/restore-accounting.mjs verify <accounting.json>
 *       Against DVD_RESTORE_TARGET_URL (loopback only): every restored table has
 *       exactly the dumped row count, and the target holds no pg_cron job and no
 *       pg_net request. Any difference fails; nothing is waived.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const OPERATIONAL_SCHEMAS = ['cron', 'net', 'supabase_functions'];
/** The operational tables that must be empty on the restore target. */
export const OPERATIONAL_TABLES = ['cron.job', 'cron.job_run_details', 'net.http_request_queue', 'net._http_response', 'supabase_functions.hooks'];

const IDENT = String.raw`(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*))`;
const COPY_START = new RegExp(String.raw`^COPY ${IDENT}\.${IDENT}(?: \(.*\))? FROM stdin;$`);
const SETVAL = new RegExp(String.raw`^SELECT pg_catalog\.setval\('${IDENT}\.${IDENT}'`);
const unquote = (q, bare) => (q !== undefined ? q.replace(/""/g, '"') : bare);
const mentionsOperational = (line) => new RegExp(String.raw`(^|[^a-z0-9_$"])"?(${OPERATIONAL_SCHEMAS.join('|')})"?\.`).test(line);

/** Split a plain `--use-copy --data-only` dump into what the local restore may load. */
export function splitOperational(sql) {
  const lines = sql.split('\n');
  const out = [];
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const copy = line.match(COPY_START);
    if (copy) {
      const schema = unquote(copy[1], copy[2]);
      const table = `${schema}.${unquote(copy[3], copy[4])}`;
      const end = lines.indexOf('\\.', i + 1);
      if (end < 0) throw new Error(`unterminated COPY block for ${table}`);
      const restored = !OPERATIONAL_SCHEMAS.includes(schema);
      tables.push({ table, rows: end - i - 1, restored });
      if (restored) out.push(...lines.slice(i, end + 1));
      i = end;
      continue;
    }
    const setval = line.match(SETVAL);
    if (setval && OPERATIONAL_SCHEMAS.includes(unquote(setval[1], setval[2]))) continue;
    if (!setval && !line.startsWith('--') && mentionsOperational(line)) {
      throw new Error(`unhandled statement on an operational schema: ${line.slice(0, 80)}`);
    }
    out.push(line);
  }
  return { restore: out.join('\n'), tables };
}

const PLATFORM_PARAMETER_GRANT = /^GRANT SET ON PARAMETER "([a-z_.]+)" TO "(supabase_[a-z_]+)";$/;

/** The roles dump without the platform's own parameter grants, which are listed. */
export function splitRoles(sql) {
  const platformGrants = [];
  const restore = sql.split('\n').filter((line) => {
    const grant = line.match(PLATFORM_PARAMETER_GRANT);
    if (grant) platformGrants.push({ parameter: grant[1], role: grant[2] });
    return !grant;
  }).join('\n');
  return { restore, platformGrants };
}

/** Every skipped platform grant must already be in force on the restore target. */
export async function verifyPlatformGrants(client, platformGrants) {
  const problems = [];
  for (const { parameter, role } of platformGrants) {
    const { rows: [{ held }] } = await client.query(
      `select exists (select 1 from pg_roles where rolname = $1) and has_parameter_privilege($1, $2, 'SET') as held`, [role, parameter]);
    if (!held) problems.push(`${role} lacks SET on ${parameter} on the restore target; the roles dump grants it`);
  }
  return problems;
}

const quoteTable = (table) => table.split('.').map((part) => `"${part.replace(/"/g, '""')}"`).join('.');

/** Compare the restore target against the accounting; returns a list of problems. */
export async function verifyTarget(client, accounting) {
  const problems = [];
  for (const { table, rows, restored } of accounting.tables) {
    if (!restored) continue;
    const { rows: [{ n }] } = await client.query(`select count(*)::int as n from ${quoteTable(table)}`);
    if (n !== rows) problems.push(`${table}: dump has ${rows} rows, restore target has ${n}`);
  }
  for (const table of OPERATIONAL_TABLES) {
    const { rows: [{ present }] } = await client.query('select to_regclass($1) is not null as present', [table]);
    if (!present) continue;
    const { rows: [{ n }] } = await client.query(`select count(*)::int as n from ${quoteTable(table)}`);
    if (n !== 0) problems.push(`${table}: restore target holds ${n} operational rows; it must hold none`);
  }
  return problems;
}

function targetUrl() {
  const url = new URL(process.env.DVD_RESTORE_TARGET_URL ?? 'invalid:');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('DVD_RESTORE_TARGET_URL must be a loopback restore target.');
  return url;
}

async function targetClient() {
  const client = new pg.Client({ connectionString: targetUrl().toString() });
  await client.connect();
  return client;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'split') {
    const [input, output, accountingPath] = args;
    const { restore, tables } = splitOperational(readFileSync(input, 'utf8'));
    writeFileSync(output, restore, { mode: 0o600, flag: 'wx' });
    writeFileSync(accountingPath, `${JSON.stringify({ tables }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const kept = tables.filter((t) => !t.restored);
    console.log(`${tables.length - kept.length} tables for the local restore; operational data kept for the archive only: ${kept.map((t) => `${t.table}=${t.rows}`).join(' ') || 'none in the data dump'}`);
  } else if (command === 'roles') {
    targetUrl();
    const [input, output, accountingPath] = args;
    const { restore, platformGrants } = splitRoles(readFileSync(input, 'utf8'));
    const client = await targetClient();
    try {
      const problems = await verifyPlatformGrants(client, platformGrants);
      for (const p of problems) console.log(`  MISSING  ${p}`);
      if (problems.length) throw new Error('the restore target lacks platform grants the roles dump expects');
    } finally {
      await client.end();
    }
    writeFileSync(output, restore, { mode: 0o600, flag: 'wx' });
    const accounting = JSON.parse(readFileSync(accountingPath, 'utf8'));
    writeFileSync(accountingPath, `${JSON.stringify({ ...accounting, platformGrants }, null, 2)}\n`, { mode: 0o600 });
    console.log(`Roles for the local restore; platform grants already held by the target, not repeated: ${platformGrants.map((g) => `${g.role}:${g.parameter}`).join(' ') || 'none'}`);
  } else if (command === 'count') {
    console.log(splitOperational(readFileSync(args[0], 'utf8')).tables.map((t) => `${t.table}=${t.rows}`).join(' '));
  } else if (command === 'verify') {
    targetUrl();
    const accounting = JSON.parse(readFileSync(args[0], 'utf8'));
    const client = await targetClient();
    try {
      const problems = await verifyTarget(client, accounting);
      for (const p of problems) console.log(`  DIFFERS  ${p}`);
      if (problems.length) throw new Error(`the restore target does not match the dump (${problems.length} difference(s))`);
      const restored = accounting.tables.filter((t) => t.restored);
      console.log(`Restore accounting: ${restored.length} tables, ${restored.reduce((s, t) => s + t.rows, 0)} rows, all counts match; no pg_cron job or pg_net request on the target.`);
    } finally {
      await client.end();
    }
  } else {
    throw new Error('Usage: restore-accounting.mjs split <data.sql> <restore.sql> <accounting.json> | roles <roles.sql> <restore.sql> <accounting.json> | count <file.sql> | verify <accounting.json>');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message.replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exitCode = 1;
  });
}
