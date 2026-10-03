/** P7: a member paged across services receives push and acknowledges as their own service. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  asUser, asUserCommitted, completeProfile, connect, createAccount, createMember,
  grantRole, resetSchema, type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
let db: Client;
let szsCommand: TestAccount;
let dvdCommand: TestAccount;
let dvdMember: TestAccount;
let dvdLate: TestAccount;
let szsMember: TestAccount;
let joint = '';
let solo = '';
let dvdMemberId = '';
let dvdLateId = '';
let szsMemberId = '';
let dvdPush = '';
let szsPush = '';
let forgedPush = '';

async function addSZS(userId: string, role: string) {
  await db.query(`insert into public.organization_memberships
    (organization_id, user_id, role, active, granted_by, granted_at)
    values ($1, $2, $3, true, $2, now())`, [SZS, userId, role]);
}

async function insertPush(interventionId: string, memberId: string, userId: string, tag: string) {
  const { rows } = await db.query<{ id: string }>(`insert into public.notification_outbox
    (intervention_id, member_id, user_id, channel, state, dedupe_key)
    values ($1, $2, $3, 'WEB_PUSH', 'QUEUED', $4) returning id`,
  [interventionId, memberId, userId, tag]);
  return rows[0]!.id;
}

async function verdict(id: string) {
  return (await db.query<{ verdict: string; user_id: string | null }>(
    `select verdict, user_id from public.push_delivery_verdict($1)`, [id],
  )).rows[0]!;
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  szsCommand = await createAccount(db, 'joint-push-szs-command@example.invalid');
  await completeProfile(db, szsCommand.userId, 'SZS Komandir');
  await addSZS(szsCommand.userId, 'COMMANDER');
  dvdCommand = await createAccount(db, 'joint-push-dvd-command@example.invalid');
  await completeProfile(db, dvdCommand.userId, 'DVD Komandir');
  await grantRole(db, dvdCommand.userId, 'COMMANDER');
  dvdMember = await createAccount(db, 'joint-push-dvd-member@example.invalid');
  await completeProfile(db, dvdMember.userId, 'DVD Vatrogasac');
  await grantRole(db, dvdMember.userId, 'FIREFIGHTER');
  dvdMemberId = await createMember(db, 'DVD Vatrogasac', dvdMember.userId);
  szsMember = await createAccount(db, 'joint-push-szs-member@example.invalid');
  await completeProfile(db, szsMember.userId, 'SZS Vatrogasac');
  await addSZS(szsMember.userId, 'FIREFIGHTER');
  szsMemberId = (await db.query<{ id: string }>(`insert into public.members
    (organization_id, full_name, user_id) values ($1, 'SZS Vatrogasac', $2) returning id`,
  [SZS, szsMember.userId])).rows[0]!.id;

  joint = await asUserCommitted(db, szsCommand.userId, async (client) => {
    const id = (await client.query<{ id: string }>(`select public.create_intervention_draft_in
      ($1, 'POZAR', 'Zajednicki poziv', 'Uputstvo', 'Lokacija', 'joint-push') as id`, [SZS])).rows[0]!.id;
    await client.query('select public.publish_intervention($1, $2, $3)', [id, [szsMemberId], [DVD]]);
    return id;
  });
  dvdPush = await insertPush(joint, dvdMemberId, dvdMember.userId, 'joint-dvd-web-push');
  szsPush = await insertPush(joint, szsMemberId, szsMember.userId, 'joint-szs-web-push');

  dvdLate = await createAccount(db, 'joint-push-dvd-late@example.invalid');
  await completeProfile(db, dvdLate.userId, 'Kasniji DVD Clan');
  await grantRole(db, dvdLate.userId, 'FIREFIGHTER');
  dvdLateId = await createMember(db, 'Kasniji DVD Clan', dvdLate.userId);
  forgedPush = await insertPush(joint, dvdLateId, dvdLate.userId, 'joint-forged-web-push');

  solo = await asUserCommitted(db, szsCommand.userId, async (client) => {
    const id = (await client.query<{ id: string }>(`select public.create_intervention_draft_in
      ($1, 'POZAR', 'SZS poziv', 'Uputstvo', 'Lokacija', 'solo-push') as id`, [SZS])).rows[0]!.id;
    await client.query('select public.publish_intervention($1, $2)', [id, [szsMemberId]]);
    return id;
  });
});

afterAll(async () => { await db?.end(); });

describe('joint push decisions use the frozen recipient and the member service', () => {
  it('delivers to an eligible DVD recipient on an SZS call-out', async () => {
    expect(await verdict(dvdPush)).toEqual({ verdict: 'DELIVER', user_id: dvdMember.userId });
  });
  it('retains same-service delivery', async () => {
    expect(await verdict(szsPush)).toEqual({ verdict: 'DELIVER', user_id: szsMember.userId });
  });
  it('refuses a member added after publication, although the service was targeted', async () => {
    expect((await verdict(forgedPush)).verdict).toBe('NOT_A_RECIPIENT');
  });
  it('refuses a DVD member on a call-out that never targeted DVD', async () => {
    const id = await insertPush(solo, dvdMemberId, dvdMember.userId, 'solo-forged-web-push');
    expect((await verdict(id)).verdict).toBe('SERVICE_MISMATCH');
  });
  it('still enforces eligibility at delivery time', async () => {
    await db.query(`update public.organization_memberships set active = false
      where organization_id = $1 and user_id = $2`, [DVD, dvdMember.userId]);
    expect((await verdict(dvdPush)).verdict).toBe('INELIGIBLE');
    await db.query(`update public.organization_memberships set active = true
      where organization_id = $1 and user_id = $2`, [DVD, dvdMember.userId]);
  });
});

describe('joint acknowledgements and delivery metadata belong to the member service', () => {
  it('a DVD recipient acknowledges the SZS call-out as their DVD member', async () => {
    await asUserCommitted(db, dvdMember.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [joint]));
    const rows = (await db.query<{ member_id: string; organization_id: string }>(`
      select member_id, organization_id from public.intervention_acknowledgements
      where intervention_id = $1 and member_id = $2`, [joint, dvdMemberId])).rows;
    expect(rows).toEqual([{ member_id: dvdMemberId, organization_id: DVD }]);
  });
  it('each commander reads only their service acknowledgement, outbox and attempts', async () => {
    await asUserCommitted(db, szsMember.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [joint]));
    await db.query(`insert into public.notification_delivery_attempts
      (outbox_id, provider, provider_status) values ($1, 'FAKE', 'ACCEPTED'), ($2, 'FAKE', 'ACCEPTED')`, [dvdPush, szsPush]);
    const read = async (userId: string, table: string) =>
      asUser(db, userId, async (client) => (await client.query<{ member_id: string }>(`
        select ${table === 'notification_delivery_attempts' ? 'o.member_id' : 'member_id'}
        from public.${table} ${table === 'notification_delivery_attempts' ?
        'a join public.notification_outbox o on o.id = a.outbox_id' : ''}
        where ${table === 'notification_delivery_attempts' ? 'o.intervention_id' : 'intervention_id'} = $1`, [joint])).rows.map((row) => row.member_id));
    for (const table of ['intervention_acknowledgements', 'notification_outbox', 'notification_delivery_attempts']) {
      expect(await read(dvdCommand.userId, table)).toContain(dvdMemberId);
      expect(await read(dvdCommand.userId, table)).not.toContain(szsMemberId);
      expect(await read(szsCommand.userId, table)).toContain(szsMemberId);
      expect(await read(szsCommand.userId, table)).not.toContain(dvdMemberId);
    }
  });
});
