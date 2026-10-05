import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { canonicalizeConstraintDef, canonicalizeConstraintDefs } from './canonical-constraint.mjs';
import { classify } from './privileges.mjs';
import { attestationSql, differences } from './fidelity.mjs';
import { dumpSourceUrl, outsideRepository, restoreAdminUrl, rolesNamedIn, scramVerifier, withoutDumpRoleGrants } from '../p4-restored-capture.mjs';

const NESTED = "CHECK ((((char_length(auth_secret) >= 8) AND (char_length(auth_secret) <= 100)) AND (auth_secret ~ '^[A-Za-z0-9_-]+$'::text)))";
const FLAT = "CHECK (((char_length(auth_secret) >= 8) AND (char_length(auth_secret) <= 100) AND (auth_secret ~ '^[A-Za-z0-9_-]+$'::text)))";

test('a dump/restore flattens nested AND; canonical form makes both equal', () => {
  assert.equal(canonicalizeConstraintDef(NESTED), canonicalizeConstraintDef(FLAT));
});

test('canonicalization keeps operator precedence, string literals and non-CHECK defs', () => {
  // AND binds tighter than OR; different groupings must stay different.
  assert.notEqual(
    canonicalizeConstraintDef('CHECK (((a > 1) AND (b > 2)) OR (c > 3))'),
    canonicalizeConstraintDef('CHECK ((a > 1) AND ((b > 2) OR (c > 3)))'),
  );
  // An AND inside a string literal is text, not structure.
  assert.equal(canonicalizeConstraintDef("CHECK ((note ~ 'a AND b'::text))"), "CHECK (note ~ 'a AND b'::text)");
  // Keys, uniques and FKs are returned untouched.
  const fk = 'FOREIGN KEY (x) REFERENCES public.y(id)';
  assert.equal(canonicalizeConstraintDef(fk), fk);
  // An input it cannot parse cleanly is returned unchanged, never guessed at.
  assert.equal(canonicalizeConstraintDef('CHECK ((a AND'), 'CHECK ((a AND');
  assert.deepEqual(canonicalizeConstraintDefs({ a: NESTED }), { a: canonicalizeConstraintDef(FLAT) });
});

test('classify refuses any application write path, membership or extra read', () => {
  const base = {
    role: 'dvd_release_dump', exists: true, server_major: 17,
    attributes: { superuser: false, createrole: false, createdb: false, replication: false, bypassrls: true, login: true, inherit: false },
    member_of: [], table_writes: [], column_writes: [], sequence_writes: [], create_in_schemas: [],
    database: { create: false, temporary: true }, security_definer_functions: [], readable: ['public.members', 'auth.users', 'supabase_migrations.schema_migrations'],
  };
  assert.equal(classify(base).ok, true);
  assert.equal(classify({ ...base, member_of: ['authenticated'] }).ok, false);
  assert.equal(classify({ ...base, table_writes: ['public.members:INSERT'] }).ok, false);
  assert.equal(classify({ ...base, security_definer_functions: ['public.owner_set_role(uuid, text)'] }).ok, false);
  assert.equal(classify({ ...base, attributes: { ...base.attributes, bypassrls: false } }).ok, false);
  assert.equal(classify({ ...base, readable: ['public.members'] }).ok, false); // cannot read auth.users / ledger
  // The pg_net queue is a problem, never platform.
  assert.equal(classify({ ...base, table_writes: ['net.http_request_queue:TRIGGER'] }).ok, false);
  // Reading pg_stat_statements is harmless platform, and system catalogs are built-in.
  const platform = classify({ ...base, readable: [...base.readable, 'extensions.pg_stat_statements', 'pg_catalog.pg_class'] });
  assert.equal(platform.ok, true);
  assert.ok(platform.platform.some((p) => p.includes('pg_stat_statements')));
});

test('the dump source must be the dump role, never the owner, and the target must be a separate loopback', () => {
  const ok = dumpSourceUrl('postgresql://dvd_release_dump:pw@db.yskhdzrdbywrpfowckpn.supabase.co:5432/postgres');
  assert.equal(ok.projectRef, 'yskhdzrdbywrpfowckpn');
  assert.throws(() => dumpSourceUrl('postgresql://postgres:pw@db.yskhdzrdbywrpfowckpn.supabase.co:5432/postgres'), /must connect as dvd_release_dump/);
  assert.throws(() => dumpSourceUrl('postgresql://dvd_release_dump@db.yskhdzrdbywrpfowckpn.supabase.co:5432/postgres'), /no password/);
  const loop = dumpSourceUrl('postgresql://dvd_release_dump:pw@127.0.0.1:55437/isolated');
  assert.equal(loop.loopback, true);
  // A loopback target must be a different server (port) than a loopback source.
  assert.throws(() => restoreAdminUrl('postgresql://postgres@127.0.0.1:55437/postgres', loop), /separate server/);
  assert.equal(restoreAdminUrl('postgresql://postgres@127.0.0.1:55438/postgres', loop).port, '55438');
  assert.throws(() => restoreAdminUrl('postgresql://postgres@db.x.supabase.co:5432/postgres', loop), /loopback/);
});

test('work and output paths must be outside the repository', async () => {
  await assert.rejects(outsideRepository(resolve('x.json'), '--out'), /outside the repository/);
  const outside = await mkdtemp(join(tmpdir(), 'boka-rc-'));
  try {
    // outsideRepository resolves symlinks; macOS's tmpdir() is under /var -> /private/var.
    assert.equal(await outsideRepository(join(outside, 'x.json'), '--out'), join(await realpath(outside), 'x.json'));
    await symlink(resolve('.'), join(outside, 'repo-link'));
    await assert.rejects(outsideRepository(join(outside, 'repo-link', 'x.json'), '--out'), /outside the repository/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('the dump role\'s own grants are stripped from the restored schema', () => {
  const sql = [
    'GRANT SELECT ON TABLE public.members TO dvd_release_dump;',
    'GRANT SELECT ON TABLE public.members TO authenticated;',
    'ALTER TABLE public.members OWNER TO postgres;',
  ].join('\n');
  const { text, removed } = withoutDumpRoleGrants(sql);
  assert.equal(removed, 1);
  assert.ok(!text.includes('dvd_release_dump'));
  assert.ok(text.includes('TO authenticated'));
  assert.deepEqual(rolesNamedIn(sql), ['authenticated', 'dvd_release_dump', 'postgres']);
});

test('attestationSql drops the impersonation loop and still shapes-checks the capture SQL', () => {
  const fakeCapture = [
    "  perform set_config('gate.n', n::text, true);",
    '  for k in 0 .. n - 1 loop',
    '    perform 1;',
    '  end loop;',
    "  x || (select string_agg(x, ' ' order by x) from unnest(c.relacl::text[]) x) || y",
  ].join('\n');
  const out = attestationSql(fakeCapture);
  assert.ok(!out.includes('for k in 0 .. n - 1 loop'));
  assert.ok(out.includes("set_config('gate.n', '0'"));
  assert.ok(out.includes('dvd_release_dump'));
  assert.throws(() => attestationSql('nothing of the expected shape'), /changed shape/);
});

test('differences compares constraints by canonical form, and reports real divergence', () => {
  const record = {
    read_only: 'on', applied_migrations: ['m1'], schema_fingerprint: { tables: { n: 1, md5: 'a' } },
    constraint_defs: { 'web.c': NESTED }, column_acls: '0', export_digest: { t: 'd' }, environment_digest: 'E',
  };
  // A copy that flattened the constraint but is otherwise identical: no difference.
  const copy = {
    read_only: 'on', applied_migrations: ['m1'], schema_fingerprint: { tables: { n: 1, md5: 'a' } },
    constraint_defs: { 'web.c': FLAT }, column_acls: '0', export_digest: { t: 'd' },
  };
  assert.deepEqual(differences(record, copy), []);
  // A genuinely different constraint is reported.
  const tampered = { ...copy, constraint_defs: { 'web.c': 'CHECK ((char_length(auth_secret) >= 9))' } };
  assert.deepEqual(differences(record, tampered), ['constraints.web.c']);
  // A changed row digest is reported.
  assert.deepEqual(differences(record, { ...copy, export_digest: { t: 'other' } }), ['export_digest.t']);
});

test('scramVerifier produces a PostgreSQL SCRAM-SHA-256 verifier', () => {
  const v = scramVerifier('a-password');
  assert.match(v, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

function runReachability(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(HERE, 'reachability.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => done({ code, out }));
  });
}

test('reachability reports a listening port reachable and a closed port not', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const open = server.address().port;
  try {
    const ok = await runReachability(['127.0.0.1', String(open)]);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /REACHABLE\s+127\.0\.0\.1:/);
  } finally {
    await new Promise((r) => server.close(r));
  }
  // The port is closed now: a local closed port refuses at once -> unreachable, non-zero exit.
  const bad = await runReachability(['127.0.0.1', String(open)]);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /UNREACHABLE/);
});

test('the rehearsal workflow is manual-only, uploads nothing, and never puts the secret on a command line', async () => {
  const wf = await readFile(resolve(REPO, '.github/workflows/supabase-dump-rehearsal.yml'), 'utf8');
  // Triggered only by hand.
  assert.match(wf, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(wf, /^\s*(push|pull_request):/m);
  // Never uploads an artifact (no dump/capture leaves the runner).
  assert.doesNotMatch(wf, /upload-artifact/);
  // Least privilege, and a cleanup that always runs.
  assert.match(wf, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(wf, /if:\s*\$\{\{\s*always\(\)\s*\}\}/);
  // The secret is referenced only as an env value, never interpolated into a run: line.
  assert.match(wf, /DVD_DUMP_DATABASE_URL:\s*\$\{\{\s*secrets\.DVD_DUMP_DATABASE_URL\s*\}\}/);
  for (const line of wf.split('\n')) {
    if (/secrets\.DVD_DUMP_DATABASE_URL/.test(line)) {
      assert.match(line, /^\s*DVD_DUMP_DATABASE_URL:\s*\$\{\{\s*secrets\.DVD_DUMP_DATABASE_URL\s*\}\}\s*$/, `secret used off the env line: ${line}`);
    }
  }
});
