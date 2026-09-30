/**
 * Local operator entry point. Only the non-secret Supabase database host is
 * echoed; the existing DB password is read from the terminal without echo and
 * handed to the private backup/restore/gate process through its environment.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { sourceUrl } from './p4-capture-production.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = 'yskhdzrdbywrpfowckpn';

function hiddenPassword() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run this in a local terminal. The password cannot be safely read from redirected input.');
  }
  process.stdout.write('Postojeca Supabase DB lozinka (ne prikazuje se): ');
  return new Promise((done, reject) => {
    let password = '';
    const decoder = new StringDecoder('utf8');
    const finish = (error) => {
      process.stdin.off('data', input);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else done(password);
    };
    const input = (chunk) => {
      for (const char of decoder.write(chunk)) {
        if (char === '\r' || char === '\n') return finish(password ? null : new Error('Empty password.'));
        if (char === '\u0003') return finish(new Error('Cancelled.'));
        if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
        else password += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', input);
  });
}

async function main() {
  const [backupDir, recipient] = process.argv.slice(2);
  if (!backupDir || !recipient) throw new Error('Usage: npm run release:preflight -- /absolute/backup/directory age1PUBLIC_RECIPIENT');
  const check = spawn('bash', ['scripts/release-preflight.sh', 'check'], { cwd: repo, stdio: 'inherit' });
  if (await new Promise((done) => check.on('exit', done)) !== 0) throw new Error('Install the missing free local tools first.');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let host;
  try {
    host = (await rl.question('Supabase DB host iz Connect prozora (bez lozinke): ')).trim();
  } finally {
    rl.close();
  }
  const direct = host === `db.${ref}.supabase.co`;
  if (!direct && !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host)) {
    throw new Error('Host must be the DVD Tivat direct or session-pooler host.');
  }
  const password = await hiddenPassword();
  const url = new URL(`postgresql://${direct ? 'postgres' : `postgres.${ref}`}@${host}:5432/postgres`);
  url.password = password;
  sourceUrl(url.toString());

  const child = spawn('bash', ['scripts/release-preflight.sh', 'run'], {
    cwd: repo,
    stdio: 'inherit',
    env: {
      ...process.env,
      DVD_PRODUCTION_DB_URL: url.toString(),
      DVD_BACKUP_DIR: backupDir,
      DVD_BACKUP_RECIPIENT: recipient,
    },
  });
  const code = await new Promise((done) => child.on('exit', done));
  if (code !== 0) process.exitCode = code ?? 1;
}

main().catch((error) => {
  // The local CLI never prints a connection URL or password on failure.
  console.error(error.message);
  process.exitCode = 1;
});
