import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBindings, exposedBindings, removeTarget, startTarget } from './restore-target.mjs';

const ID = 'boka-restore-20261006000000-1';

/**
 * A stand-in `docker` on PATH: records every call (and whether any argument
 * carries a secret it was handed in the environment), and answers from a small
 * state file so `up`, `check` and `down` can run without Docker.
 */
async function withDocker(state, fn) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'boka-target-')));
  await writeFile(join(root, 'state.json'), JSON.stringify(state));
  await writeFile(join(root, 'docker'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync('${root}/state.json', 'utf8'));
const secrets = ['POSTGRES_PASSWORD', 'RESTORE_DB_PASSWORD', 'DATABASE_URL', 'GOTRUE_DB_DATABASE_URL', 'JWT_SECRET'].map((k) => process.env[k]).filter(Boolean);
const leak = args.some((a) => secrets.some((s) => a.includes(s)));
fs.appendFileSync('${root}/calls', JSON.stringify({ args, leak }) + '\\n');
const out = (s) => process.stdout.write(s);
const [a, b] = args;
if (a === 'ps') out(st.containers.join('\\n'));
else if (b === 'ls') out((a === 'volume' ? st.volumes : st.networks).join('\\n'));
else if (a === 'inspect') out(st.containers.map(() => JSON.stringify(st.bindings) + '|' + JSON.stringify(st.bindings)).join('\\n'));
else if (a === 'run' && args[1] === '-d') { st.containers = ['c-db']; st.bindings = st.runBindings; }
else if (a === 'rm') st.containers = st.keepContainers ? st.containers : [];
else if (a === 'volume' && b === 'rm') st.volumes = [];
else if (a === 'volume' && b === 'create') st.volumes = [args.at(-1)];
else if (a === 'network' && b === 'rm') st.networks = [];
else if (a === 'network' && b === 'create') st.networks = [args.at(-1)];
else if (a === 'port') out(st.port);
fs.writeFileSync('${root}/state.json', JSON.stringify(st));
`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${root}:${savedPath}`;
  try {
    return await fn(root, async () => (await readFile(join(root, 'calls'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  } finally {
    process.env.PATH = savedPath;
    await rm(root, { recursive: true, force: true });
  }
}

const binding = (hostIp, hostPort = '54322') => ({ '5432/tcp': [{ HostIp: hostIp, HostPort: hostPort }] });

test('only loopback bindings are allowed; all-interfaces, IPv6 wildcard and LAN addresses are not', () => {
  const b = (hostIp) => ({ hostIp, hostPort: '1' });
  assert.deepEqual(exposedBindings([b('127.0.0.1'), b('::1')]), []);
  for (const hostIp of ['0.0.0.0', '::', '', undefined, '192.168.1.20', '172.20.0.163', 'localhost']) {
    assert.equal(exposedBindings([b('127.0.0.1'), b(hostIp)]).length, 1, `${hostIp} must be refused`);
  }
});

test('the binding check refuses a stack published beyond loopback, and one with no containers', async () => {
  await withDocker({ containers: ['c-db'], volumes: [], networks: [], bindings: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '54322' }, { HostIp: '::', HostPort: '54322' }] } }, async () => {
    assert.throws(() => checkBindings(ID), /publishes ports beyond this machine: 0\.0\.0\.0:54322 :::54322/);
  });
  await withDocker({ containers: ['c-db'], volumes: [], networks: [], bindings: binding('') }, async () => {
    assert.throws(() => checkBindings(ID), /\(all interfaces\):54322/);
  });
  await withDocker({ containers: [], volumes: [], networks: [], bindings: {} }, async () => {
    assert.throws(() => checkBindings(ID), /has no containers/);
  });
  await withDocker({ containers: ['c-db'], volumes: [], networks: [], bindings: binding('127.0.0.1') }, async (_, calls) => {
    assert.deepEqual(checkBindings(ID), [{ hostIp: '127.0.0.1', hostPort: '54322' }]);
    assert.ok((await calls()).some((c) => c.args.join(' ') === `ps -aq --filter label=com.boka.rehearsal=${ID}`));
  });
});

test('up publishes the database on 127.0.0.1 only, passes secrets by name only, and records the port in the passfile', async () => {
  await withDocker({ containers: [], volumes: [], networks: [], bindings: {}, runBindings: binding('127.0.0.1', '51700'), port: '127.0.0.1:51700' }, async (root, calls) => {
    const passfile = join(root, 'pgpass');
    await writeFile(passfile, 'existing:entry\n', { mode: 0o600 });
    assert.equal(startTarget(ID, { passfile }), 51700);
    const all = await calls();
    assert.equal(all.filter((c) => c.leak).length, 0, 'a secret reached a docker argument');
    const publishes = all.flatMap((c) => c.args.flatMap((a, i) => (a === '-p' || a === '--publish' ? [c.args[i + 1]] : [])));
    assert.deepEqual(publishes, ['127.0.0.1::5432']);
    // Every -e names a variable; none carries a value.
    for (const c of all) c.args.forEach((a, i) => { if (a === '-e') assert.doesNotMatch(c.args[i + 1], /=/); });
    // The migration jobs run on the run's network, removed when done, never published.
    const jobs = all.filter((c) => c.args[0] === 'run' && c.args[1] === '--rm');
    assert.equal(jobs.length, 2);
    for (const j of jobs) assert.ok(j.args.includes(`--network`) && j.args.includes(ID) && j.args.includes(`com.boka.rehearsal=${ID}`));
    // The db, its volume and network carry the run's label.
    for (const kind of [['network', 'create'], ['volume', 'create']]) {
      assert.ok(all.some((c) => c.args[0] === kind[0] && c.args[1] === kind[1] && c.args.includes(`com.boka.rehearsal=${ID}`)));
    }
    const lines = (await readFile(passfile, 'utf8')).trim().split('\n');
    assert.equal(lines[0], 'existing:entry');
    assert.match(lines[1], /^127\.0\.0\.1:51700:\*:postgres:[0-9a-f]{48}$/);
    assert.equal((await stat(passfile)).mode & 0o777, 0o600);
  });
});

test('up refuses a non-private passfile, an existing target, and a database Docker did not bind to loopback', async () => {
  await withDocker({ containers: [], volumes: [], networks: [], bindings: {} }, async (root) => {
    const open = join(root, 'pgpass-open');
    await writeFile(open, '', { mode: 0o644 });
    assert.throws(() => startTarget(ID, { passfile: open }), /private \(0600\)/);
  });
  await withDocker({ containers: [], volumes: [`${ID}-db`], networks: [], bindings: {} }, async (root) => {
    const passfile = join(root, 'pgpass');
    await writeFile(passfile, '', { mode: 0o600 });
    assert.throws(() => startTarget(ID, { passfile }), /already exists/);
  });
  await withDocker({ containers: [], volumes: [], networks: [], bindings: {}, runBindings: binding('0.0.0.0', '51701'), port: '0.0.0.0:51701' }, async (root, calls) => {
    const passfile = join(root, 'pgpass');
    await writeFile(passfile, '', { mode: 0o600 });
    assert.throws(() => startTarget(ID, { passfile }), /publishes ports beyond this machine/);
    // Refused right after the database was created: no setup, no migration job, nothing in the passfile.
    assert.ok(!(await calls()).some((c) => c.args[0] === 'exec' || c.args[1] === '--rm'));
    assert.equal(await readFile(passfile, 'utf8'), '');
  });
});

test('down removes exactly the run\'s labelled resources, never prunes, and fails if any remain', async () => {
  await withDocker({ containers: ['c-db'], volumes: [`${ID}-db`], networks: [ID], bindings: {} }, async (_, calls) => {
    removeTarget(ID);
    const all = (await calls()).map((c) => c.args.join(' '));
    assert.ok(all.includes('rm -f -v c-db'));
    assert.ok(all.includes(`volume rm ${ID}-db`));
    assert.ok(all.includes(`network rm ${ID}`));
    assert.ok(all.every((c) => !/\bprune\b/.test(c)));
    assert.ok(all.filter((c) => /^(ps|volume ls|network ls)/.test(c)).every((c) => c.includes(`--filter label=com.boka.rehearsal=${ID}`)));
  });
  await withDocker({ containers: ['c-db'], volumes: [], networks: [], bindings: {}, keepContainers: true }, async () => {
    assert.throws(() => removeTarget(ID), /still has 1 container/);
  });
});
