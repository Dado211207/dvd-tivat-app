#!/usr/bin/env node
/**
 * Finds migrations that exist on one side and not the other.
 *
 * Twice now the hosted project has carried a migration this repository never
 * had - `restore_exact_repository_function_text` on 12 September and
 * `..._audit_triggers` on 23 September - and both were found by hand, eleven
 * days apart, by somebody who happened to be looking. Nothing in the repository
 * would have said a word. This is that missing thing.
 *
 * ---------------------------------------------------------------------------
 * Two halves, because only one of them can run in CI
 * ---------------------------------------------------------------------------
 *
 * CI has no credentials for the hosted project and deliberately does not get
 * any - see the comment on the database step in `.github/workflows/ci.yml`. So:
 *
 *   --repo-only   every check that needs nothing but this checkout. Runs on
 *                 every pull request.
 *   --production  the comparison against the hosted project. Needs either a
 *                 connection string or a snapshot captured from it, so it is
 *                 run deliberately by somebody who has one.
 *
 * Splitting it this way is not a compromise on the useful half - it is the only
 * shape that does not require putting a production credential into CI.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *
 *   node scripts/check-migration-drift.mjs --repo-only
 *   node scripts/check-migration-drift.mjs --production postgresql://...
 *   node scripts/check-migration-drift.mjs --production snapshot.json
 *   node scripts/check-migration-drift.mjs --print-sql > capture.sql
 *
 * The last form exists for whoever can reach the project only through a SQL
 * console or an agent tool rather than a connection string: run the printed
 * queries, save the three result sets into one JSON file shaped like
 * `{ "migrations": [...], "functions": [...], "objects": {...} }`, and pass it.
 *
 * The schema half of `--production` also needs a local PostgreSQL with the
 * migrations replayed onto it - the same one `npm run test:db` uses, via
 * `DVD_TEST_DATABASE_URL`. Without it that half is skipped and said to be
 * skipped, rather than quietly passing.
 *
 *   exit 0   nothing found
 *   exit 1   drift found, listed
 *   exit 2   the comparison could not be RUN, so nothing about drift is known
 *
 * The last one is separate on purpose. A database that could not be reached
 * reported as "no drift found" would be the worst thing this script could do.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
const HARNESS = 'db-tests/harness.ts';

/**
 * Functions the hosted platform owns, which no migration here creates.
 *
 * `rls_auto_enable` is Supabase's own event-trigger function. It is absent from
 * plain PostgreSQL, which is why `202609150011` revokes its grant inside an
 * `if exists` guard. Finding it on the hosted project and not locally is the
 * expected result, not drift.
 */
const PLATFORM_OWNED_FUNCTIONS = new Set(['rls_auto_enable']);

/** `202609130006a_attendance_truth.sql` -> `attendance_truth`. */
function migrationName(file) {
  const match = /^\d+[a-z]?_(.+)\.sql$/.exec(file);
  if (!match) return null;
  return match[1];
}

function repositoryMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  return files.map((file) => ({ file, name: migrationName(file) }));
}

function harnessMigrations() {
  const source = readFileSync(HARNESS, 'utf8');
  const start = source.indexOf('export const MIGRATIONS = [');
  if (start === -1) throw new Error(`no MIGRATIONS array in ${HARNESS}`);
  const list = source.slice(start, source.indexOf('];', start));
  return [...list.matchAll(/'([^']+\.sql)'/g)].map((match) => match[1]);
}

const problems = [];
const notes = [];
function fail(message) {
  problems.push(message);
}

// ---------------------------------------------------------------------------
// Half one: this checkout only
// ---------------------------------------------------------------------------

function checkRepository() {
  const migrations = repositoryMigrations();
  const harness = harnessMigrations();

  for (const { file, name } of migrations) {
    if (name === null) {
      fail(`${file}: filename is not <digits>[letter]_<name>.sql, so it has no comparable name`);
    }
  }

  const byName = new Map();
  for (const { file, name } of migrations) {
    if (name === null) continue;
    if (byName.has(name)) {
      // Two files deriving one name cannot both be matched to one applied
      // entry, so this breaks the production comparison rather than merely
      // looking untidy.
      fail(`two migration files share the name "${name}": ${byName.get(name)} and ${file}`);
    }
    byName.set(name, file);
  }

  // The harness list is hand-maintained, so a new migration can be committed
  // and never run by a single test. That is the quiet version of this problem.
  const harnessFiles = harness.filter((entry) => entry.startsWith(`${MIGRATIONS_DIR}/`));
  const harnessSet = new Set(harnessFiles.map((entry) => entry.slice(MIGRATIONS_DIR.length + 1)));

  for (const { file } of migrations) {
    if (!harnessSet.has(file)) {
      fail(`${file} is not in ${HARNESS}, so no test ever applies it`);
    }
  }
  for (const file of harnessSet) {
    if (!migrations.some((migration) => migration.file === file)) {
      fail(`${HARNESS} lists ${file}, which does not exist`);
    }
  }

  // Order matters and is not decorative: `202609130006a` applied after
  // `202609230019` puts a renamed-away table back into three function bodies.
  const expected = migrations.map((migration) => migration.file);
  const actual = harnessFiles.map((entry) => entry.slice(MIGRATIONS_DIR.length + 1));
  for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
    if (expected[index] !== actual[index]) {
      fail(
        `${HARNESS} applies migrations in a different order than their filenames sort: ` +
          `position ${index + 1} is ${actual[index]}, filename order says ${expected[index]}`,
      );
      break;
    }
  }

  console.log(`repository: ${migrations.length} migration files, ${harnessSet.size} applied by the harness`);
  return migrations;
}

// ---------------------------------------------------------------------------
// Half two: against the hosted project
// ---------------------------------------------------------------------------

const CAPTURE_SQL = `
-- 1. migrations: every entry the hosted project has applied.
select version, name,
       case when statements is null then null
            else md5(array_to_string(statements, E'\\n')) end as statements_md5
  from supabase_migrations.schema_migrations
 order by version;

-- 2. functions: everything in \`public\` that no extension owns, fingerprinted
--    on the attributes that matter - including the execute grants, because a
--    privilege that drifts is worth more than a body that does.
select p.proname,
       md5(pg_get_function_identity_arguments(p.oid) || '|' || p.prokind::text || '|'
           || p.prosecdef::text || '|' || p.provolatile::text || '|'
           || coalesce(array_to_string(p.proconfig, ','), '') || '|'
           || pg_get_function_result(p.oid) || '|' || md5(p.prosrc) || '|'
           || coalesce(array_to_string(p.proacl, ' '), '(default)') || '|'
           || l.lanname) as fingerprint,
       length(p.prosrc) as body_length
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language  l on l.oid = p.prolang
 where n.nspname = 'public'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
 order by p.proname;

-- 3. objects: everything that is not a function.
with c as (select count(*) n, md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, E'\\n' order by table_name, column_name)) h
             from information_schema.columns where table_schema='public'),
     p as (select count(*) n, md5(string_agg(tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||cmd||':'||array_to_string(roles,','), E'\\n' order by tablename, policyname)) h
             from pg_policies where schemaname='public'),
     i as (select count(*) n, md5(string_agg(indexname||':'||indexdef, E'\\n' order by indexname)) h
             from pg_indexes where schemaname='public'),
     g as (select count(*) n, md5(string_agg(cl.relname||'.'||tg.tgname, E'\\n' order by cl.relname, tg.tgname)) h
             from pg_trigger tg join pg_class cl on cl.oid=tg.tgrelid join pg_namespace ns on ns.oid=cl.relnamespace
            where ns.nspname='public' and not tg.tgisinternal)
select c.n as columns, c.h as column_hash, p.n as policies, p.h as policy_hash,
       i.n as indexes, i.h as index_hash, g.n as triggers, g.h as trigger_hash
  from c, p, i, g;
`;

const OBJECT_SQL = CAPTURE_SQL.slice(CAPTURE_SQL.indexOf('-- 3. objects'));
const FUNCTION_SQL = CAPTURE_SQL.slice(
  CAPTURE_SQL.indexOf('-- 2. functions'),
  CAPTURE_SQL.indexOf('-- 3. objects'),
);

/**
 * Connects, or explains what to do about it.
 *
 * The local PostgreSQL this uses stops fairly often, and a refused connection
 * arrives as an uncaught ECONNREFUSED with a Node stack trace, which reads like
 * the tool is broken rather than the database being down. Somebody running a
 * check they did not write, on a project they are not deep in, should be told
 * which database and how to start it.
 */
async function connectTo(connectionString, what) {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    const where = connectionString.replace(/\/\/[^@/]*@/, '//');
    throw new Error(
      `cannot reach the ${what} database at ${where}: ${error.message}` +
        (what === 'local' ? '\n  start it with: npm run db:start' : ''),
    );
  }
  return client;
}

async function query(connectionString, sql, what = 'local') {
  const client = await connectTo(connectionString, what);
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Rebuilds the local database from the migrations before reading it.
 *
 * Without this the comparison reads whatever the last test run happened to
 * leave behind, and reports the leftovers as drift on the hosted project. A
 * check that cries wolf is worse than no check, so it makes its own side rather
 * than trusting it. Destructive, which is why it only ever runs against
 * DVD_TEST_DATABASE_URL - the same throwaway database `npm run test:db` uses.
 */
async function replayLocally(connectionString, files) {
  const client = await connectTo(connectionString, 'local');
  try {
    await client.query(`
      drop schema if exists public cascade;
      drop schema if exists auth cascade;
      drop schema if exists storage cascade;
      create schema public;
      grant all on schema public to postgres;
    `);
    for (const file of files) {
      try {
        await client.query(readFileSync(file, 'utf8'));
      } catch (error) {
        throw new Error(`${file} failed to apply: ${error.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function loadProduction(source) {
  if (source.startsWith('postgres://') || source.startsWith('postgresql://')) {
    const [migrations, functions, objects] = await Promise.all([
      query(source, CAPTURE_SQL.slice(0, CAPTURE_SQL.indexOf('-- 2. functions')), 'hosted'),
      query(source, FUNCTION_SQL, 'hosted'),
      query(source, OBJECT_SQL, 'hosted'),
    ]);
    return { migrations, functions, objects: objects[0] };
  }
  const snapshot = JSON.parse(readFileSync(source, 'utf8'));
  for (const key of ['migrations', 'functions']) {
    if (!Array.isArray(snapshot[key])) {
      throw new Error(`snapshot ${source} has no "${key}" array`);
    }
  }
  return snapshot;
}

function compareMigrationHistory(repository, applied) {
  const repoNames = new Map(repository.filter((m) => m.name).map((m) => [m.name, m.file]));
  const appliedNames = new Map(applied.map((entry) => [entry.name, entry.version]));

  for (const [name, file] of repoNames) {
    if (!appliedNames.has(name)) {
      fail(`${file} has never been applied to the hosted project`);
    }
  }
  for (const [name, version] of appliedNames) {
    if (!repoNames.has(name)) {
      fail(`the hosted project has applied "${name}" (version ${version}) with no file in this repository`);
    }
  }

  // Informational: the hosted versions are apply timestamps, the filenames are a
  // chosen order, so the two sequences are not the same numbers and cannot be
  // compared directly. Only the RELATIVE order is comparable, and it differing
  // is not by itself wrong - it says the migrations were applied in a different
  // order than a replay from zero would use.
  const repoOrder = [...repoNames.keys()];
  const appliedOrder = applied.map((entry) => entry.name).filter((name) => repoNames.has(name));
  const commonRepoOrder = repoOrder.filter((name) => appliedNames.has(name));
  for (let index = 0; index < commonRepoOrder.length; index += 1) {
    if (commonRepoOrder[index] !== appliedOrder[index]) {
      notes.push(
        `applied in a different order than the repository replays them, from "${appliedOrder[index]}" ` +
          `(the repository has "${commonRepoOrder[index]}" in that position)`,
      );
      break;
    }
  }

  console.log(
    `hosted project: ${applied.length} applied entries, ${repoNames.size} migration files, ` +
      `${[...repoNames.keys()].filter((name) => appliedNames.has(name)).length} matched by name`,
  );
}

function compareFunctions(production, local) {
  const productionByName = new Map(production.map((row) => [row.proname, row]));
  const localByName = new Map(local.map((row) => [row.proname, row]));

  for (const name of productionByName.keys()) {
    if (localByName.has(name)) continue;
    if (PLATFORM_OWNED_FUNCTIONS.has(name)) {
      notes.push(`${name}() exists only on the hosted project, as expected - the platform owns it`);
      continue;
    }
    fail(`${name}() exists on the hosted project and no migration in this repository creates it`);
  }
  for (const name of localByName.keys()) {
    if (!productionByName.has(name)) {
      fail(`${name}() is created by a migration here and is missing from the hosted project`);
    }
  }
  for (const [name, row] of productionByName) {
    const mine = localByName.get(name);
    if (!mine) continue;
    if (mine.fingerprint !== row.fingerprint) {
      // The fingerprint covers the arguments, the return type, the language,
      // `security definer`, volatility, `search_path` and the execute grants as
      // well as the body, so a difference is not necessarily in the text. The
      // lengths are shown because in practice it usually is.
      fail(
        `${name}() differs: hosted body ${row.body_length} characters, this repository ${mine.body_length}`,
      );
    }
  }
  console.log(`functions: ${production.length} on the hosted project, ${local.length} on a local replay`);
}

function compareObjects(production, local) {
  if (!production || !local) return;
  for (const [label, key, hashKey] of [
    ['columns', 'columns', 'column_hash'],
    ['policies', 'policies', 'policy_hash'],
    ['indexes', 'indexes', 'index_hash'],
    ['triggers', 'triggers', 'trigger_hash'],
  ]) {
    if (String(production[key]) !== String(local[key]) || production[hashKey] !== local[hashKey]) {
      fail(
        `${label} differ: hosted ${production[key]} (${production[hashKey]}), ` +
          `local replay ${local[key]} (${local[hashKey]})`,
      );
    }
  }
  console.log(
    `objects: columns ${production.columns}, policies ${production.policies}, ` +
      `indexes ${production.indexes}, triggers ${production.triggers}`,
  );
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes('--print-sql')) {
  console.log(CAPTURE_SQL);
  process.exit(0);
}

const productionArgument = argv[argv.indexOf('--production') + 1];
const wantsProduction = argv.includes('--production') && productionArgument !== undefined;

const repository = checkRepository();

if (wantsProduction) {
  // Anything that goes wrong reaching either database is a problem WITH THE RUN,
  // not a drift finding, and the two must not be confused: an unreachable
  // database reported as "no drift found" would be the worst outcome this script
  // has. It exits 2 so a caller can tell the difference from the 1 that means
  // drift was actually found.
  try {
    const isConnectionString =
      productionArgument.startsWith('postgres://') || productionArgument.startsWith('postgresql://');
    const production = await loadProduction(
      isConnectionString ? productionArgument : resolve(productionArgument),
    );
    compareMigrationHistory(repository, production.migrations);

    const localUrl = process.env.DVD_TEST_DATABASE_URL;
    if (!localUrl) {
      notes.push(
        'schema comparison SKIPPED: set DVD_TEST_DATABASE_URL to a PostgreSQL with the migrations replayed onto it',
      );
    } else {
      await replayLocally(localUrl, harnessMigrations());
      const [localFunctions, localObjects] = await Promise.all([
        query(localUrl, FUNCTION_SQL),
        query(localUrl, OBJECT_SQL),
      ]);
      compareFunctions(production.functions, localFunctions);
      compareObjects(production.objects, localObjects[0]);
    }
  } catch (error) {
    console.error(`\nthe comparison could not be run, so nothing about drift is known:\n  ${error.message}`);
    process.exit(2);
  }
} else if (!argv.includes('--repo-only')) {
  console.log('no --production given; checked this checkout only (pass --repo-only to say so on purpose)');
}

for (const note of notes) console.log(`note: ${note}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nno drift found.');
