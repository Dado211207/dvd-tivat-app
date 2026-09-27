/**
 * P6: authority is resolved per service, from stored rows, by the server.
 *
 * The client's acting-service selection only chooses WHICH service to ask the
 * server about (`current_role_in`, `current_member_id_in`). These tests prove the
 * server's answers are the ones the client relies on, against real row-level
 * security and a real PostgreSQL:
 *
 *   - an SZS-only member reaches the SZS role with NO DVD membership;
 *   - asking about a service you do not serve returns NULL, never a borrowed role,
 *     so a client that selects the wrong service is refused by the database, not
 *     by the interface;
 *   - the DVD shims are exactly `*_in(DVD)`, so the DVD-only path is unchanged;
 *   - the installation owner is OWNER in both services with no membership, and has
 *     no member record in either until one is linked;
 *   - suspension is account-wide: it removes the role in every service at once.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  asUser,
  completeProfile,
  connect,
  createAccount,
  createMember,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

let db: Client;

// The personas, built once and committed so the per-test transactions can read
// them back as the authenticated user.
let dvdOnly: TestAccount;
let szsOnly: TestAccount;
let dual: TestAccount;
let owner: TestAccount;
let suspended: TestAccount;

let dvdOnlyMember: string;
let szsOnlyMember: string;
let dualDvdMember: string;
let dualSzsMember: string;

async function addSzsMembership(userId: string, role: string): Promise<void> {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active, granted_by, granted_at)
     values ($1, $2, $3, true, $2, now())
     on conflict (organization_id, user_id) do update
       set role = excluded.role, active = true, granted_at = now()`,
    [SZS, userId, role],
  );
}

async function addMemberIn(organizationId: string, fullName: string, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3) returning id`,
    [fullName, userId, organizationId],
  );
  return rows[0]!.id;
}

const roleIn = (account: TestAccount, org: string) =>
  asUser(db, account.userId, async (c) =>
    (await c.query<{ r: string | null }>(`select public.current_role_in($1) as r`, [org])).rows[0]!.r,
  );
const memberIdIn = (account: TestAccount, org: string) =>
  asUser(db, account.userId, async (c) =>
    (await c.query<{ m: string | null }>(`select public.current_member_id_in($1) as m`, [org])).rows[0]!.m,
  );
const dvdRoleShim = (account: TestAccount) =>
  asUser(db, account.userId, async (c) =>
    (await c.query<{ r: string | null }>(`select public.current_dvd_role() as r`)).rows[0]!.r,
  );
const dvdMemberShim = (account: TestAccount) =>
  asUser(db, account.userId, async (c) =>
    (await c.query<{ m: string | null }>(`select public.current_member_id() as m`)).rows[0]!.m,
  );

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  dvdOnly = await createAccount(db, 'dvd-only@example.invalid');
  await completeProfile(db, dvdOnly.userId, 'DVD Vatrogasac');
  await grantRole(db, dvdOnly.userId, 'FIREFIGHTER'); // writes the DVD membership
  dvdOnlyMember = await createMember(db, 'DVD Vatrogasac', dvdOnly.userId); // DVD by default

  szsOnly = await createAccount(db, 'szs-only@example.invalid');
  await completeProfile(db, szsOnly.userId, 'SZS Spasilac');
  // No DVD membership at all - the CITIZEN grant stays. Authority comes from SZS.
  await addSzsMembership(szsOnly.userId, 'FIREFIGHTER');
  szsOnlyMember = await addMemberIn(SZS, 'SZS Spasilac', szsOnly.userId);

  dual = await createAccount(db, 'dual@example.invalid');
  await completeProfile(db, dual.userId, 'Dvojna Sluzba');
  await grantRole(db, dual.userId, 'COMMANDER'); // DVD COMMANDER membership
  dualDvdMember = await createMember(db, 'Dvojna Sluzba', dual.userId); // DVD member
  await addSzsMembership(dual.userId, 'ADMIN'); // SZS ADMIN membership
  dualSzsMember = await addMemberIn(SZS, 'Dvojna Sluzba', dual.userId); // SZS member

  owner = await createAccount(db, 'owner@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik Sistema');
  await grantRole(db, owner.userId, 'OWNER'); // OWNER grant, no membership row

  suspended = await createAccount(db, 'suspended@example.invalid');
  await completeProfile(db, suspended.userId, 'Ukinuti Nalog');
  await grantRole(db, suspended.userId, 'COMMANDER');
  await addSzsMembership(suspended.userId, 'ADMIN');
  // Suspend the ACCOUNT (the grant), leaving both memberships active.
  await db.query(`update public.access_grants set active = false where user_id = $1`, [
    suspended.userId,
  ]);
});

afterAll(async () => {
  await db.end();
});

describe('a DVD-only member', () => {
  it('has the DVD role, and no role in SZS', async () => {
    expect(await roleIn(dvdOnly, DVD)).toBe('FIREFIGHTER');
    expect(await roleIn(dvdOnly, SZS)).toBeNull();
  });

  it('has a DVD member record and none in SZS', async () => {
    expect(await memberIdIn(dvdOnly, DVD)).toBe(dvdOnlyMember);
    expect(await memberIdIn(dvdOnly, SZS)).toBeNull();
  });

  it('resolves the DVD shims to exactly current_role_in(DVD) / current_member_id_in(DVD)', async () => {
    expect(await dvdRoleShim(dvdOnly)).toBe(await roleIn(dvdOnly, DVD));
    expect(await dvdMemberShim(dvdOnly)).toBe(await memberIdIn(dvdOnly, DVD));
  });
});

describe('an SZS-only member (no DVD membership)', () => {
  it('reaches the SZS role without any DVD membership', async () => {
    expect(await roleIn(szsOnly, SZS)).toBe('FIREFIGHTER');
    expect(await memberIdIn(szsOnly, SZS)).toBe(szsOnlyMember);
  });

  it('is refused a role in DVD - selecting DVD borrows nothing', async () => {
    expect(await roleIn(szsOnly, DVD)).toBeNull();
    expect(await memberIdIn(szsOnly, DVD)).toBeNull();
    // And the DVD shim, which is current_*_in(DVD), agrees: no DVD authority.
    expect(await dvdRoleShim(szsOnly)).toBeNull();
    expect(await dvdMemberShim(szsOnly)).toBeNull();
  });
});

describe('a dual-service member', () => {
  it('has a distinct role in each service', async () => {
    expect(await roleIn(dual, DVD)).toBe('COMMANDER');
    expect(await roleIn(dual, SZS)).toBe('ADMIN');
  });

  it('has a distinct member record in each service', async () => {
    const inDvd = await memberIdIn(dual, DVD);
    const inSzs = await memberIdIn(dual, SZS);
    expect(inDvd).toBe(dualDvdMember);
    expect(inSzs).toBe(dualSzsMember);
    expect(inDvd).not.toBe(inSzs);
  });
});

describe('the installation owner', () => {
  it('is OWNER in both services with no membership row', async () => {
    expect(await roleIn(owner, DVD)).toBe('OWNER');
    expect(await roleIn(owner, SZS)).toBe('OWNER');
  });

  it('has no member record in either service until one is linked', async () => {
    expect(await memberIdIn(owner, DVD)).toBeNull();
    expect(await memberIdIn(owner, SZS)).toBeNull();
  });
});

describe('suspension is account-wide', () => {
  it('removes the role in every service at once, whatever the memberships say', async () => {
    expect(await roleIn(suspended, DVD)).toBeNull();
    expect(await roleIn(suspended, SZS)).toBeNull();
    expect(await memberIdIn(suspended, DVD)).toBeNull();
    expect(await memberIdIn(suspended, SZS)).toBeNull();
  });
});
