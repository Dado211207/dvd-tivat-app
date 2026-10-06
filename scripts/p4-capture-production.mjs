/**
 * Run the production equivalence capture in a read-only transaction and keep
 * the result outside this repository. No SQL result or connection string is
 * printed. The source SQL begins with SET TRANSACTION READ ONLY; it must be
 * sent as one simple-query batch, not through psql -f.
 *
 * The transaction is read-only; the credential is not. sourceUrl() accepts only
 * the project's `postgres` user, so DVD_READONLY_DATABASE_URL is a
 * full-privilege URL despite its name. Never store it as a CI or cloud
 * environment secret. See docs/P7_P8_RELEASE_PREP.md (2026-10-04 evening).
 *
 * DVD_READONLY_DATABASE_URL='postgresql://...' \
 *   node scripts/p4-capture-production.mjs /private/path/capture.production-export.json
 */
import { open, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRef = 'yskhdzrdbywrpfowckpn';

/** Read-only, bounded, and in UTC, as the gate's own sessions are (see UTC_SESSION). */
export const CAPTURE_SESSION = "set default_transaction_read_only = on; set statement_timeout = 120000; set timezone = 'UTC'";

export function sourceUrl(connectionString) {
  const url = new URL(connectionString);
  const direct = url.hostname === `db.${projectRef}.supabase.co` && url.username === 'postgres';
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${projectRef}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !(direct || pooler) || !url.password || url.pathname !== '/postgres') {
    throw new Error('Use the direct or session-pooler URL for the expected DVD Tivat project.');
  }
  return url;
}

export async function outputPath(argument) {
  if (!argument || !isAbsolute(argument) || !argument.endsWith('.production-export.json')) {
    throw new Error('Choose an absolute path ending in .production-export.json outside the repository.');
  }
  const directory = await realpath(dirname(argument));
  const distance = relative(repo, directory);
  if (distance === '' || (!distance.startsWith(`..${sep}`) && distance !== '..' && !isAbsolute(distance))) {
    throw new Error('The production-derived capture must be saved outside the repository.');
  }
  return resolve(directory, argument.slice(dirname(argument).length + 1));
}

export function captureResult(result) {
  const last = Array.isArray(result) ? result.at(-1) : result;
  if (last?.rows?.length !== 1) throw new Error('Capture did not return exactly one row.');
  const row = last.rows[0];
  for (const key of ['applied_migrations', 'schema_fingerprint', 'export', 'export_digest', 'behaviour_digest']) {
    if (row[key] === null || row[key] === undefined) throw new Error(`Capture is missing ${key}.`);
  }
  if (row.read_only !== 'on' || !Array.isArray(row.applied_migrations)) {
    throw new Error('The transaction was not read-only or the migration ledger is unavailable.');
  }
  return row;
}

async function main() {
  const target = await outputPath(process.argv[2]);
  const connectionString = process.env.DVD_READONLY_DATABASE_URL;
  if (!connectionString) throw new Error('Set DVD_READONLY_DATABASE_URL in the local environment.');
  sourceUrl(connectionString);

  const sql = await readFile(resolve(repo, 'scripts/p4-equivalence-production.sql'), 'utf8');
  // PostgreSQL executes this multi-statement simple query in one implicit
  // transaction. A read-only session default provides a second safeguard if
  // the SQL file is later edited. Do not split it into individual statements.
  const client = new pg.Client({
    connectionString,
    application_name: 'boka_release_readonly_capture',
  });
  try {
    await client.connect();
    await client.query(CAPTURE_SESSION);
    const row = captureResult(await client.query(sql));
    // wx refuses to overwrite a previous capture or follow an existing
    // symlink. Permissions stay private even with a permissive shell umask.
    const file = await open(target, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(row)}\n`);
    } finally {
      await file.close();
    }
    console.log(`Read-only capture saved outside the repository: ${target}`);
    console.log(`Migration entries: ${row.applied_migrations.length}. Run npm run gate:p4 -- ${target} on isolated PostgreSQL.`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // pg can include the connection string in an error. Keep diagnostics
    // generic here so no credential is copied into a terminal transcript.
    console.error(`Capture failed (${error.code ?? error.name ?? 'ERROR'}). Check the path, read-only database connection and server logs.`);
    process.exitCode = 1;
  });
}
