import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUser, completeProfile, connect, createAccount, createMember,
  expectRefused, grantRole, resetSchema, type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
let db: Client;
let commander: TestAccount;
let firefighter: TestAccount;
let szsCommander: TestAccount;
let dual: TestAccount;
let szsFirefighter: TestAccount;
let citizen: TestAccount;

async function join(account: TestAccount, organizationId: string, role: string, name: string) {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, granted_by)
     values ($1, $2, $3, $2)`, [organizationId, account.userId, role],
  );
  await db.query(
    `insert into public.members(organization_id, full_name, user_id) values ($1, $2, $3)`,
    [organizationId, name, account.userId],
  );
}

async function addPush(account: TestAccount, suffix: string, status: 'ACTIVE' | 'REVOKED' | 'EXPIRED') {
  await db.query(
    `insert into public.web_push_subscriptions(
       user_id, endpoint, p256dh, auth_secret, revoked_at, expiration_time)
     values ($1, $2, $3, $4, $5, $6)`,
    [account.userId, `https://push.example.invalid/device/${suffix}`, 'a'.repeat(45),
      'b'.repeat(12), status === 'REVOKED' ? new Date().toISOString() : null,
      status === 'EXPIRED' ? '2020-01-01T00:00:00Z' : null],
  );
}

async function readiness(account: TestAccount, own: boolean, other: string[] = [], publisher = DVD) {
  return asUser(db, account.userId, async (c) => {
    const result = await c.query<{
      eligible_count: number; push_ready_count: number; checked_at: Date;
    }>('select * from public.callout_readiness($1, $2, $3)', [publisher, own, other]);
    return result.rows[0]!;
  });
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  commander = await createAccount(db, 'preflight-dvd-cmd@example.invalid');
  await completeProfile(db, commander.userId, 'DVD Komandir');
  await grantRole(db, commander.userId, 'COMMANDER');
  await createMember(db, 'DVD Komandir', commander.userId);

  firefighter = await createAccount(db, 'preflight-dvd-ff@example.invalid');
  await completeProfile(db, firefighter.userId, 'DVD Vatrogasac');
  await grantRole(db, firefighter.userId, 'FIREFIGHTER');
  await createMember(db, 'DVD Vatrogasac', firefighter.userId);

  szsCommander = await createAccount(db, 'preflight-szs-cmd@example.invalid');
  await completeProfile(db, szsCommander.userId, 'SZS Komandir');
  await join(szsCommander, SZS, 'COMMANDER', 'SZS Komandir');

  dual = await createAccount(db, 'preflight-dual@example.invalid');
  await completeProfile(db, dual.userId, 'Dvojni Clan');
  await grantRole(db, dual.userId, 'FIREFIGHTER');
  await createMember(db, 'Dvojni Clan DVD', dual.userId);
  await join(dual, SZS, 'FIREFIGHTER', 'Dvojni Clan SZS');

  szsFirefighter = await createAccount(db, 'preflight-szs-ff@example.invalid');
  await completeProfile(db, szsFirefighter.userId, 'SZS Vatrogasac');
  await join(szsFirefighter, SZS, 'FIREFIGHTER', 'SZS Vatrogasac');

  citizen = await createAccount(db, 'preflight-citizen@example.invalid');
  await completeProfile(db, citizen.userId, 'Gradjanin');
  await addPush(firefighter, 'dvd-active', 'ACTIVE');
  await addPush(dual, 'dual-active', 'ACTIVE');
  await addPush(dual, 'dual-expired', 'EXPIRED');
  await addPush(szsFirefighter, 'szs-active', 'ACTIVE');
  await addPush(szsCommander, 'szs-revoked', 'REVOKED');
});

afterAll(async () => { await db?.end(); });

describe('commander-only call-out readiness', () => {
  it('counts unique people and active push accounts for own, other and both', async () => {
    expect(await readiness(commander, true)).toMatchObject({ eligible_count: 3, push_ready_count: 2 });
    expect(await readiness(commander, false, [SZS])).toMatchObject({ eligible_count: 3, push_ready_count: 2 });
    const both = await readiness(commander, true, [SZS, SZS]);
    expect(both).toMatchObject({ eligible_count: 5, push_ready_count: 3 });
    expect(both.checked_at).toBeInstanceOf(Date);
    expect(await readiness(szsCommander, true, [DVD], SZS))
      .toMatchObject({ eligible_count: 5, push_ready_count: 3 });
  });

  it('refuses unauthorised people and invalid service selections', async () => {
    const call = (c: Client) => c.query('select * from public.callout_readiness($1, true, $2)', [DVD, []]);
    expect(await expectRefused(db, citizen.userId, call)).toContain('COMMAND_REQUIRED');
    expect(await expectRefused(db, firefighter.userId, call)).toContain('COMMAND_REQUIRED');
    expect(await expectRefused(db, null, call)).toMatch(/permission denied/i);
    expect(await expectRefused(db, commander.userId, (c) =>
      c.query('select * from public.callout_readiness($1, false, $2)', [DVD, []])))
      .toContain('NO_RECIPIENTS');
    expect(await expectRefused(db, commander.userId, (c) =>
      c.query('select * from public.callout_readiness($1, true, $2)',
        [DVD, ['99999999-9999-4999-8999-999999999999']])))
      .toContain('RECIPIENT_ORGANIZATION_NOT_FOUND');
  });
});
