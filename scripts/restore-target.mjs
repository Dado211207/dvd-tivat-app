/**
 * The local restore target for release-preflight.sh: a fresh Postgres for one
 * run, reachable from this machine only.
 *
 * Supabase CLI's `supabase start` publishes every port on all interfaces and
 * cannot be told otherwise, so a restored production copy would be reachable
 * from the network. This starts the same images Supabase CLI 2.119.0 pins -
 * the database, published on 127.0.0.1 only, then the storage and auth
 * migration jobs the CLI itself runs, unpublished - on a network, volume and
 * containers labelled with the run's id, so cleanup removes exactly those.
 *
 *   node scripts/restore-target.mjs up <stack-id>      start; print the loopback port
 *   node scripts/restore-target.mjs check <stack-id>   refuse any port published beyond loopback
 *   node scripts/restore-target.mjs down <stack-id>    remove this run's containers, volumes, network
 *
 * `up` appends the database password to PGPASSFILE (127.0.0.1:<port>) and never
 * prints it; Docker receives it only through the environment (`-e NAME`).
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGES = {
  db: 'public.ecr.aws/supabase/postgres:17.11.0.002',
  auth: 'public.ecr.aws/supabase/gotrue:v2.197.0',
  storage: 'public.ecr.aws/supabase/storage-api:v1.79.28',
};
export const LABEL = 'com.boka.rehearsal';
export const STACK_ID = /^boka-restore-\d{14}-\d+$/;
const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Published bindings that reach beyond this machine. An empty host IP means every interface. */
export function exposedBindings(bindings) {
  return bindings.filter(({ hostIp }) => !LOOPBACK.has(hostIp ?? ''));
}

function docker(args, { env = {}, input } = {}) {
  const r = spawnSync('docker', args, { env: { ...process.env, ...env }, input, encoding: 'utf8' });
  if (r.status !== 0) {
    const detail = (r.stderr || r.error?.message || '').trim().split('\n').slice(-2).join(' | ');
    throw new Error(`docker ${args[0]} ${args[1] ?? ''} failed: ${detail.replace(/postgres(ql)?:\/\/\S+/g, '<url>')}`);
  }
  return r.stdout.trim();
}

const byLabel = (stackId, kind) => {
  const filter = ['--filter', `label=${LABEL}=${stackId}`];
  const out = kind === 'container' ? docker(['ps', '-aq', ...filter])
    : docker([kind, 'ls', '-q', ...filter]);
  return out ? out.split('\n') : [];
};

/** Every port any container of this run asks for or has: refuses anything but loopback. */
export function checkBindings(stackId) {
  const containers = byLabel(stackId, 'container');
  if (containers.length === 0) throw new Error(`restore target ${stackId} has no containers`);
  const bindings = [];
  for (const line of docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}', ...containers]).split('\n')) {
    for (const part of line.split('|')) {
      for (const list of Object.values(JSON.parse(part) ?? {})) {
        for (const b of list ?? []) bindings.push({ hostIp: b.HostIp, hostPort: b.HostPort });
      }
    }
  }
  const unique = [...new Map(bindings.map((b) => [`${b.hostIp}|${b.hostPort}`, b])).values()];
  const exposed = exposedBindings(unique);
  if (exposed.length) {
    throw new Error(`restore target ${stackId} publishes ports beyond this machine: ${exposed.map((b) => `${b.hostIp || '(all interfaces)'}:${b.hostPort}`).join(' ')}`);
  }
  return unique;
}

/** Removes exactly this run's containers, volumes and network; nothing is pruned. */
export function removeTarget(stackId) {
  const containers = byLabel(stackId, 'container');
  if (containers.length) docker(['rm', '-f', '-v', ...containers]);
  const volumes = byLabel(stackId, 'volume');
  if (volumes.length) docker(['volume', 'rm', ...volumes]);
  const networks = byLabel(stackId, 'network');
  if (networks.length) docker(['network', 'rm', ...networks]);
  const left = ['container', 'volume', 'network'].map((k) => [k, byLabel(stackId, k).length]).filter(([, n]) => n > 0);
  if (left.length) throw new Error(`restore target ${stackId} still has ${left.map(([k, n]) => `${n} ${k}(s)`).join(', ')}`);
}

/** Starts the target; returns the loopback port. */
export function startTarget(stackId, { passfile = process.env.PGPASSFILE } = {}) {
  if (!passfile || (statSync(passfile).mode & 0o077) !== 0) throw new Error('PGPASSFILE must name an existing private (0600) file.');
  for (const kind of ['container', 'volume', 'network']) {
    if (byLabel(stackId, kind).length) throw new Error(`restore target ${stackId} already exists`);
  }
  const label = ['--label', `${LABEL}=${stackId}`];
  const password = randomBytes(24).toString('hex');
  const jwtSecret = randomBytes(32).toString('hex');
  docker(['network', 'create', ...label, stackId]);
  docker(['volume', 'create', ...label, `${stackId}-db`]);
  docker(['run', '-d', '--name', `${stackId}-db`, ...label, '--network', stackId, '--network-alias', 'db',
    '-p', '127.0.0.1::5432', '-v', `${stackId}-db:/var/lib/postgresql/data`,
    '-e', 'POSTGRES_PASSWORD', '-e', 'JWT_SECRET', '-e', 'JWT_EXP', IMAGES.db],
  { env: { POSTGRES_PASSWORD: password, JWT_SECRET: jwtSecret, JWT_EXP: '3600' } });
  checkBindings(stackId);

  const deadline = Date.now() + 120_000;
  while (spawnSync('docker', ['exec', `${stackId}-db`, 'pg_isready', '-q', '-U', 'postgres', '-h', 'localhost']).status !== 0) {
    if (Date.now() > deadline) throw new Error(`restore target ${stackId} did not become ready`);
    spawnSync('sleep', ['1']);
  }
  // The roles the migration jobs log in as, and the realtime platform role and
  // grant a Supabase-started stack has (the roles dump repeats that grant).
  docker(['exec', '-i', '-e', 'RESTORE_DB_PASSWORD', `${stackId}-db`, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], {
    env: { RESTORE_DB_PASSWORD: password },
    input: [
      '\\getenv pw RESTORE_DB_PASSWORD',
      ...['postgres', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin'].map((r) => `alter user ${r} with password :'pw';`),
      "do $$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then create role supabase_realtime_admin noinherit nologin noreplication; end if; end $$;",
      'grant set on parameter log_min_messages to supabase_realtime_admin;',
    ].join('\n'),
  });
  const db = (role) => `postgres://${role}:${password}@db:5432/postgres`;
  const job = (image, env, cmd) => docker(['run', '--rm', ...label, '--network', stackId, ...Object.keys(env).flatMap((k) => ['-e', k]), image, ...cmd], { env });
  // The jobs Supabase CLI runs to create the storage and auth schemas; never published.
  job(IMAGES.storage, {
    DB_INSTALL_ROLES: 'false', ANON_KEY: 'rehearsal', SERVICE_KEY: 'rehearsal', PGRST_JWT_SECRET: jwtSecret,
    DATABASE_URL: db('supabase_storage_admin'), FILE_SIZE_LIMIT: '52428800', STORAGE_BACKEND: 'file',
    STORAGE_FILE_BACKEND_PATH: '/mnt', TENANT_ID: 'stub', REGION: 'stub', GLOBAL_S3_BUCKET: 'stub',
  }, ['node', 'dist/scripts/migrate-call.js']);
  job(IMAGES.auth, {
    API_EXTERNAL_URL: 'http://127.0.0.1:9/auth/v1', GOTRUE_LOG_LEVEL: 'error', GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: db('supabase_auth_admin'), GOTRUE_SITE_URL: 'http://127.0.0.1:9', GOTRUE_JWT_SECRET: jwtSecret,
  }, ['gotrue', 'migrate']);

  const published = docker(['port', `${stackId}-db`, '5432/tcp']).split('\n');
  const match = published.length === 1 && published[0].match(/^127\.0\.0\.1:(\d+)$/);
  if (!match) throw new Error(`restore target ${stackId} is not published on 127.0.0.1 only: ${published.join(' ')}`);
  checkBindings(stackId);
  appendFileSync(passfile, `127.0.0.1:${match[1]}:*:postgres:${password.replace(/[\\:]/g, (c) => `\\${c}`)}\n`);
  return Number(match[1]);
}

function main() {
  const [command, stackId] = process.argv.slice(2);
  if (!STACK_ID.test(stackId ?? '')) throw new Error('Usage: restore-target.mjs up|check|down boka-restore-<yyyymmddhhmmss>-<n>');
  if (command === 'up') console.log(startTarget(stackId));
  else if (command === 'check') console.log(`${checkBindings(stackId).length} published port(s), all on loopback`);
  else if (command === 'down') removeTarget(stackId);
  else throw new Error('Usage: restore-target.mjs up|check|down <stack-id>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
