/**
 * TCP reachability check for Supabase's connection pooler, with no credentials
 * and no data. It opens a socket, waits for the server's first bytes (the
 * PostgreSQL handshake expects the client to speak first, so "connected, no
 * banner" is the normal success), and closes. It never sends a startup packet,
 * a password, or a query.
 *
 *   node scripts/restored-capture/reachability.mjs <host> <port> [<port> ...]
 *
 * Use it from a cloud runner that WILL run the dump (a GitHub Actions job or a
 * Codespace) to confirm the network path before wiring up the credential. This
 * repository's own Claude cloud session cannot run it usefully: its egress
 * proxy carries HTTPS only, so a raw PostgreSQL port is unreachable from there
 * by design - which is the whole reason the dump runs on a different runner.
 */

import net from 'node:net';

function probe(host, port, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, ok, detail, ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true, 'TCP connect ok'));
    socket.once('timeout', () => done(false, `no connection within ${timeoutMs}ms`));
    socket.once('error', (err) => done(false, err.code || err.message));
    socket.connect(port, host);
  });
}

const [, , host, ...ports] = process.argv;
if (!host || ports.length === 0) {
  console.error('usage: node reachability.mjs <host> <port> [<port> ...]');
  process.exit(2);
}

const results = await Promise.all(ports.map((p) => probe(host, Number(p))));
let allOk = true;
for (const r of results) {
  const mode = r.port === '6543' || r.port === 6543 ? 'transaction pooler' : r.port === '5432' || r.port === 5432 ? 'session pooler' : 'port';
  console.log(`${r.ok ? 'REACHABLE  ' : 'UNREACHABLE'} ${host}:${r.port} (${mode}) - ${r.detail}, ${r.ms}ms`);
  if (!r.ok) allOk = false;
}
console.log(allOk ? 'All probed pooler ports are reachable from this runner.' : 'At least one pooler port is NOT reachable from this runner.');
process.exit(allOk ? 0 : 1);
