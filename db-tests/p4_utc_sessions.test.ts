/**
 * The P4 capture and gate must not depend on the server's time zone.
 *
 * Their digests render timestamptz as text, which follows the session time
 * zone. A local server initialised on the operator's Mac takes the Mac's zone;
 * Supabase runs in UTC. Before every capture and gate session was pinned to UTC,
 * an exact copy restored on such a server failed the gate ("rows, per table -
 * 7/32 identical"). Here the database's own default is set to two zones far
 * from UTC and the real capture SQL is run through the real session setups.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg, { type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_URL, completeProfile, connect, createAccount, createDraft, createMember, grantRole, resetSchema } from './harness';

interface GateDatabase {
  Databases: new (adminUrl: URL) => { connect(name: string): Promise<Client> };
}
interface Capture {
  CAPTURE_SESSION: string;
}
interface RestoredCapture {
  connect(url: string, database?: string | null): Promise<Client>;
}
const load = async <T>(file: string) => (await import(pathToFileURL(resolve(process.cwd(), file)).href)) as T;

const CAPTURE_SQL = readFileSync(resolve(process.cwd(), 'scripts/p4-equivalence-production.sql'), 'utf8');
const DB = `p4_utc_${process.pid}`;
const ZONES = ['Pacific/Kiritimati', 'America/Adak'];

let admin: Client;

function databaseUrl(): string {
  const url = new URL(DATABASE_URL);
  url.pathname = `/${DB}`;
  return url.toString();
}

async function setDefaultZone(zone: string): Promise<void> {
  await admin.query(`alter database ${DB} set timezone = '${zone}'`);
}

type Row = Record<string, unknown>;
const digests = (row: Row) => JSON.stringify([row.schema_fingerprint, row.export_digest, row.behaviour_digest]);
const lastRow = (result: unknown): Row => {
  const last = Array.isArray(result) ? result.at(-1) : result;
  return (last as { rows: Row[] }).rows[0]!;
};

async function captureWith(open: () => Promise<Client>, setup: string | null): Promise<{ zone: string; digests: string }> {
  const client = await open();
  try {
    if (setup) await client.query(setup);
    const { rows } = await client.query<{ zone: string }>(`select current_setting('TimeZone') as zone`);
    return { zone: rows[0]!.zone, digests: digests(lastRow(await client.query(CAPTURE_SQL))) };
  } finally {
    await client.end();
  }
}

describe('P4 capture and gate sessions run in UTC whatever the server default', () => {
  beforeAll(async () => {
    admin = await connect();
    await admin.query(`drop database if exists ${DB} with (force)`);
    await admin.query(`create database ${DB}`);
    const db = new pg.Client({ connectionString: databaseUrl() });
    await db.connect();
    try {
      await resetSchema(db);
      // Rows with timestamps in several tables, made the way the app makes them.
      const owner = await createAccount(db, 'utc-owner@example.test');
      await completeProfile(db, owner.userId, 'Owner Utc');
      await grantRole(db, owner.userId, 'OWNER');
      const commander = await createAccount(db, 'utc-cmd@example.test');
      await completeProfile(db, commander.userId, 'Commander Utc');
      await grantRole(db, commander.userId, 'COMMANDER');
      await createMember(db, 'Commander Utc', commander.userId);
      await createDraft(db, commander.userId);
    } finally {
      await db.end();
    }
  });

  afterAll(async () => {
    await admin.query(`drop database if exists ${DB} with (force)`);
    await admin.end();
  });

  it('the production capture session gives the same digests under any default zone', async () => {
    const { CAPTURE_SESSION } = await load<Capture>('scripts/p4-capture-production.mjs');
    const open = async () => {
      const client = new pg.Client({ connectionString: databaseUrl() });
      await client.connect();
      return client;
    };
    const pinned: string[] = [];
    const unpinned: string[] = [];
    for (const zone of ZONES) {
      await setDefaultZone(zone);
      const withPin = await captureWith(open, CAPTURE_SESSION);
      expect(withPin.zone).toBe('UTC');
      pinned.push(withPin.digests);
      // Control: the session setup the capture used before the pin.
      const without = await captureWith(open, 'set default_transaction_read_only = on; set statement_timeout = 120000');
      expect(without.zone).toBe(zone);
      unpinned.push(without.digests);
    }
    expect(unpinned[0]).not.toBe(unpinned[1]); // the zone really does change the digests...
    expect(pinned[0]).toBe(pinned[1]); // ...and the pin removes that dependence.
  }, 120_000); // runs the full capture SQL four times; the 30s default is too tight, more so on CI.

  it('the gate and the restored-copy capture open UTC sessions with the same digests', async () => {
    const { Databases } = await load<GateDatabase>('scripts/p4-gate/database.mjs');
    const { connect: restoredConnect } = await load<RestoredCapture>('scripts/p4-restored-capture.mjs');
    const { CAPTURE_SESSION } = await load<Capture>('scripts/p4-capture-production.mjs');
    const gate = new Databases(new URL(DATABASE_URL));
    const seen = new Set<string>();
    for (const zone of ZONES) {
      await setDefaultZone(zone);
      const viaGate = await captureWith(() => gate.connect(DB), null);
      const viaRestored = await captureWith(() => restoredConnect(DATABASE_URL, DB), null);
      expect([viaGate.zone, viaRestored.zone]).toEqual(['UTC', 'UTC']);
      seen.add(viaGate.digests).add(viaRestored.digests);
    }
    // One digest set across both zones and all three session setups.
    const production = await captureWith(async () => {
      const client = new pg.Client({ connectionString: databaseUrl() });
      await client.connect();
      return client;
    }, CAPTURE_SESSION);
    seen.add(production.digests);
    expect(seen.size).toBe(1);
  }, 120_000);
});
