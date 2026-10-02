import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUser, completeProfile, connect, createAccount, createMember,
  expectRefused, grantRole, resetSchema, type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
let db: Client;
let owner: TestAccount;
let newMember: TestAccount;
let incomplete: TestAccount;
let citizen: TestAccount;
let existingSzsMember: string;

async function prepare(account: TestAccount, service: string, role: string, member: string | null = null) {
  return asUser(db, owner.userId, async (c) => {
    const result = await c.query<{ owner_prepare_service_member: string }>(
      'select public.owner_prepare_service_member($1, $2, $3, $4)',
      [account.userId, service, role, member],
    );
    return result.rows[0]!.owner_prepare_service_member;
  });
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
  owner = await createAccount(db, 'prepare-owner@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik');
  await grantRole(db, owner.userId, 'OWNER');
  await createMember(db, 'Vlasnik', owner.userId);

  newMember = await createAccount(db, 'prepare-member@example.invalid');
  await completeProfile(db, newMember.userId, 'Ana Test');
  incomplete = await createAccount(db, 'prepare-incomplete@example.invalid');
  citizen = await createAccount(db, 'prepare-citizen@example.invalid');
  await completeProfile(db, citizen.userId, 'Gradjanin');

  const { rows } = await db.query<{ id: string }>(
    'insert into public.members(organization_id, full_name) values ($1, $2) returning id',
    [SZS, 'Ana SZS'],
  );
  existingSzsMember = rows[0]!.id;
});
afterAll(async () => { await db?.end(); });

describe('owner prepares a service member in one transaction', () => {
  it('creates a DVD roster row and grants a role, then links an existing SZS row', async () => {
    const dvdMember = await prepare(newMember, 'DVD', 'FIREFIGHTER');
    const repeated = await prepare(newMember, 'DVD', 'FIREFIGHTER', dvdMember);
    expect(repeated).toBe(dvdMember);
    const szsMember = await prepare(newMember, 'SZS', 'COMMANDER', existingSzsMember);
    expect(szsMember).toBe(existingSzsMember);

    const { rows: members } = await db.query(
      'select organization_id, user_id from public.members where user_id = $1', [newMember.userId],
    );
    expect(members).toHaveLength(2);
    expect(members.map((row) => row.organization_id).sort()).toEqual([DVD, SZS]);
    const { rows: roles } = await db.query(
      `select organization_id, role from public.organization_memberships
       where user_id = $1 and active order by organization_id`, [newMember.userId],
    );
    expect(roles).toMatchObject([
      { organization_id: DVD, role: 'FIREFIGHTER' },
      { organization_id: SZS, role: 'COMMANDER' },
    ]);
    const { rows: audit } = await db.query(
      `select count(*)::int as total from public.organization_membership_audit
       where target_user_id = $1`, [newMember.userId],
    );
    expect(audit[0]?.total).toBe(2);
  });

  it('rejects incomplete and unauthorised accounts without partial rows', async () => {
    expect(await expectRefused(db, owner.userId, (c) => c.query(
      'select public.owner_prepare_service_member($1, $2, $3, $4)',
      [incomplete.userId, 'DVD', 'FIREFIGHTER', null],
    ))).toContain('PROFILE_REQUIRED');
    expect(await expectRefused(db, citizen.userId, (c) => c.query(
      'select public.owner_prepare_service_member($1, $2, $3, $4)',
      [citizen.userId, 'DVD', 'FIREFIGHTER', null],
    ))).toContain('OWNER_REQUIRED');
    expect(await expectRefused(db, owner.userId, (c) => c.query(
      'select public.owner_prepare_service_member($1, $2, $3, $4)',
      [citizen.userId, 'DVD', 'FIREFIGHTER', existingSzsMember],
    ))).toContain('ORGANIZATION_MISMATCH');
    const { rows } = await db.query(
      'select id from public.members where user_id = $1 or full_name = $2',
      [incomplete.userId, 'Gradjanin'],
    );
    expect(rows).toHaveLength(0);
    const { rows: grants } = await db.query(
      'select id from public.organization_memberships where user_id in ($1, $2)',
      [incomplete.userId, citizen.userId],
    );
    expect(grants).toHaveLength(0);
  });
});
