/**
 * Negative write evidence for the dump credential: try every way it could
 * change something, for real, and show that nothing changed.
 *
 *   node scripts/restored-capture/negative-evidence.mjs --report <file outside the repo>
 *
 *   DVD_DUMP_DATABASE_URL       the dump role on a LOOPBACK stand-in source
 *   DVD_SOURCE_ADMIN_URL        a superuser on the same loopback source, used
 *                               only to fingerprint the data before and after
 *
 * Every attempt runs as the dump role over its own login, outside any
 * explicit transaction, so whatever succeeds is committed. The session first
 * turns its read-only default off - the role setting is a convenience, not a
 * control, and the evidence must not rely on it.
 *
 *   1  every table in every application schema: INSERT, UPDATE, DELETE, TRUNCATE
 *   2  every function in `public` - each command the app has - with JWT claims
 *      forged to be the owner, and again with no claims
 *   3  SET ROLE to every other role in the cluster
 *   4  DDL and grants: create, alter, grant, create role, trigger
 *   5  reads it must not have: password hashes, the cron job, vault
 *   6  pg_net's queue: enqueue, read, redirect, drop, truncate, lock - and
 *      the escalation, a trigger running the role's own temporary function
 *      inside the push cron's session - followed by a real cron tick
 *   7  what PUBLIC gives every login (temp tables, large objects, notify) -
 *      expected to succeed, and reported as such
 *
 * Then a superuser digest of every row in every application schema must be
 * identical before and after. Refuses a non-loopback source: this writes.
 */

import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { DUMP_ROLE } from './fidelity.mjs';
import { dumpSourceUrl, outsideRepository } from '../p4-restored-capture.mjs';

export const APPLICATION_SCHEMAS = ['public', 'auth', 'storage', 'supabase_migrations', 'cron', 'vault'];

const DIGEST_SQL = `select n.nspname || '.' || c.relname as rel,
    (xpath('/row/d/text()', query_to_xml(format(
      'select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as d from %I.%I t', E'\\n', '', n.nspname, c.relname),
      false, true, '')))[1]::text as digest
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = any($1) and c.relkind in ('r', 'p')
 order by 1`;

async function digest(admin) {
  const { rows } = await admin.query(DIGEST_SQL, [APPLICATION_SCHEMAS]);
  const roles = await admin.query(`select md5(string_agg(rolname || rolsuper || rolbypassrls || rolinherit || rolcanlogin, ',' order by rolname)) d from pg_roles`);
  const grants = await admin.query(`select md5(coalesce(string_agg(x, ',' order by x), '')) d from (
    select n.nspname || '.' || c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = any($1)) s`, [APPLICATION_SCHEMAS]);
  const functions = await admin.query(`select md5(coalesce(string_agg(x, ',' order by x), '')) d from (
    select p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text, '') as x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1)) s`, [APPLICATION_SCHEMAS]);
  return {
    rows: Object.fromEntries(rows.map((r) => [r.rel, r.digest])),
    roles: roles.rows[0].d, grants: grants.rows[0].d, functions: functions.rows[0].d,
  };
}

async function attempt(client, sql, params = []) {
  try {
    await client.query(sql, params);
    return { ok: true };
  } catch (error) {
    // A failed multi-statement attempt can leave its own BEGIN open.
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code, message: error.message.slice(0, 160) };
  }
}

export async function collectEvidence({ dumpUrl, adminUrl }) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const dump = new pg.Client({ connectionString: dumpUrl.toString() });
  await dump.connect();
  const evidence = { role: DUMP_ROLE, attempts: [], platform: [] };
  const record = (category, target, result, expectRefused = true) => {
    evidence.attempts.push({ category, target, refused: !result.ok, code: result.code ?? null, expectRefused, message: result.message ?? null });
  };
  try {
    const before = await digest(admin);
    await dump.query('set default_transaction_read_only = off');
    const owner = (await admin.query(`select user_id from public.access_grants where role = 'OWNER' limit 1`)).rows[0]?.user_id;

    // 1. tables
    const { rows: tables } = await admin.query(`select n.nspname, c.relname,
        (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped order by a.attnum limit 1) as col
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1) and c.relkind in ('r', 'p') order by 1, 2`, [APPLICATION_SCHEMAS]);
    for (const t of tables) {
      const q = `"${t.nspname}"."${t.relname}"`;
      record('table', `${q} INSERT`, await attempt(dump, `insert into ${q} default values`));
      record('table', `${q} UPDATE`, await attempt(dump, `update ${q} set "${t.col}" = "${t.col}"`));
      record('table', `${q} DELETE`, await attempt(dump, `delete from ${q}`));
      record('table', `${q} TRUNCATE`, await attempt(dump, `truncate ${q} cascade`));
    }

    // 2. every public function, with forged owner claims and with none
    const { rows: functions } = await admin.query(`select p.oid::regprocedure::text as sig, p.proname,
        array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
        exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') as extension
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' order by 1`);
    // Functions an extension installed into public (pgcrypto, btree_gist) are
    // computations the app does not own; they are called too, but counted
    // apart. What decides is the data digest at the end.
    const extensionFunctions = functions.filter((f) => f.extension).length;
    evidence.extensionFunctions = extensionFunctions;
    for (const claims of [JSON.stringify({ sub: owner, role: 'authenticated' }), null]) {
      await dump.query(`select set_config('request.jwt.claims', $1, false)`, [claims ?? '']);
      for (const f of functions) {
        const args = f.types.map((t) => `null::${t}`).join(', ');
        if (f.extension) continue;
        record(claims ? 'app function, forged owner claims' : 'app function, no claims', f.sig,
          await attempt(dump, `select public."${f.proname}"(${args})`));
      }
    }
    await dump.query(`select set_config('request.jwt.claims', '', false)`);

    // 3. every other role
    const { rows: roles } = await admin.query(`select rolname from pg_roles where rolname <> $1 order by 1`, [DUMP_ROLE]);
    for (const r of roles) {
      const switched = await attempt(dump, `set role "${r.rolname}"`);
      record('set role', r.rolname, switched);
      if (switched.ok) {
        // Follow a role switch through: as that role, with owner claims,
        // every app command. This is the forged-claims path end to end.
        await dump.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: owner, role: 'authenticated' })]);
        for (const f of functions.filter((x) => !x.extension)) {
          record(`app function as ${r.rolname}, forged owner claims`, f.sig,
            await attempt(dump, `select public."${f.proname}"(${f.types.map((t) => `null::${t}`).join(', ')})`));
        }
        await dump.query(`select set_config('request.jwt.claims', '', false)`);
        await dump.query('reset role').catch(() => {});
        // And one concrete promotion, so a write is shown rather than inferred.
        const target = (await admin.query(`select user_id from public.access_grants where role = 'FIREFIGHTER' limit 1`)).rows[0]?.user_id;
        if (target) {
          await dump.query(`set role "${r.rolname}"`);
          await dump.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: owner, role: 'authenticated' })]);
          record(`owner promotion as ${r.rolname}`, 'owner_set_role(<firefighter>, ADMIN)',
            await attempt(dump, `select public.owner_set_role($1, 'ADMIN')`, [target]));
          await dump.query(`select set_config('request.jwt.claims', '', false)`);
          await dump.query('reset role').catch(() => {});
        }
      }
    }

    // 4. DDL and grants
    for (const [what, sql] of [
      ['create table in public', 'create table public.dump_probe (x int)'],
      ['create function in public', 'create function public.dump_probe() returns int language sql as $$ select 1 $$'],
      ['create schema', 'create schema dump_probe'],
      ['alter table public.members', 'alter table public.members add column dump_probe int'],
      ['create trigger on public.members', 'create trigger dump_probe before insert on public.members for each row execute function public.handle_new_account()'],
      ['grant on public.members (a non-owner GRANT is a no-op warning; the grants digest decides)', 'grant select on public.members to anon'],
      ['disable RLS on public.members', 'alter table public.members disable row level security'],
      ['create role', 'create role dump_probe'],
      ['alter own role', `alter role ${DUMP_ROLE} superuser`],
      ['comment on public.members', "comment on table public.members is 'probe'"],
      ['create index on public.members', 'create index dump_probe on public.members (id)'],
    ]) record('ddl', what, await attempt(dump, sql));

    // 5. reads it must not have
    for (const [what, sql] of [
      ['auth.users password hash', 'select encrypted_password from auth.users limit 1'],
      ['auth.users e-mail', 'select email from auth.users limit 1'],
      ['auth.users confirmation token', 'select confirmation_token from auth.users limit 1'],
      ['cron.job command', 'select command from cron.job limit 1'],
      ['vault.secrets', 'select secret from vault.secrets limit 1'],
    ]) record('secret read', what, await attempt(dump, sql));

    // 6. pg_net's queue: the push cron writes it as postgres every minute
    for (const [what, sql] of [
      ['enqueue a request', "insert into net.http_request_queue(method, url) values ('GET', 'https://example.invalid/dump-probe')"],
      ['read queued requests (push secret header)', 'select headers from net.http_request_queue limit 1'],
      ['redirect queued requests', "update net.http_request_queue set url = 'https://example.invalid/elsewhere'"],
      ['drop queued requests', 'delete from net.http_request_queue'],
      ['truncate the queue', 'truncate net.http_request_queue'],
      ['lock the queue', 'begin; lock table net.http_request_queue in access exclusive mode; rollback'],
    ]) record('pg_net queue', what, await attempt(dump, sql));
    // The escalation: a trigger running the role's own code inside the
    // cron's postgres session. The function lives in the role's temporary
    // schema, which PUBLIC's TEMPORARY privilege allows.
    await attempt(dump, `create function pg_temp.dump_probe_escalate() returns trigger language plpgsql as $f$
      begin update public.access_grants set role = 'ADMIN' where role = 'FIREFIGHTER'; return new; end $f$`);
    record('trigger escalation', 'trigger on net.http_request_queue running a temp function',
      await attempt(dump, `create trigger dump_probe_escalate before insert on net.http_request_queue
        for each row execute function pg_temp.dump_probe_escalate()`));
    // A cron tick from another session, as postgres - the role the push cron
    // runs as. If the trigger exists, it runs the dump role's code here.
    evidence.cronTickAsPostgres = await attempt(admin, `select net.http_post('https://example.invalid/cron-tick')`);
    // And the cron must still work with only the hardening's grants: a
    // non-superuser holding exactly those (Supabase's postgres is not one).
    const tick = await attempt(admin, `do $t$ begin
      set local role cron_stand_in;
      perform net.http_post('https://example.invalid/cron-tick-minimal');
    end $t$`);
    evidence.cronTick = { enqueued: tick.ok, message: tick.message ?? null };

    // 7. what PUBLIC gives every login
    for (const [what, sql] of [
      ['temporary table', 'create temporary table dump_probe (x int)'],
      ['large object', 'select lo_create(0)'],
      ['notify', "select pg_notify('dump_probe', 'x')"],
    ]) {
      const result = await attempt(dump, sql);
      evidence.platform.push({ what, succeeded: result.ok, code: result.code ?? null });
    }

    const after = await digest(admin);
    const changedTables = Object.keys({ ...before.rows, ...after.rows }).filter((k) => before.rows[k] !== after.rows[k]);
    evidence.unchanged = {
      tables: Object.keys(before.rows).length,
      changedTables,
      roles: before.roles === after.roles,
      grants: before.grants === after.grants,
      functions: before.functions === after.functions,
    };
    // Undo the probes as the superuser.
    await admin.query(`drop trigger if exists dump_probe_escalate on net.http_request_queue`).catch(() => {});
    await admin.query(`delete from net.http_request_queue where url like 'https://example.invalid/%'`).catch(() => {});
    await admin.query(`select lo_unlink(oid) from pg_largeobject_metadata where lomowner = (select oid from pg_roles where rolname = $1)`, [DUMP_ROLE]).catch(() => {});
  } finally {
    await dump.end().catch(() => {});
    await admin.end().catch(() => {});
  }
  const accepted = evidence.attempts.filter((a) => !a.refused && !a.target.startsWith('grant on public.members'));
  // A refusal must be a privilege refusal, not an unrelated error that would
  // have hidden a successful write (an attempt that fails on a NOT NULL
  // column proves nothing about the privilege).
  const notPrivilege = evidence.attempts.filter((a) => a.refused && a.code !== '42501');
  evidence.verdict = {
    attempts: evidence.attempts.length,
    accepted: accepted.map((a) => `${a.category}: ${a.target}`),
    refusedForOtherReasons: notPrivilege.map((a) => `${a.category}: ${a.target} (${a.code} ${a.message})`),
    dataUnchanged: evidence.unchanged.changedTables.length === 0 && evidence.unchanged.roles
      && evidence.unchanged.grants && evidence.unchanged.functions,
  };
  evidence.verdict.ok = accepted.length === 0 && notPrivilege.length === 0 && evidence.verdict.dataUnchanged
    && evidence.cronTick?.enqueued === true;
  return evidence;
}

export function summarise(evidence) {
  const byCategory = {};
  for (const a of evidence.attempts) {
    byCategory[a.category] ??= { attempts: 0, refused: 0, codes: {} };
    byCategory[a.category].attempts += 1;
    if (a.refused) byCategory[a.category].refused += 1;
    byCategory[a.category].codes[a.code ?? 'OK'] = (byCategory[a.category].codes[a.code ?? 'OK'] ?? 0) + 1;
  }
  const lines = Object.entries(byCategory).map(([k, v]) => `  ${k.padEnd(32)} ${v.refused}/${v.attempts} refused  ${JSON.stringify(v.codes)}`);
  lines.push(`  application data unchanged       ${evidence.verdict.dataUnchanged} (${evidence.unchanged.tables} tables, roles, grants, functions)`);
  if (evidence.cronTick) lines.push(`  cron tick (non-superuser) enqueue ${evidence.cronTick.enqueued ? 'still works' : `FAILED: ${evidence.cronTick.message}`}`);
  for (const p of evidence.platform) lines.push(`  PUBLIC platform: ${p.what.padEnd(26)} ${p.succeeded ? 'succeeded (every login role can)' : `refused ${p.code}`}`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const source = dumpSourceUrl(process.env.DVD_DUMP_DATABASE_URL);
  if (!source.loopback) throw new Error('Negative evidence writes on purpose; run it against a loopback stand-in only.');
  const adminUrl = process.env.DVD_SOURCE_ADMIN_URL;
  if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) throw new Error('Set DVD_SOURCE_ADMIN_URL to the loopback source superuser.');
  const reportPath = args.includes('--report') ? await outsideRepository(args[args.indexOf('--report') + 1], '--report') : null;
  const evidence = await collectEvidence({ dumpUrl: source.url, adminUrl });
  console.log(summarise(evidence));
  for (const a of evidence.verdict.accepted) console.log(`  ACCEPTED ${a}`);
  for (const a of evidence.verdict.refusedForOtherReasons.slice(0, 20)) console.log(`  refused, not by privilege: ${a}`);
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(evidence.verdict.ok ? 'NO WRITE PATH: every attempt was refused and no application data changed.' : 'WRITE PATH FOUND');
  process.exitCode = evidence.verdict.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('negative-evidence.mjs')) {
  main().catch((error) => {
    console.error(error.message.replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exitCode = 2;
  });
}
