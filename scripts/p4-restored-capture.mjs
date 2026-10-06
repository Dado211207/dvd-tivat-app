/**
 * The P4 production capture, taken on a RESTORED COPY of production.
 *
 * Why: the capture impersonates every account, and no credential that can do
 * that on a live database is read-only (db-tests/capture_role_privileges.test.ts).
 * So production is only DUMPED, by the dump-only role in
 * scripts/restored-capture/dump-role.sql, and the capture runs on a separate,
 * disposable PostgreSQL where impersonation can harm nothing.
 *
 *   node scripts/p4-restored-capture.mjs verify-role
 *       Print the dump credential's effective privileges and the verdict. Reads
 *       the catalog only.
 *
 *   node scripts/p4-restored-capture.mjs run --work <dir> --out <file> [--keep-restore] [--keep-dump]
 *       1  verify the credential (refuses on any problem)
 *       2  in ONE read-only repeatable-read snapshot on the source: the source
 *          attestation (scripts/restored-capture/fidelity.mjs), the auth.users
 *          columns and migration ledger, and pg_dump of `public`
 *       3  restore into a new database on a separate loopback PostgreSQL
 *       4  run scripts/p4-equivalence-production.sql on the copy and require it
 *          to reproduce the attestation exactly; only then write the capture
 *       5  delete the whole work directory (the dump and every intermediate
 *          file) and drop the copy
 *
 *   node scripts/p4-restored-capture.mjs verifier
 *       Print a new random password and its SCRAM-SHA-256 verifier for
 *       dump-role.sql. The password goes only into the environment secret.
 *
 * Environment:
 *   DVD_DUMP_DATABASE_URL  the source, as dvd_release_dump (never `postgres`)
 *   DVD_RESTORE_ADMIN_URL  a loopback PostgreSQL superuser on a server other
 *                          than the source, where the copy is built
 *   PG_DUMP, PSQL          optional client paths; pg_dump must be at least the
 *                          source's major version
 *
 * Nothing it writes is inside the repository: --work and --out must be outside
 * it. No row, password or connection string is printed. The dump holds real
 * rows (including push subscription keys) and is deleted at the end unless
 * --keep-dump; the capture holds only pseudonymised tokens and digests.
 */

import { spawn } from 'node:child_process';
import { createHash, pbkdf2Sync, randomBytes, createHmac } from 'node:crypto';
import { chmod, mkdir, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DUMP_ROLE, ENVIRONMENT_SQL, attestationRecord, attestationSql, differences } from './restored-capture/fidelity.mjs';
import { classify, privilegeReport } from './restored-capture/privileges.mjs';
import { UTC_SESSION } from './p4-gate/database.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class Refused extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

/** The FireNexa production project: the only hosted source a dump may come from. */
export const PRODUCTION_PROJECT_REF = 'yskhdzrdbywrpfowckpn';

/**
 * The source: the production Supabase project reached as the dump role, or a
 * loopback stand-in for one. Refuses the owner's `postgres` login outright, and
 * any other hosted project.
 */
export function dumpSourceUrl(raw) {
  if (!raw) throw new Refused('Set DVD_DUMP_DATABASE_URL to the dump role\'s connection URL.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Refused('DVD_DUMP_DATABASE_URL is not a URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Refused('DVD_DUMP_DATABASE_URL must be a PostgreSQL URL.');
  const user = decodeURIComponent(url.username);
  const host = url.hostname;
  const direct = host.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  const pooler = host.endsWith('.pooler.supabase.com') ? user.match(/^[a-z_]+\.([a-z0-9]{20})$/) : null;
  const projectRef = direct?.[1] ?? pooler?.[1] ?? null;
  const baseUser = pooler ? user.slice(0, user.lastIndexOf('.')) : user;
  if (baseUser !== DUMP_ROLE) {
    throw new Refused(`The dump must connect as ${DUMP_ROLE}, not "${baseUser}". The owner's login can write; this workflow exists so it is never needed.`);
  }
  if (!url.password) throw new Refused('DVD_DUMP_DATABASE_URL has no password.');
  if (!projectRef && !LOOPBACK.has(host)) throw new Refused('The source must be a Supabase project host or a loopback stand-in.');
  if (projectRef && projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Refused(`The source must be the FireNexa production project (${PRODUCTION_PROJECT_REF}), not ${projectRef}.`);
  }
  return { url, projectRef, loopback: LOOPBACK.has(host) };
}

/** The restore target: loopback only, and not the server the dump came from. */
export function restoreAdminUrl(raw, source) {
  if (!raw) throw new Refused('Set DVD_RESTORE_ADMIN_URL to a loopback PostgreSQL superuser URL.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new Refused('The restore target must be a loopback PostgreSQL server; the copy is never built on a hosted project.');
  }
  const port = (u) => u.port || '5432';
  if (source.loopback && port(url) === port(source.url)) {
    throw new Refused('The restore target must be a separate server from the source.');
  }
  return url;
}

/** A directory or file path outside the repository, resolved through symlinks. */
export async function outsideRepository(path, what) {
  if (!path || !isAbsolute(path)) throw new Refused(`${what} must be an absolute path outside the repository.`);
  const real = await realpath(dirname(path)).catch(() => null);
  if (!real) throw new Refused(`${what}: ${dirname(path)} does not exist.`);
  const distance = relative(REPO, resolve(real, path.slice(dirname(path).length + 1)));
  if (distance === '' || (!distance.startsWith(`..${sep}`) && distance !== '..' && !isAbsolute(distance))) {
    throw new Refused(`${what} must be outside the repository.`);
  }
  return resolve(real, path.slice(dirname(path).length + 1));
}

/** libpq environment for a URL, so no password ever appears in a process argument. */
function libpqEnv(url, database = null) {
  const ssl = url.searchParams.get('sslmode') ?? (LOOPBACK.has(url.hostname) ? 'disable' : 'require');
  return {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database ?? (decodeURIComponent(url.pathname.slice(1)) || 'postgres'),
    PGSSLMODE: ssl,
    PGAPPNAME: 'dvd_p4_restored_capture',
  };
}

function run(command, args, env, label) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (error) => fail(new Refused(`${label}: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? done(out)
      : fail(new Refused(`${label} failed (exit ${code}): ${err.split('\n').filter(Boolean).slice(-5).join(' | ')}`))));
  });
}

async function writePrivate(path, text) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(text);
  } finally {
    await file.close();
  }
}

/**
 * Remove the work directory the run created. The run owns it exclusively
 * (`mkdir` refuses a pre-existing path), so removing the whole tree — rather
 * than a hand-maintained list of filenames — guarantees the plaintext dump and
 * every attestation, environment and ledger file written beside it are gone,
 * even as new intermediate files are added later.
 */
export async function removeWork(work) {
  await rm(work, { recursive: true, force: true });
}

export async function connect(url, database = null) {
  const target = new URL(url);
  if (database) target.pathname = `/${database}`;
  const ssl = target.searchParams.get('sslmode') ?? (LOOPBACK.has(target.hostname) ? 'disable' : 'require');
  target.searchParams.delete('sslmode');
  const client = new pg.Client({
    connectionString: target.toString(),
    ssl: ssl === 'disable' ? false : { rejectUnauthorized: ssl === 'verify-full' },
    application_name: 'dvd_p4_restored_capture',
  });
  client.on('error', () => {});
  await client.connect();
  await client.query(UTC_SESSION);
  return client;
}

// ---------------------------------------------------------------------------
// 1. the credential
// ---------------------------------------------------------------------------

export async function verifyCredential(client) {
  const { rows } = await client.query('select current_user as me');
  if (rows[0].me !== DUMP_ROLE) throw new Refused(`Connected as ${rows[0].me}, not ${DUMP_ROLE}.`);
  const report = await privilegeReport(client, DUMP_ROLE);
  const verdict = classify(report);
  console.log(`  credential ${DUMP_ROLE}: ${verdict.ok ? 'no application write path' : `${verdict.problems.length} PROBLEM(S)`}`);
  for (const problem of verdict.problems) console.log(`    PROBLEM  ${problem}`);
  for (const item of verdict.platform) console.log(`    platform ${item} (PUBLIC; other roles' query text hidden)`);
  if (report.database.temporary) console.log('    built-in TEMPORARY on the database (PUBLIC; session-local tables only)');
  console.log(`    built-in ${verdict.builtIn.catalogReads} system catalog views readable, as for every role`
    + `${verdict.builtIn.sessionSettings ? '; pg_settings UPDATE (= SET, own session only)' : ''}`);
  if (verdict.problems.some((p) => p.includes(' net.'))) {
    console.log('    -> PUBLIC still holds pg_net queue privileges: apply scripts/restored-capture/harden-pg-net.sql first.');
  }
  if (!verdict.ok) throw new Refused('The dump credential can do more than read. Fix the project or the role (see release prep) before dumping.');
  return { report, verdict };
}

// ---------------------------------------------------------------------------
// 2. dump, in one snapshot
// ---------------------------------------------------------------------------

/** The dump role's own grants are not part of production; the copy must not receive them. */
export function withoutDumpRoleGrants(sql, role = DUMP_ROLE) {
  const mention = new RegExp(`(^|[^a-z0-9_])"?${role}"?([^a-z0-9_]|$)`, 'm');
  const kept = sql.split('\n').filter((line) => !(/^(GRANT|REVOKE) /.test(line) && mention.test(line)));
  const text = kept.join('\n');
  if (mention.test(text)) throw new Refused(`The dump still mentions ${role} outside a GRANT/REVOKE line.`);
  return { text, removed: sql.split('\n').length - kept.length };
}

async function dumpSource(source, work) {
  const client = await connect(source.url);
  try {
    console.log('=== 1. the dump credential ===');
    await verifyCredential(client);

    console.log('\n=== 2. one snapshot of the source ===');
    await client.query('begin isolation level repeatable read read only');
    const { rows: [snap] } = await client.query(
      `select pg_export_snapshot() as id, now() as at, current_setting('server_version_num')::int / 10000 as major`);
    const captureSql = await readFile(resolve(REPO, 'scripts/p4-equivalence-production.sql'), 'utf8');
    const result = await client.query(attestationSql(captureSql));
    const attestation = (Array.isArray(result) ? result.at(-1) : result).rows[0];
    const { rows: [{ environment }] } = await client.query(ENVIRONMENT_SQL);
    // Timestamps as text: a JS Date keeps only milliseconds, but PostgreSQL
    // timestamptz carries microseconds, and losing them would change the
    // restored rows and so the export digest. Text round-trips exactly.
    const { rows: users } = await client.query(
      'select id::text as id, email_confirmed_at::text as email_confirmed_at, created_at::text as created_at from auth.users order by id');
    const { rows: ledger } = await client.query('select version, name from supabase_migrations.schema_migrations order by version');

    const pgDump = process.env.PG_DUMP ?? 'pg_dump';
    const version = await run(pgDump, ['--version'], {}, 'pg_dump --version');
    const clientMajor = Number(version.match(/(\d+)(?:\.\d+)?/)?.[1]);
    if (!(clientMajor >= snap.major)) throw new Refused(`pg_dump ${clientMajor} is older than the source's PostgreSQL ${snap.major}.`);
    const raw = await run(pgDump, ['--schema=public', `--snapshot=${snap.id}`, '--format=plain', '--no-comments'],
      libpqEnv(source.url), 'pg_dump of public');
    await client.query('commit');

    const { text, removed } = withoutDumpRoleGrants(raw);
    await writePrivate(resolve(work, 'public.sql'), text);
    await writePrivate(resolve(work, 'auth_users.json'), JSON.stringify(users));
    await writePrivate(resolve(work, 'migrations.json'), JSON.stringify(ledger));
    await writePrivate(resolve(work, 'environment.json'), JSON.stringify(environment));
    const record = attestationRecord({
      attestation, environment, takenAt: snap.at,
      source: source.projectRef ? `supabase:${source.projectRef}` : 'loopback stand-in',
    });
    await writePrivate(resolve(work, 'attestation.json'), JSON.stringify(record));
    console.log(`  snapshot at ${new Date(snap.at).toISOString()}, PostgreSQL ${snap.major}, pg_dump ${clientMajor}`);
    console.log(`  attested ${Object.keys(record.schema_fingerprint).length} schema categories, ${Object.keys(record.export_digest).length} tables, `
      + `${record.applied_migrations.length} ledger entries; dumped public (${removed} dump-role grant lines left out), `
      + `${users.length} auth.users rows (3 columns), ${ledger.length} ledger rows`);
    return { record, environment };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// 3. restore on a separate server
// ---------------------------------------------------------------------------

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Roles the dump names as owner, grantor or grantee. */
export function rolesNamedIn(sql) {
  const names = new Set();
  for (const m of sql.matchAll(/OWNER TO ("(?:[^"]|"")+"|[a-z_][a-z0-9_$]*);/g)) names.add(m[1].replace(/^"|"$/g, '').replace(/""/g, '"'));
  for (const m of sql.matchAll(/^(?:GRANT|REVOKE) .* (?:TO|FROM) ([^;]+);$/gm)) {
    for (const part of m[1].replace(/ GRANTED BY .*$/, '').replace(/ WITH GRANT OPTION$/, '').split(',')) {
      const name = part.trim().replace(/^GROUP /, '').replace(/^"|"$/g, '').replace(/""/g, '"');
      if (name && name !== 'PUBLIC') names.add(name);
    }
  }
  for (const m of sql.matchAll(/ GRANTED BY ("(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)/g)) names.add(m[1].replace(/^"|"$/g, ''));
  return [...names].sort();
}

async function restoreCopy(adminUrl, work, environment, database) {
  console.log('\n=== 3. restore on a separate server ===');
  const sql = await readFile(resolve(work, 'public.sql'), 'utf8');
  const users = JSON.parse(await readFile(resolve(work, 'auth_users.json'), 'utf8'));
  const ledger = JSON.parse(await readFile(resolve(work, 'migrations.json'), 'utf8'));
  const admin = await connect(adminUrl);
  try {
    const { rows: [{ major }] } = await admin.query(`select current_setting('server_version_num')::int / 10000 as major`);
    if (major !== environment.server_major) throw new Refused(`The restore target runs PostgreSQL ${major}; the source runs ${environment.server_major}.`);
    for (const [name, a] of Object.entries(environment.api_roles)) {
      const exists = (await admin.query('select 1 from pg_roles where rolname = $1', [name])).rowCount;
      const attrs = `nologin ${a.bypassrls || a.superuser ? 'bypassrls' : 'nobypassrls'} ${a.inherit ? 'inherit' : 'noinherit'}`;
      await admin.query(exists ? `alter role ${ident(name)} ${attrs}` : `create role ${ident(name)} ${attrs}`);
    }
    for (const name of rolesNamedIn(sql)) {
      if (!(await admin.query('select 1 from pg_roles where rolname = $1', [name])).rowCount) {
        const bypass = environment.owners_bypass_rls?.[name] ? 'bypassrls' : '';
        await admin.query(`create role ${ident(name)} nologin ${bypass}`);
      }
    }
    await admin.query(`create database ${ident(database)}`);
  } finally {
    await admin.end();
  }

  const copy = await connect(adminUrl, database);
  try {
    await copy.query('begin');
    await copy.query('create schema auth; create schema supabase_migrations');
    await copy.query('grant usage on schema auth to anon, authenticated, service_role');
    const columns = environment.auth_users_columns
      .map(([name, type, notNull]) => `${ident(name)} ${type}${notNull ? ' not null' : ''}`).join(', ');
    await copy.query(`create table auth.users (${columns}, primary key (id))`);
    await copy.query(`insert into auth.users (id, email_confirmed_at, created_at)
      select id, email_confirmed_at, created_at from jsonb_to_recordset($1::jsonb)
        as x(id uuid, email_confirmed_at timestamptz, created_at timestamptz)`, [JSON.stringify(users)]);
    for (const definition of Object.values(environment.auth_functions)) await copy.query(definition);
    await copy.query('create table supabase_migrations.schema_migrations (version text primary key, name text)');
    await copy.query(`insert into supabase_migrations.schema_migrations select version, name
      from jsonb_to_recordset($1::jsonb) as x(version text, name text)`, [JSON.stringify(ledger)]);
    for (const [name, e] of Object.entries(environment.extensions ?? {})) {
      await copy.query(`create schema if not exists ${ident(e.schema)}`);
      await copy.query(`create extension if not exists ${ident(name)} with schema ${ident(e.schema)}`);
    }
    await copy.query('commit');
  } finally {
    await copy.end();
  }

  // A new database already has an empty `public`, which the extensions above
  // were created in; the dump's own CREATE SCHEMA for it is left out.
  const restorable = resolve(work, 'public.restore.sql');
  await writePrivate(restorable, sql.replace(/^CREATE SCHEMA public;$/m, '-- CREATE SCHEMA public; (the new database has it)'));
  // Triggers stay off while rows load, as in a pg_dump restore: an audit
  // trigger firing here would add rows production does not have.
  await run(process.env.PSQL ?? 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', restorable],
    { ...libpqEnv(adminUrl, database), PGOPTIONS: '-c session_replication_role=replica' }, 'restore of public');
  console.log(`  restored into ${database}: public, ${users.length} auth.users rows, ${ledger.length} ledger rows, `
    + `${Object.keys(environment.auth_functions).length} auth functions, ${Object.keys(environment.api_roles).length} API roles, `
    + `extensions ${Object.keys(environment.extensions ?? {}).join(', ') || 'none'}`);
}

// ---------------------------------------------------------------------------
// 4. capture on the copy, and prove it is the source
// ---------------------------------------------------------------------------

export async function captureCopy(adminUrl, database, record) {
  console.log('\n=== 4. capture on the copy, against the source attestation ===');
  const captureSql = await readFile(resolve(REPO, 'scripts/p4-equivalence-production.sql'), 'utf8');
  const copy = await connect(adminUrl, database);
  try {
    const result = await copy.query(captureSql);
    const capture = (Array.isArray(result) ? result.at(-1) : result).rows[0];
    const { rows: [{ environment }] } = await copy.query(ENVIRONMENT_SQL);
    const diff = differences(record, capture, environment);
    if (diff.length) {
      for (const d of diff) console.log(`  DIFFERS  ${d}`);
      throw new Refused(`The restored copy does not reproduce the source snapshot (${diff.length} difference(s)); no capture was written.`);
    }
    console.log(`  identical: ${Object.keys(record.schema_fingerprint).length} schema categories, `
      + `${Object.keys(record.export_digest).length} tables, ${record.applied_migrations.length} ledger entries, environment`);
    console.log(`  ${Object.keys(capture.behaviour_digest ?? {}).length} accounts measured on the copy`);
    return { ...capture, capture_source: 'restored-copy', source_attestation: record };
  } finally {
    await copy.end();
  }
}

// ---------------------------------------------------------------------------

/** RFC 5802 / PostgreSQL SCRAM-SHA-256 verifier for a password. */
export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

  if (command === 'verifier') {
    const password = randomBytes(24).toString('base64url');
    console.log('Paste into dump-role.sql in place of __SCRAM_VERIFIER__:');
    console.log(`  ${scramVerifier(password)}`);
    console.log('Store ONLY in the environment secret DVD_DUMP_DATABASE_URL (shown once):');
    console.log(`  ${password}`);
    return;
  }

  const source = dumpSourceUrl(process.env.DVD_DUMP_DATABASE_URL);
  if (command === 'verify-role') {
    const client = await connect(source.url);
    try {
      await verifyCredential(client);
    } finally {
      await client.end();
    }
    return;
  }
  if (command !== 'run') throw new Refused('Usage: p4-restored-capture.mjs verify-role | run --work <dir> --out <file> | verifier');

  const adminUrl = restoreAdminUrl(process.env.DVD_RESTORE_ADMIN_URL, source);
  const work = await outsideRepository(option('--work'), '--work');
  const out = await outsideRepository(option('--out'), '--out');
  if (!out.endsWith('.production-export.json')) throw new Refused('--out must end in .production-export.json.');
  if (await stat(out).catch(() => null)) throw new Refused('--out already exists; a capture is never overwritten.');
  await mkdir(work, { mode: 0o700 });
  await chmod(work, 0o700);
  const database = `p4_restored_${Date.now()}_${randomBytes(3).toString('hex')}`;
  let restored = false;
  try {
    const { record, environment } = await dumpSource(source, work);
    restored = true;
    await restoreCopy(adminUrl, work, environment, database);
    const capture = await captureCopy(adminUrl, database, record);
    await writePrivate(out, `${JSON.stringify(capture)}\n`);
    console.log(`\nCapture saved outside the repository: ${out}`);
    console.log(`Next: DVD_TEST_DATABASE_URL=<loopback> npm run gate:p4 -- ${out}`);
  } finally {
    // The run created `work` and owns the whole directory, so remove all of it
    // rather than a hand-listed subset: the dump (public.sql) and the real auth
    // rows (auth_users.json) hold production data, and the attestation,
    // environment and migration files written beside them must not linger
    // either. --keep-dump keeps the directory for review.
    if (!args.includes('--keep-dump')) {
      await removeWork(work);
    }
    if (restored && !args.includes('--keep-restore')) {
      const admin = await connect(adminUrl).catch(() => null);
      await admin?.query(`drop database if exists ${ident(database)} with (force)`).catch(() => {});
      await admin?.end();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // pg errors can carry a connection string; print only our own messages.
    console.error(error instanceof Refused ? `Refused: ${error.message}` : `Failed (${error.code ?? error.name}). ${error.message?.replace(/postgres(ql)?:\/\/\S+/g, '<url>')}`);
    process.exitCode = error.exitCode ?? 1;
  });
}
