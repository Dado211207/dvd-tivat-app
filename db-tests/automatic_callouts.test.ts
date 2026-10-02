import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUserCommitted, completeProfile, connect, createAccount, createMember,
  grantRole, resetSchema, type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
let db: Client;
let dvdCommander: TestAccount;
let szsCommander: TestAccount;
let dvdMember: TestAccount;
let szsMember: TestAccount;
let dual: TestAccount;
let dvdCommanderMember: string;
let dvdMemberId: string;
let szsCommanderMember: string;
let szsMemberId: string;
let dualDvdMember: string;
let dualSzsMember: string;
let counter = 0;

async function join(organizationId: string, account: TestAccount, role: string, name: string) {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, granted_by)
     values ($1, $2, $3, $2)`, [organizationId, account.userId, role],
  );
  return (await db.query<{ id: string }>(
    `insert into public.members(organization_id, full_name, user_id)
     values ($1, $2, $3) returning id`, [organizationId, name, account.userId],
  )).rows[0]!.id;
}

async function draftAs(account: TestAccount, organizationId: string) {
  return asUserCommitted(db, account.userId, async (client) =>
    (await client.query<{ id: string }>(
      `select public.create_intervention_draft_in($1, 'VJEZBA', 'Probna vjezba',
        'Samo test.', 'Poligon', $2) as id`, [organizationId, `automatic-${++counter}`],
    )).rows[0]!.id);
}

async function publishAs(account: TestAccount, id: string, own: string[] | null, other: string[] = []) {
  return asUserCommitted(db, account.userId, (client) =>
    client.query('select public.publish_intervention($1, $2, $3)', [id, own, other]));
}

async function recipients(id: string) {
  return (await db.query<{ member_id: string; user_id: string }>(
    `select r.member_id, m.user_id from public.intervention_recipients r
     join public.members m on m.id = r.member_id where r.intervention_id = $1`, [id],
  )).rows;
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  dvdCommander = await createAccount(db, 'auto-dvd-command@example.invalid');
  await completeProfile(db, dvdCommander.userId, 'DVD Komandir');
  await grantRole(db, dvdCommander.userId, 'COMMANDER');
  dvdCommanderMember = await createMember(db, 'DVD Komandir', dvdCommander.userId);

  szsCommander = await createAccount(db, 'auto-szs-command@example.invalid');
  await completeProfile(db, szsCommander.userId, 'SZS Komandir');
  szsCommanderMember = await join(SZS, szsCommander, 'COMMANDER', 'SZS Komandir');
  await grantRole(db, szsCommander.userId, 'FIREFIGHTER');
  await createMember(db, 'SZS Komandir DVD', szsCommander.userId);

  dvdMember = await createAccount(db, 'auto-dvd-member@example.invalid');
  await completeProfile(db, dvdMember.userId, 'DVD Clan');
  await grantRole(db, dvdMember.userId, 'FIREFIGHTER');
  dvdMemberId = await createMember(db, 'DVD Clan', dvdMember.userId);

  szsMember = await createAccount(db, 'auto-szs-member@example.invalid');
  await completeProfile(db, szsMember.userId, 'SZS Clan');
  szsMemberId = await join(SZS, szsMember, 'FIREFIGHTER', 'SZS Clan');

  dual = await createAccount(db, 'auto-dual@example.invalid');
  await completeProfile(db, dual.userId, 'Dvojni Clan');
  await grantRole(db, dual.userId, 'FIREFIGHTER');
  dualDvdMember = await createMember(db, 'Dvojni Clan', dual.userId);
  dualSzsMember = await join(SZS, dual, 'FIREFIGHTER', 'Dvojni Clan');
});

afterAll(async () => { await db?.end(); });

describe('automatic service audience at publication', () => {
  it('freezes every currently eligible DVD member, including one added after the draft', async () => {
    const id = await draftAs(dvdCommander, DVD);
    const late = await createAccount(db, 'auto-late@example.invalid');
    await completeProfile(db, late.userId, 'Kasni Clan');
    await grantRole(db, late.userId, 'FIREFIGHTER');
    const lateMember = await createMember(db, 'Kasni Clan', late.userId);

    await publishAs(dvdCommander, id, null);
    const ids = (await recipients(id)).map((row) => row.member_id);
    expect(ids).toEqual(expect.arrayContaining([dvdCommanderMember, dvdMemberId, dualDvdMember, lateMember]));
    expect(ids).not.toContain(szsMemberId);
    expect(ids).not.toContain(dualSzsMember);
  });

  it('lets an SZS commander who is a DVD firefighter call DVD only, and retry safely', async () => {
    const id = await draftAs(szsCommander, SZS);
    await publishAs(szsCommander, id, [], [DVD]);
    await publishAs(szsCommander, id, [], [DVD]);
    const rows = await recipients(id);
    expect(rows.map((row) => row.member_id)).toContain(dvdMemberId);
    expect(rows.map((row) => row.member_id)).not.toContain(szsCommanderMember);
    expect(rows.map((row) => row.member_id)).not.toContain(szsMemberId);
    expect(new Set(rows.map((row) => row.user_id)).size).toBe(rows.length);
    const { rows: outbox } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.notification_outbox
       where intervention_id = $1 and channel = 'IN_APP'`, [id],
    );
    expect(outbox[0]!.n).toBe(rows.length);
  });

  it('can alert both services and deduplicates a dual-service member under the publisher', async () => {
    const id = await draftAs(szsCommander, SZS);
    await publishAs(szsCommander, id, null, [DVD]);
    const rows = await recipients(id);
    expect(rows.map((row) => row.member_id)).toContain(szsMemberId);
    expect(rows.map((row) => row.member_id)).toContain(dvdMemberId);
    expect(rows.map((row) => row.member_id)).toContain(dualSzsMember);
    expect(rows.map((row) => row.member_id)).not.toContain(dualDvdMember);
    expect(new Set(rows.map((row) => row.user_id)).size).toBe(rows.length);
  });

  it('refuses a firefighter using the automatic publish path', async () => {
    const id = await draftAs(dvdCommander, DVD);
    await expect(publishAs(dvdMember, id, null)).rejects.toThrow('COMMAND_REQUIRED');
  });
});

describe('closing without an invented reason', () => {
  it('closes normally with no report and keeps a supplied report on another call', async () => {
    const plain = await draftAs(dvdCommander, DVD);
    await publishAs(dvdCommander, plain, null);
    await asUserCommitted(db, dvdCommander.userId, (client) =>
      client.query(`select public.close_intervention($1, 'CLOSED', '')`, [plain]));
    const described = await draftAs(dvdCommander, DVD);
    await publishAs(dvdCommander, described, null);
    await asUserCommitted(db, dvdCommander.userId, (client) =>
      client.query(`select public.close_intervention($1, 'CLOSED', 'Odradjena vjezba.')`, [described]));
    const { rows } = await db.query<{ id: string; close_reason: string | null }>(
      `select id, close_reason from public.interventions where id = any($1)`, [[plain, described]],
    );
    expect(rows.find((row) => row.id === plain)?.close_reason).toBeNull();
    expect(rows.find((row) => row.id === described)?.close_reason).toBe('Odradjena vjezba.');
  });

  it('still requires a reason to cancel a published call', async () => {
    const id = await draftAs(dvdCommander, DVD);
    await publishAs(dvdCommander, id, null);
    await expect(asUserCommitted(db, dvdCommander.userId, (client) =>
      client.query(`select public.close_intervention($1, 'CANCELLED', '')`, [id])))
      .rejects.toThrow('REASON_REQUIRED');
  });
});
