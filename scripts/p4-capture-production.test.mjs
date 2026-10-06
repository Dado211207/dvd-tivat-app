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
  assert.equal(script.match(/--dbname "\$db_url"/g)?.length, 10); // counts x2, definitions x2, operational export x2, secret inventory x4
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

test('the rehearsal restores a filtered copy into a fresh stack of its own, and accounts for it', async () => {
  const script = await readFile(resolve('scripts/release-preflight.sh'), 'utf8');
  // The complete dump, operational data included, goes into the archive...
  assert.match(script, /^tar -cf - roles\.sql schema\.sql data\.sql operational\.sql history_schema\.sql history_data\.sql custom_auth_storage\.sql manifest\.txt \| age /m);
  assert.match(script, /copy \$table to stdout/);
  assert.match(script, /^for table in cron\.job cron\.job_run_details net\.http_request_queue net\._http_response; do$/m);
  // ...and only the filtered copy is restored, then verified before anything else.
  assert.match(script, /restore-accounting\.mjs" split data\.sql data\.restore\.sql accounting\.json/);
  assert.match(script, /-c 'SET session_replication_role = replica' -f data\.restore\.sql \\$/m);
  assert.match(script, /-f roles\.restore\.sql -f schema\.sql/);
  assert.match(script, /restore-accounting\.mjs" roles roles\.sql roles\.restore\.sql accounting\.json/);
  assert.doesNotMatch(script, /replica' -f data\.sql/);
  assert.equal(script.match(/-f data\.sql /g)?.length, 1); // only where the dump writes it
  const verify = script.indexOf('restore-accounting.mjs" verify accounting.json');
  assert.ok(verify > script.indexOf('-f data.restore.sql') && verify < script.indexOf("'Migration history restore'"));
  // A loopback-only target of its own per run, checked fresh; Supabase CLI's stack is not used.
  assert.match(script, /^stack_id="boka-restore-\$\(date -u \+%Y%m%d%H%M%S\)-\$RANDOM"$/m);
  assert.match(script, /restore-target\.mjs" up "\$stack_id"/);
  const check = script.indexOf('restore-target.mjs" check "$stack_id"');
  assert.ok(check > script.indexOf('restore-target.mjs" up "$stack_id"') && check < script.indexOf('local_major='));
  assert.doesNotMatch(script, /^(?!\s*#).*\bsupabase (init|start|stop)\b/m); // only comments may mention it
  assert.doesNotMatch(script, /docker (volume |container |network |system |image )?(rm|prune)/);
  assert.match(script, /\[\[ "\$fresh" == 0 \]\] \|\| fail 'The restore target is not a fresh database\.'/);
  // The restore target, and so the gate, runs in UTC; its password comes from PGPASSFILE only.
  assert.match(script, /^local_url="postgresql:\/\/postgres@127\.0\.0\.1:\$local_port\/postgres\?options=-c%20TimeZone%3DUTC"/m);
});

test('cleanup removes exactly this run\'s restore target and fails loudly if anything is left', async () => {
  const lines = (await readFile(resolve('scripts/release-preflight.sh'), 'utf8')).split('\n');
  const start = lines.findIndex((l) => l === "stack_id=''");
  const end = lines.findIndex((l, k) => k > start && l === 'trap cleanup EXIT');
  const cleanupBlock = lines.slice(start, end + 1).join('\n');
  const run = async (downStatus, stackId, exitWith) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'boka-cleanup-')));
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'work'));
    // A stand-in restore-target.mjs that records how it was called.
    await writeFile(join(root, 'scripts/restore-target.mjs'),
      `import { appendFileSync } from 'node:fs';\nappendFileSync('${root}/calls', process.argv.slice(2).join(' ') + '\\n');\nprocess.exitCode = ${downStatus};\n`);
    const program = [`REPO='${root}'; work='${root}/work'`, cleanupBlock, stackId ? `stack_id='${stackId}'` : ':', `exit ${exitWith}`].join('\n');
    const child = spawn('bash', ['-c', program], { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const code = await new Promise((done) => child.on('close', done));
    const calls = await readFile(join(root, 'calls'), 'utf8').catch(() => '');
    const workLeft = await stat(join(root, 'work')).then(() => true, () => false);
    await rm(root, { recursive: true, force: true });
    return { code, stderr, calls, workLeft };
  };
  const clean = await run(0, 'boka-restore-20261006000000-1', 0);
  assert.equal(clean.code, 0);
  assert.equal(clean.calls, 'down boka-restore-20261006000000-1\n');
  assert.equal(clean.workLeft, false);
  const left = await run(1, 'boka-restore-20261006000000-2', 0);
  assert.equal(left.code, 1);
  assert.match(left.stderr, /restore target boka-restore-20261006000000-2 was not fully removed/);
  // A failed run keeps its failure status and is still cleaned up; with no target, nothing is called.
  assert.equal((await run(0, 'boka-restore-20261006000000-3', 1)).code, 1);
  const none = await run(0, '', 1);
  assert.equal(none.code, 1);
  assert.equal(none.calls, '');
  assert.equal(none.workLeft, false);
});

test('the backup records which secrets it lacks, by name only, and never calls itself complete', async () => {
  const script = await readFile(resolve('scripts/release-preflight.sh'), 'utf8');
  const runbook = await readFile(resolve('docs/P7_P8_RELEASE_PREP.md'), 'utf8');
  const worker = await readFile(resolve('supabase/functions/send-web-push/index.ts'), 'utf8');
  // Names only: no query reads a secret value.
  assert.match(script, /select coalesce\(string_agg\(coalesce\(name, '\(unnamed\)'\), ', ' order by name\), 'none'\) from vault\.secrets"/);
  assert.doesNotMatch(script, /select[^"]*\b(decrypted_)?secret\b[^"]*from vault/i);
  assert.doesNotMatch(script, /from vault\.decrypted_secrets/);
  // The scheduled jobs are counted, not read out (their full rows go only into the encrypted archive).
  assert.doesNotMatch(script, /select (command|\*)[^"]*from cron\.job/i);
  // The manifest and both messages say what the archive is not.
  assert.match(script, /THIS IS A DATABASE BACKUP, NOT A COMPLETE RECOVERY: secret material is not included\./);
  assert.match(script, /Encrypted database backup saved \(secrets not included - see its manifest\)/);
  assert.match(script, /Encrypted database backup \(secrets not included\)/);
  assert.doesNotMatch(script, /Encrypted backup saved:/);
  // Every secret the worker requires is named in the manifest line and in the owner's re-provisioning step.
  // Supabase supplies these three to every Edge Function; every other setting must be re-provisioned by the owner.
  const runtime = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const required = [...worker.matchAll(/requiredSecret\('([A-Z_]+)'\)/g)].map((m) => m[1]).filter((n) => !runtime.includes(n));
  assert.deepEqual(required.sort(), ['PUSH_WORKER_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT']);
  const manifestLine = script.split('\n').find((l) => l.includes('Edge Function secrets (outside the database'));
  for (const name of [...required, 'ALLOWED_ORIGIN', ...runtime]) {
    assert.ok(manifestLine.includes(name), `${name} missing from the manifest line`);
    assert.ok(runbook.includes(`\`${name}\``), `${name} missing from the runbook`);
  }
  assert.match(runbook, /## Secret material — not in the database backup \(owner re-provisioning\)/);
  assert.match(runbook, /\*\*Status:\*\* not done\./);
});
