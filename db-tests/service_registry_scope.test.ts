/**
 * P6: changing the acting service cannot expose the other service's registry.
 *
 * This is the no-leak property, proven against real row-level security. There are
 * two layers, and both are shown here:
 *
 *   - For a SINGLE-service admin, the SERVER refuses the other service outright:
 *     the policy `is_staff_in(organization_id)` is false there, so the read is
 *     empty whatever the client asks for. The belt.
 *   - For a DUAL-service admin and the installation owner, the server legitimately
 *     returns BOTH services' rows (they are staff in both) - so an UNFILTERED read
 *     returns everything, and it is the client's `where organization_id = …` filter
 *     that isolates the acting service. This test proves the filtered read returns
 *     exactly one service while the unfiltered read returns both, so the filter is
 *     load-bearing and is doing its job. The braces.
 *
 * These are the exact reads loadRoster / loadGroups / loadVehicles issue; that they
 * carry the filter is pinned in src/auth/roster.service.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  asUser,
  completeProfile,
  connect,
  createAccount,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

let db: Client;
let dvdAdmin: TestAccount;
let szsAdmin: TestAccount;
let dualAdmin: TestAccount;
let owner: TestAccount;

async function addSzsMembership(userId: string, role: string): Promise<void> {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active, granted_by, granted_at)
     values ($1, $2, $3, true, $2, now())
     on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
    [SZS, userId, role],
  );
}

async function seedRegistry(organizationId: string, tag: string): Promise<void> {
  await db.query(
    `insert into public.members(full_name, organization_id) values ($1, $2)`,
    [`${tag} Clan`, organizationId],
  );
  await db.query(`insert into public.groups(name, organization_id) values ($1, $2)`, [
    `${tag} Ekipa`,
    organizationId,
  ]);
  await db.query(
    `insert into public.vehicles(callsign, name, kind, organization_id) values ($1, $2, $3, $4)`,
    [`${tag}-1`, `${tag} Vozilo`, 'navalno', organizationId],
  );
}

// The exact reads the client adapters issue, as the given authenticated user.
const readMembers = (account: TestAccount, org?: string) =>
  asUser(db, account.userId, async (c) => {
    const sql = `select full_name from public.members${org ? ' where organization_id = $1' : ''}`;
    const { rows } = await c.query<{ full_name: string }>(sql, org ? [org] : []);
    return rows.map((r) => r.full_name).sort();
  });
const readGroups = (account: TestAccount, org?: string) =>
  asUser(db, account.userId, async (c) => {
    const sql = `select name from public.groups${org ? ' where organization_id = $1' : ''}`;
    const { rows } = await c.query<{ name: string }>(sql, org ? [org] : []);
    return rows.map((r) => r.name).sort();
  });
const readVehicles = (account: TestAccount, org?: string) =>
  asUser(db, account.userId, async (c) => {
    const sql = `select callsign from public.vehicles${org ? ' where organization_id = $1' : ''}`;
    const { rows } = await c.query<{ callsign: string }>(sql, org ? [org] : []);
    return rows.map((r) => r.callsign).sort();
  });

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  await seedRegistry(DVD, 'DVD');
  await seedRegistry(SZS, 'SZS');

  dvdAdmin = await createAccount(db, 'dvd-admin@example.invalid');
  await completeProfile(db, dvdAdmin.userId, 'DVD Administrator');
  await grantRole(db, dvdAdmin.userId, 'ADMIN');

  szsAdmin = await createAccount(db, 'szs-admin@example.invalid');
  await completeProfile(db, szsAdmin.userId, 'SZS Administrator');
  await addSzsMembership(szsAdmin.userId, 'ADMIN');

  dualAdmin = await createAccount(db, 'dual-admin@example.invalid');
  await completeProfile(db, dualAdmin.userId, 'Dvojni Administrator');
  await grantRole(db, dualAdmin.userId, 'ADMIN');
  await addSzsMembership(dualAdmin.userId, 'ADMIN');

  owner = await createAccount(db, 'owner-admin@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik Sistema');
  await grantRole(db, owner.userId, 'OWNER');
});

afterAll(async () => {
  await db.end();
});

describe('a single-service admin is refused the other service by the server itself', () => {
  it('DVD admin: sees DVD registry, and the SERVER returns nothing for SZS', async () => {
    expect(await readMembers(dvdAdmin, DVD)).toEqual(['DVD Clan']);
    expect(await readGroups(dvdAdmin, DVD)).toEqual(['DVD Ekipa']);
    expect(await readVehicles(dvdAdmin, DVD)).toEqual(['DVD-1']);
    // The other service is empty even when explicitly asked for: RLS, not the UI.
    expect(await readMembers(dvdAdmin, SZS)).toEqual([]);
    expect(await readGroups(dvdAdmin, SZS)).toEqual([]);
    expect(await readVehicles(dvdAdmin, SZS)).toEqual([]);
    // And an unfiltered read still yields only DVD - there is nothing else to see.
    expect(await readMembers(dvdAdmin)).toEqual(['DVD Clan']);
  });

  it('SZS admin: sees SZS registry, and the SERVER returns nothing for DVD', async () => {
    expect(await readMembers(szsAdmin, SZS)).toEqual(['SZS Clan']);
    expect(await readVehicles(szsAdmin, SZS)).toEqual(['SZS-1']);
    expect(await readMembers(szsAdmin, DVD)).toEqual([]);
    expect(await readVehicles(szsAdmin, DVD)).toEqual([]);
    expect(await readMembers(szsAdmin)).toEqual(['SZS Clan']);
  });
});

describe('a dual-service admin: the acting-service filter is what isolates', () => {
  it('sees BOTH services unfiltered, but exactly one per acting service', async () => {
    // The server allows both, because a dual admin is staff in both.
    expect(await readMembers(dualAdmin)).toEqual(['DVD Clan', 'SZS Clan']);
    // Acting as DVD: only DVD. Acting as SZS: only SZS. Neither leaks the other.
    expect(await readMembers(dualAdmin, DVD)).toEqual(['DVD Clan']);
    expect(await readMembers(dualAdmin, SZS)).toEqual(['SZS Clan']);
    expect(await readGroups(dualAdmin, DVD)).toEqual(['DVD Ekipa']);
    expect(await readGroups(dualAdmin, SZS)).toEqual(['SZS Ekipa']);
    expect(await readVehicles(dualAdmin, DVD)).toEqual(['DVD-1']);
    expect(await readVehicles(dualAdmin, SZS)).toEqual(['SZS-1']);
  });
});

describe('the installation owner: administers both, filter still isolates', () => {
  it('sees both unfiltered, and exactly one per acting service', async () => {
    expect(await readMembers(owner)).toEqual(['DVD Clan', 'SZS Clan']);
    expect(await readMembers(owner, DVD)).toEqual(['DVD Clan']);
    expect(await readMembers(owner, SZS)).toEqual(['SZS Clan']);
    expect(await readVehicles(owner, DVD)).toEqual(['DVD-1']);
    expect(await readVehicles(owner, SZS)).toEqual(['SZS-1']);
  });
});
