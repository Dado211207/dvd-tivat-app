/** Automatic joint publication through the real service-role push worker. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { deliverQueued, type PushOptions, type PushTarget } from '../supabase/functions/send-web-push/deliver';
import {
  asUserCommitted, completeProfile, connect, createAccount, createMember,
  grantRole, resetSchema, type TestAccount,
} from './harness';
import { postgrest, type Rest } from './postgrest';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const P256DH = 'A'.repeat(65);
const AUTH = 'B'.repeat(24);

let db: Client;
let worker: Rest;
let commander: TestAccount;
let dvd: TestAccount;
let szs: TestAccount;
let dual: TestAccount;
let dualDvdMember: string;
let dualSzsMember: string;
let sequence = 0;

async function memberInSZS(account: TestAccount, name: string): Promise<string> {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, granted_by)
     values ($1, $2, 'FIREFIGHTER', $2)`, [SZS, account.userId],
  );
  return (await db.query<{ id: string }>(
    `insert into public.members(organization_id, full_name, user_id)
     values ($1, $2, $3) returning id`, [SZS, name, account.userId],
  )).rows[0]!.id;
}

async function subscribe(account: TestAccount, label: string): Promise<void> {
  await db.query(
    `insert into public.web_push_subscriptions(user_id, endpoint, p256dh, auth_secret)
     values ($1, $2, $3, $4)`,
    [account.userId, `https://push.example.test/joint/${label}`, P256DH, AUTH],
  );
}

async function publishJoint(): Promise<string> {
  const key = `joint-worker-${++sequence}`;
  return asUserCommitted(db, commander.userId, async (client) => {
    const id = (await client.query<{ id: string }>(
      `select public.create_intervention_draft_in($1, 'VJEZBA', 'Zajednicka vjezba',
        'Samo test.', 'Poligon', $2) as id`, [DVD, key],
    )).rows[0]!.id;
    await client.query('select public.publish_intervention($1, $2, $3)', [id, null, [SZS]]);
    return id;
  });
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
  worker = postgrest({ role: 'service_role' });

  commander = await createAccount(db, 'joint-worker-command@example.invalid');
  await completeProfile(db, commander.userId, 'DVD Komandir');
  await grantRole(db, commander.userId, 'COMMANDER');
  await createMember(db, 'DVD Komandir', commander.userId);

  dvd = await createAccount(db, 'joint-worker-dvd@example.invalid');
  await completeProfile(db, dvd.userId, 'DVD Vatrogasac');
  await grantRole(db, dvd.userId, 'FIREFIGHTER');
  await createMember(db, 'DVD Vatrogasac', dvd.userId);

  szs = await createAccount(db, 'joint-worker-szs@example.invalid');
  await completeProfile(db, szs.userId, 'SZS Vatrogasac');
  await memberInSZS(szs, 'SZS Vatrogasac');

  dual = await createAccount(db, 'joint-worker-dual@example.invalid');
  await completeProfile(db, dual.userId, 'Dvojna Sluzba');
  await grantRole(db, dual.userId, 'FIREFIGHTER');
  dualDvdMember = await createMember(db, 'Dvojna Sluzba DVD', dual.userId);
  dualSzsMember = await memberInSZS(dual, 'Dvojna Sluzba SZS');

  await subscribe(dvd, 'dvd');
  await subscribe(szs, 'szs');
  await subscribe(dual, 'dual');
});

afterAll(async () => {
  await worker?.end();
  await db?.end();
});

describe('automatic joint call-out through Web Push', () => {
  it('reaches each account once, retaining the publisher outbox label and recipient service', async () => {
    const id = await publishJoint();
    const { rows } = await db.query<{
      user_id: string; member_id: string; outbox_service: string;
      member_service: string; verdict: string;
    }>(`
      select o.user_id, o.member_id, o.organization_id as outbox_service,
             m.organization_id as member_service, v.verdict
      from public.notification_outbox o
      join public.members m on m.id = o.member_id
      cross join lateral public.push_delivery_verdict(o.id) v
      where o.intervention_id = $1 and o.channel = 'WEB_PUSH'
      order by o.user_id`, [id]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.user_id)).size).toBe(3);
    expect(rows.every((row) => row.outbox_service === DVD && row.verdict === 'DELIVER')).toBe(true);
    expect(rows.find((row) => row.user_id === szs.userId)?.member_service).toBe(SZS);
    expect(rows.find((row) => row.user_id === dual.userId)).toMatchObject({
      member_id: dualDvdMember, member_service: DVD,
    });
    expect(rows.some((row) => row.member_id === dualSzsMember)).toBe(false);

    const sent: { endpoint: string; interventionId: string; options: PushOptions }[] = [];
    const send = async (target: PushTarget, payload: string, options: PushOptions) => {
      sent.push({ endpoint: target.endpoint, interventionId: JSON.parse(payload).interventionId, options });
    };
    const tally = await deliverQueued({ service: worker, send, scheduler: false }, id);
    expect(tally).toEqual({ accepted: 3, rejected: 0, skipped: 0, failed: 0, mislabelled: 0 });
    expect(sent.map((item) => item.endpoint).sort()).toEqual([
      'https://push.example.test/joint/dvd',
      'https://push.example.test/joint/dual',
      'https://push.example.test/joint/szs',
    ]);
    expect(sent.every((item) => item.interventionId === id && item.options.topic === id.replaceAll('-', ''))).toBe(true);
  });

  it('does not send a queued alert after the commander closes the joint call-out', async () => {
    const id = await publishJoint();
    await asUserCommitted(db, commander.userId, (client) =>
      client.query("select public.close_intervention($1, 'CLOSED', null)", [id]));

    const sent: string[] = [];
    const tally = await deliverQueued({
      service: worker, scheduler: true,
      send: async (target) => { sent.push(target.endpoint); },
    }, id);
    expect(sent).toEqual([]);
    expect(tally).toEqual({ accepted: 0, rejected: 0, skipped: 3, failed: 0, mislabelled: 0 });
    const { rows } = await db.query<{ delivery_close_reason: string; attempt_count: number }>(
      `select delivery_close_reason, attempt_count from public.notification_outbox
       where intervention_id = $1 and channel = 'WEB_PUSH'`, [id],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.delivery_close_reason === 'CALLOUT_NOT_OPEN' && row.attempt_count === 0)).toBe(true);
  });
});
