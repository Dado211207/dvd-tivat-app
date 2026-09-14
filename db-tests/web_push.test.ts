import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  asUserCommitted,
  connect,
  createAccount,
  createDraft,
  createMember,
  expectRefused,
  completeProfile,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';
import type { Client } from 'pg';

const endpoint = (suffix: string) => `https://push.example.test/subscriptions/${suffix}`;
const p256dh = 'A'.repeat(65);
const authSecret = 'B'.repeat(24);

describe('Web Push subscription authority and outbox fan-out', () => {
  let db: Client;
  let commander: TestAccount;
  let firefighter: TestAccount;
  let other: TestAccount;

  beforeAll(async () => {
    db = await connect();
    await resetSchema(db);

    commander = await createAccount(db, 'push-commander@example.invalid');
    await completeProfile(db, commander.userId, 'Push Komandir');
    await grantRole(db, commander.userId, 'COMMANDER');
    commander.memberId = await createMember(db, 'Push Komandir', commander.userId);

    firefighter = await createAccount(db, 'push-firefighter@example.invalid');
    await completeProfile(db, firefighter.userId, 'Push Vatrogasac');
    await grantRole(db, firefighter.userId, 'FIREFIGHTER');
    firefighter.memberId = await createMember(db, 'Push Vatrogasac', firefighter.userId);

    other = await createAccount(db, 'push-other@example.invalid');
    await completeProfile(db, other.userId, 'Drugi Vatrogasac');
    await grantRole(db, other.userId, 'FIREFIGHTER');
    other.memberId = await createMember(db, 'Drugi Vatrogasac', other.userId);
  });

  afterAll(async () => db.end());

  async function register(account: TestAccount, value = endpoint(account.userId)) {
    return asUserCommitted(db, account.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.register_web_push_subscription($1, $2, $3, null, $4) as id`,
        [value, p256dh, authSecret, 'Test browser'],
      );
      return rows[0]!.id;
    });
  }

  it('registers a device only for the authenticated operational member', async () => {
    const id = await register(firefighter);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const own = await asUser(db, firefighter.userId, (client) =>
      client.query('select endpoint from public.web_push_subscriptions'),
    );
    expect(own.rows).toHaveLength(1);

    const hidden = await asUser(db, other.userId, (client) =>
      client.query('select endpoint from public.web_push_subscriptions'),
    );
    expect(hidden.rows).toHaveLength(0);
  });

  it('refuses malformed endpoints, anonymous registration and direct writes', async () => {
    expect(
      await expectRefused(db, firefighter.userId, (client) =>
        client.query(`select public.register_web_push_subscription('http://bad', $1, $2)`, [
          p256dh,
          authSecret,
        ]),
      ),
    ).toMatch(/PUSH_ENDPOINT_INVALID/);

    expect(
      await expectRefused(db, null, (client) =>
        client.query('select public.register_web_push_subscription($1, $2, $3)', [
          endpoint('anonymous'),
          p256dh,
          authSecret,
        ]),
      ),
    ).toMatch(/permission denied/);

    expect(
      await expectRefused(db, firefighter.userId, (client) =>
        client.query(
          `insert into public.web_push_subscriptions(user_id, endpoint, p256dh, auth_secret)
           values ($1, $2, $3, $4)`,
          [firefighter.userId, endpoint('direct'), p256dh, authSecret],
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('will not let another account claim a known device endpoint', async () => {
    const shared = endpoint('owned-device');
    await register(firefighter, shared);
    const message = await expectRefused(db, other.userId, (client) =>
      client.query('select public.register_web_push_subscription($1, $2, $3)', [
        shared,
        p256dh,
        authSecret,
      ]),
    );
    expect(message).toMatch(/PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT/);
  });

  it('refuses a device when the account or member is no longer eligible', async () => {
    const incomplete = await createAccount(db, 'push-incomplete@example.invalid');
    await grantRole(db, incomplete.userId, 'FIREFIGHTER');
    incomplete.memberId = await createMember(db, 'Incomplete Push', incomplete.userId);
    expect(
      await expectRefused(db, incomplete.userId, (client) =>
        client.query('select public.register_web_push_subscription($1, $2, $3)', [
          endpoint('incomplete'),
          p256dh,
          authSecret,
        ]),
      ),
    ).toMatch(/ELIGIBLE_MEMBER_REQUIRED/);

    const suspended = await createAccount(db, 'push-suspended@example.invalid');
    await completeProfile(db, suspended.userId, 'Suspended Push');
    await grantRole(db, suspended.userId, 'FIREFIGHTER');
    suspended.memberId = await createMember(db, 'Suspended Push', suspended.userId);
    await db.query('update public.access_grants set active = false where user_id = $1', [
      suspended.userId,
    ]);
    expect(
      await expectRefused(db, suspended.userId, (client) =>
        client.query('select public.register_web_push_subscription($1, $2, $3)', [
          endpoint('suspended'),
          p256dh,
          authSecret,
        ]),
      ),
    ).toMatch(/OPERATIONAL_ACCESS_REQUIRED/);

    const inactiveMember = await createAccount(db, 'push-inactive-member@example.invalid');
    await completeProfile(db, inactiveMember.userId, 'Inactive Member');
    await grantRole(db, inactiveMember.userId, 'FIREFIGHTER');
    inactiveMember.memberId = await createMember(db, 'Inactive Member', inactiveMember.userId);
    await db.query('update public.members set active = false where id = $1', [
      inactiveMember.memberId,
    ]);
    expect(
      await expectRefused(db, inactiveMember.userId, (client) =>
        client.query('select public.register_web_push_subscription($1, $2, $3)', [
          endpoint('inactive-member'),
          p256dh,
          authSecret,
        ]),
      ),
    ).toMatch(/ELIGIBLE_MEMBER_REQUIRED/);
  });

  it('queues Web Push only for a recipient with an active subscription', async () => {
    await register(firefighter, endpoint('fanout'));
    const draft = await createDraft(db, commander.userId, { key: 'push-fanout' });

    await asUserCommitted(db, commander.userId, (client) =>
      client.query('select public.publish_intervention($1, $2)', [
        draft,
        [firefighter.memberId, other.memberId],
      ]),
    );

    const { rows } = await db.query<{ member_id: string; channel: string; state: string }>(
      `select member_id, channel, state from public.notification_outbox
       where intervention_id = $1 order by member_id, channel`,
      [draft],
    );
    expect(rows.filter((row) => row.channel === 'IN_APP')).toHaveLength(2);
    expect(rows.filter((row) => row.channel === 'WEB_PUSH')).toEqual([
      { member_id: firefighter.memberId, channel: 'WEB_PUSH', state: 'QUEUED' },
    ]);
  });

  it('stops future Web Push fan-out after the user revokes the device', async () => {
    const value = endpoint('revoked');
    await register(other, value);
    await asUserCommitted(db, other.userId, (client) =>
      client.query('select public.revoke_web_push_subscription($1)', [value]),
    );

    const draft = await createDraft(db, commander.userId, { key: 'push-revoked' });
    await asUserCommitted(db, commander.userId, (client) =>
      client.query('select public.publish_intervention($1, $2)', [draft, [other.memberId]]),
    );

    const { rows } = await db.query(
      `select 1 from public.notification_outbox
       where intervention_id = $1 and channel = 'WEB_PUSH'`,
      [draft],
    );
    expect(rows).toHaveLength(0);
  });
});
