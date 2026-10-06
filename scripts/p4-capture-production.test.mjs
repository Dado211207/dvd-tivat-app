import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { captureResult, outputPath, sourceUrl } from './p4-capture-production.mjs';

test('only the expected production project can be captured', () => {
  assert.equal(sourceUrl('postgresql://postgres:example@db.yskhdzrdbywrpfowckpn.supabase.co:5432/postgres').hostname,
    'db.yskhdzrdbywrpfowckpn.supabase.co');
  assert.equal(sourceUrl('postgresql://postgres.yskhdzrdbywrpfowckpn:example@aws-0-eu-west-1.pooler.supabase.com:5432/postgres').username,
    'postgres.yskhdzrdbywrpfowckpn');
  assert.throws(() => sourceUrl('postgresql://postgres:example@db.another.supabase.co:5432/postgres'), /expected DVD Tivat/);
  assert.throws(() => sourceUrl('postgresql://postgres:example@db.yskhdzrdbywrpfowckpn.supabase.co:5432/other'), /expected DVD Tivat/);
});

test('the capture can only be saved outside the source tree', async () => {
  await assert.rejects(outputPath('capture.production-export.json'), /absolute path/);
  await assert.rejects(outputPath(resolve('capture.production-export.json')), /outside the repository/);
  const outside = await mkdtemp(join(tmpdir(), 'boka-capture-'));
  try {
    // outputPath resolves symlinks; macOS's tmpdir() is under /var -> /private/var.
    assert.equal(await outputPath(join(outside, 'capture.production-export.json')),
      join(await realpath(outside), 'capture.production-export.json'));
    await symlink(resolve('.'), join(outside, 'source-link'));
    await assert.rejects(outputPath(join(outside, 'source-link', 'capture.production-export.json')), /outside the repository/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('a capture must include a read-only transaction and the real migration ledger', () => {
  const valid = {
    read_only: 'on', applied_migrations: ['example'], schema_fingerprint: {},
    export: {}, export_digest: {}, behaviour_digest: {},
  };
  assert.deepEqual(captureResult([{ rows: [] }, { rows: [valid] }]), valid);
  assert.throws(() => captureResult({ rows: [{ ...valid, read_only: 'off' }] }), /not read-only/);
  assert.throws(() => captureResult({ rows: [{ ...valid, applied_migrations: null }] }), /missing applied_migrations/);
  assert.throws(() => captureResult({ rows: [] }), /exactly one row/);
});

test('the release rehearsal keeps the password URL off command lines and out of shared environments', async () => {
  const script = await readFile(resolve('scripts/release-preflight.sh'), 'utf8');
  const runner = await readFile(resolve('scripts/release-preflight.mjs'), 'utf8');
  assert.doesNotMatch(script, /"\$(DVD_PRODUCTION_DB_URL|DVD_READONLY_DATABASE_URL)"/);
  assert.doesNotMatch(script, /^\s*export (DVD_PRODUCTION_DB_URL|DVD_READONLY_DATABASE_URL)\b/m);
  assert.match(script, /^unset DVD_PRODUCTION_DB_URL$/m);
  assert.match(script, /^exec 3<&-$/m);
  // Handed on only as one-command assignments, to the passfile writer and the capture.
  assert.deepEqual(script.match(/[A-Z_]+="\$production_url"/g),
    ['DVD_PRODUCTION_DB_URL="$production_url"', 'DVD_READONLY_DATABASE_URL="$production_url"']);
  // ...each directly on a node command, never on a shell function, which would
  // export it to everything the function runs.
  assert.deepEqual(script.match(/[A-Z_]+="\$production_url" \S+/g),
    ['DVD_PRODUCTION_DB_URL="$production_url" node', 'DVD_READONLY_DATABASE_URL="$production_url" node']);
  assert.match(script, /^db_url="\$\(DVD_PRODUCTION_DB_URL="\$production_url" node --input-type=module -e '$/m);
  assert.match(script, /^capture_p4\(\) \{ DVD_READONLY_DATABASE_URL="\$production_url" node scripts\/p4-capture-production\.mjs "\$1"; \}\nrun_private 'Production read-only equivalence capture' capture_p4 "\$capture"\nunset production_url$/m);
  assert.match(script, /^export PGPASSFILE="\$work\/pgpass"$/m);
  assert.match(script, /mode: 0o600, flag: "wx"/);
  assert.equal(script.match(/--dbname "\$db_url"/g)?.length, 4);
  assert.equal(script.match(/--db-url "\$db_url"/g)?.length, 5);
  // The runner passes the URL on file descriptor 3, never in the script's environment.
  assert.match(runner, /stdio: \['inherit', 'inherit', 'inherit', 'pipe'\]/);
  assert.match(runner, /delete env\.DVD_PRODUCTION_DB_URL;/);
  assert.match(runner, /child\.stdio\[3\]\.end\(url\.toString\(\)\);/);
  assert.doesNotMatch(runner, /DVD_PRODUCTION_DB_URL:/);
});

// Runs release-preflight.sh's own intake, passfile, run_private and capture lines
// from a scratch directory: its stand-in capture module accepts only loopback and
// records what it was given, and an `age` shim records its environment. Nothing
// connects anywhere.
async function runPreflightLines(url, { viaFd3, failCapture = false }) {
  const lines = (await readFile(resolve('scripts/release-preflight.sh'), 'utf8')).split('\n');
  const block = (start, end) => {
    const i = lines.findIndex((l) => l.startsWith(start));
    const j = lines.findIndex((l, k) => k > i && (l === end || l.includes(end)));
    assert.ok(i >= 0 && j > i, `no block ${start}`);
    return lines.slice(i, j + 1).join('\n');
  };
  const root = await realpath(await mkdtemp(join(tmpdir(), 'boka-preflight-')));
  const program = [
    'set -euo pipefail',
    "fail() { printf '%s\\n' \"$1\" >&2; exit 1; }",
    `REPO='${root}'; work='${root}'; backup_dir='${root}'; DVD_BACKUP_RECIPIENT=age1test`,
    block('production_url=', "fail 'DVD_PRODUCTION_DB_URL is missing.'"),
    block('export PGPASSFILE=', 'Could not prepare the private password file.'),
    block('run_private() {', '}'),
    'env > "$work/child-env"',
    block('cd "$REPO"', 'unset production_url'),
    'env > "$work/after-env"; printf %s "${production_url:-}" > "$work/left"; printf %s "$db_url" > "$work/db-url"',
  ].join('\n');
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts/p4-capture-production.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "export function sourceUrl(s) { const u = new URL(s); if (u.hostname !== '127.0.0.1' || !u.password) throw new Error('refused'); return u; }",
    'if (process.argv[2]) writeFileSync(process.argv[2], process.env.DVD_READONLY_DATABASE_URL ?? "");',
    `if (process.argv[2] && ${failCapture}) process.exit(1);`,
  ].join('\n'));
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin/age'), `#!/bin/sh\nenv > '${root}/age-env'\nprintf '%s\\n' "$*" > '${root}/age-argv'\n`, { mode: 0o755 });
  const env = { PATH: `${root}/bin:${dirname(process.execPath)}:/usr/bin:/bin`, ...(viaFd3 ? {} : { DVD_PRODUCTION_DB_URL: url }) };
  const child = spawn('bash', ['-c', program], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  child.stdio[3].on('error', () => {});
  child.stdio[3].end(viaFd3 ? url : '');
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((done) => child.on('close', done));
  return { root, code, stderr, read: (f) => readFile(join(root, f), 'utf8') };
}

const fakeUrl = new URL('postgresql://postgres@127.0.0.1:9/postgres');
fakeUrl.password = 'fake:pw\\not-a-secret';
const carriesPassword = (text) => text.includes(decodeURIComponent(fakeUrl.password)) || text.includes(fakeUrl.password);

test('only the passfile writer and the capture receive the password URL', async () => {
  for (const viaFd3 of [true, false]) {
    const { root, code, stderr, read } = await runPreflightLines(fakeUrl.toString(), { viaFd3 });
    try {
      assert.equal(code, 0, stderr);
      for (const f of ['child-env', 'after-env']) assert.ok(!carriesPassword(await read(f)), `${f} carries the password`);
      assert.equal(await read('fresh.production-export.json'), fakeUrl.toString(), 'the capture was not given the URL');
      assert.equal(await read('left'), '');
      assert.equal(await read('db-url'), 'postgresql://postgres@127.0.0.1:9/postgres');
      assert.equal(await read('pgpass'), '127.0.0.1:9:postgres:postgres:fake\\:pw\\\\not-a-secret\n');
      assert.equal((await stat(join(root, 'pgpass'))).mode & 0o777, 0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const refused = await runPreflightLines('postgresql://postgres:fake@127.0.0.2:9/postgres', { viaFd3: true });
  await rm(refused.root, { recursive: true, force: true });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /not for the expected DVD Tivat project/);
});

test('a failing capture encrypts its diagnostic without the password URL in age\'s environment', async () => {
  for (const viaFd3 of [true, false]) {
    const { root, code, stderr, read } = await runPreflightLines(fakeUrl.toString(), { viaFd3, failCapture: true });
    try {
      assert.equal(code, 1);
      assert.match(stderr, /Production read-only equivalence capture failed\. Encrypted diagnostic:/);
      assert.equal(await read('fresh.production-export.json'), fakeUrl.toString(), 'the capture was not given the URL');
      const ageEnv = await read('age-env');
      assert.ok(!carriesPassword(ageEnv), 'age received the password');
      assert.doesNotMatch(ageEnv, /^(DVD_READONLY_DATABASE_URL|DVD_PRODUCTION_DB_URL)=/m);
      assert.ok(!carriesPassword(await read('age-argv')), 'age argv carries the password');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
