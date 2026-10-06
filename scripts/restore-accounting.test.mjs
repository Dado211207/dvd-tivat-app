import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { OPERATIONAL_TABLES, splitOperational, splitRoles, verifyPlatformGrants, verifyTarget } from './restore-accounting.mjs';

// A production-looking push job and queued request, with a fake endpoint and token.
const FAKE_TOKEN = 'FAKE-PUSH-WORKER-TOKEN-not-a-real-key-0000';
const DUMP = [
  'SET statement_timeout = 0;',
  "SELECT pg_catalog.set_config('search_path', '', false);",
  '-- Data for Name: members; Type: TABLE DATA; Schema: public; Owner: postgres',
  'COPY "public"."members" ("id", "full_name", "note") FROM stdin;',
  'm1\tClan A\tsee cron.job and net.http_post in the runbook',
  'm2\tClan B\t\\N',
  '\\.',
  'COPY "auth"."sessions" ("id") FROM stdin;',
  '\\.',
  'COPY "cron"."job" ("jobid", "schedule", "command", "active") FROM stdin;',
  `1\t* * * * *\tselect net.http_post(url := 'https://abcdefghijklmnopqrst.supabase.invalid/functions/v1/send-web-push', headers := '{"Authorization": "Bearer ${FAKE_TOKEN}"}')\tt`,
  '\\.',
  'COPY net.http_request_queue (id, method, url, headers) FROM stdin;',
  `7\tPOST\thttps://abcdefghijklmnopqrst.supabase.invalid/functions/v1/send-web-push\t{"Authorization": "Bearer ${FAKE_TOKEN}"}`,
  '\\.',
  'SELECT pg_catalog.setval(\'"cron"."jobid_seq"\', 1, true);',
  'SELECT pg_catalog.setval(\'"public"."audit_seq"\', 3, true);',
  'RESET ALL;',
].join('\n');

test('the local restore copy never carries cron jobs, queued requests or their credentials', () => {
  const { restore, tables } = splitOperational(DUMP);
  assert.deepEqual(tables, [
    { table: 'public.members', rows: 2, restored: true },
    { table: 'auth.sessions', rows: 0, restored: true },
    { table: 'cron.job', rows: 1, restored: false },
    { table: 'net.http_request_queue', rows: 1, restored: false },
  ]);
  assert.ok(!restore.includes(FAKE_TOKEN), 'the fake token reached the restore copy');
  assert.ok(!restore.includes('supabase.invalid'), 'the fake endpoint reached the restore copy');
  assert.doesNotMatch(restore, /COPY "?(cron|net)"?\./);
  assert.doesNotMatch(restore, /setval\('"cron"/);
  // Application data, including text that merely mentions cron/net, is untouched.
  assert.match(restore, /m1\tClan A\tsee cron\.job and net\.http_post in the runbook/);
  assert.match(restore, /setval\('"public"\."audit_seq"', 3, true\)/);
  assert.match(restore, /^RESET ALL;$/m);
  // Splitting the restore copy again changes nothing.
  assert.equal(splitOperational(restore).restore, restore);
});

test('statements on operational schemas it does not understand are refused, not passed through', () => {
  for (const line of ['ALTER TABLE "cron"."job" DISABLE TRIGGER ALL;', "INSERT INTO net.http_request_queue VALUES (1);", "SELECT cron.schedule('x', '* * * * *', 'select 1');"]) {
    assert.throws(() => splitOperational(`SET x = 1;\n${line}\n`), /unhandled statement on an operational schema/);
  }
  assert.throws(() => splitOperational('COPY "public"."members" ("id") FROM stdin;\nm1\n'), /unterminated COPY block/);
});

const fakeClient = (counts) => ({
  async query(sql, params) {
    if (sql.startsWith('select to_regclass')) return { rows: [{ present: params[0] in counts }] };
    const table = sql.match(/from "([^"]+)"\."([^"]+)"/).slice(1).join('.');
    return { rows: [{ n: counts[table] }] };
  },
});

test('verification fails on any count difference and on any operational row; nothing is waived', async () => {
  const accounting = splitOperational(DUMP);
  const empty = Object.fromEntries(OPERATIONAL_TABLES.map((t) => [t, 0]));
  assert.deepEqual(await verifyTarget(fakeClient({ 'public.members': 2, 'auth.sessions': 0, ...empty }), accounting), []);
  // Operational tables that do not exist on the target are fine.
  assert.deepEqual(await verifyTarget(fakeClient({ 'public.members': 2, 'auth.sessions': 0 }), accounting), []);
  assert.deepEqual(await verifyTarget(fakeClient({ 'public.members': 1, 'auth.sessions': 0, ...empty }), accounting),
    ['public.members: dump has 2 rows, restore target has 1']);
  assert.deepEqual(await verifyTarget(fakeClient({ 'public.members': 2, 'auth.sessions': 0, ...empty, 'cron.job': 1 }), accounting),
    ['cron.job: restore target holds 1 operational rows; it must hold none']);
});

test('verify refuses a restore target that is not on this machine', () => {
  const r = spawnSync(process.execPath, [new URL('./restore-accounting.mjs', import.meta.url).pathname, 'verify', '/nonexistent.json'], {
    env: { PATH: process.env.PATH, DVD_RESTORE_TARGET_URL: 'postgresql://postgres:x@db.example.invalid:5432/postgres' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be a loopback restore target/);
  assert.doesNotMatch(r.stderr, /postgres:x@/);
});

test('only the platform\'s own parameter grants are left out of the local roles restore, and only if the target holds them', async () => {
  const roles = [
    'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';',
    'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
    'GRANT SET ON PARAMETER "log_min_messages" TO "dvd_app_role";',
    'GRANT SET ON PARAMETER "work_mem" TO "supabase_admin" WITH GRANT OPTION;',
    'RESET ALL;',
  ].join('\n');
  const { restore, platformGrants } = splitRoles(roles);
  assert.deepEqual(platformGrants, [{ parameter: 'log_min_messages', role: 'supabase_realtime_admin' }]);
  // Grants to the project's own roles, and any other form, still go to the restore (and fail loudly if they must).
  assert.match(restore, /TO "dvd_app_role";/);
  assert.match(restore, /WITH GRANT OPTION;/);
  assert.match(restore, /ALTER ROLE "anon"/);
  assert.doesNotMatch(restore, /supabase_realtime_admin/);
  const target = (held) => ({ async query() { return { rows: [{ held }] }; } });
  assert.deepEqual(await verifyPlatformGrants(target(true), platformGrants), []);
  assert.deepEqual(await verifyPlatformGrants(target(false), platformGrants),
    ['supabase_realtime_admin lacks SET on log_min_messages on the restore target; the roles dump grants it']);
});
