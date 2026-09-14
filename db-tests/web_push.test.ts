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
    /*
     * What matters in every case below is that NOTHING IS STORED. The refusal
     * code says which gate stopped it, and the gates are ordered - "do you have
     * operational access at all" before "are you an eligible recipient" - so a
     * single account can only ever meet the first one that applies to it.
     *
     * This block originally expected ELIGIBLE_MEMBER_REQUIRED for an
     * incomplete profile. That refusal is unreachable for this account:
     * `current_dvd_role()` was tightened in an earlier slice to require a
     * complete profile, so an unfinished account has no operational role and is
     * turned away one gate earlier. The function is right and the expectation
     * was wrong; the inactive-member case below still reaches the second gate.
     */
    const stored = async (value: string): Promise<number> => {
      const { rows } = await db.query<{ count: string }>(
        'select count(*)::text as count from public.web_push_subscriptions where endpoint = $1',
        [value],
      );
      return Number(rows[0]!.count);
    };

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
    ).toMatch(/OPERATIONAL_ACCESS_REQUIRED/);
    expect(await stored(endpoint('incomplete')), 'nothing may be stored').toBe(0);

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
    expect(await stored(endpoint('suspended')), 'nothing may be stored').toBe(0);

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
    expect(await stored(endpoint('inactive-member')), 'nothing may be stored').toBe(0);
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

  /**
   * The atomic claim, at the level it is actually enforced.
   *
   * The Edge Function claims a row with a CONDITIONAL update - it must still be
   * in the state and attempt count the worker read. The whole no-duplicate-send
   * argument rests on that being a real guarantee rather than a hopeful one, so
   * it is exercised against PostgreSQL rather than described in a comment.
   */
  it('lets exactly one worker claim a queued alert, however many try', async () => {
    await register(firefighter, endpoint('claim-race'));
    const draft = await createDraft(db, commander.userId, { key: 'push-claim-race' });
    await asUserCommitted(db, commander.userId, (client) =>
      client.query('select public.publish_intervention($1, $2)', [draft, [firefighter.memberId]]),
    );

    const { rows: queued } = await db.query<{ id: string; attempt_count: number }>(
      `select id, attempt_count from public.notification_outbox
       where intervention_id = $1 and channel = 'WEB_PUSH'`,
      [draft],
    );
    expect(queued).toHaveLength(1);
    const row = queued[0]!;

    // Three workers reading the same snapshot and racing to claim it.
    const claim = () =>
      db.query(
        `update public.notification_outbox
         set state = 'SENT_TO_PROVIDER', attempt_count = $2, updated_at = now()
         where id = $1 and state = 'QUEUED' and attempt_count = $3
         returning id`,
        [row.id, Number(row.attempt_count) + 1, row.attempt_count],
      );
    const results = await Promise.all([claim(), claim(), claim()]);
    const winners = results.filter((result) => result.rowCount === 1);
    expect(winners, 'a second worker must not be able to send the same alert').toHaveLength(1);

    const { rows: after } = await db.query<{ state: string; attempt_count: number }>(
      'select state, attempt_count from public.notification_outbox where id = $1',
      [row.id],
    );
    expect(after[0]).toEqual({ state: 'SENT_TO_PROVIDER', attempt_count: 1 });
  });

  /**
   * Closing a row is what stops the scheduled repeat, and the schema only
   * accepts a reason it recognises - so a typo cannot silently close deliveries
   * for a reason nobody can audit later.
   */
  it('records why a delivery was closed, and refuses a reason it does not know', async () => {
    await register(firefighter, endpoint('closed'));
    const draft = await createDraft(db, commander.userId, { key: 'push-closed' });
    await asUserCommitted(db, commander.userId, (client) =>
      client.query('select public.publish_intervention($1, $2)', [draft, [firefighter.memberId]]),
    );
    const { rows } = await db.query<{ id: string }>(
      `select id from public.notification_outbox where intervention_id = $1 and channel = 'WEB_PUSH'`,
      [draft],
    );
    const id = rows[0]!.id;

    await db.query(
      `update public.notification_outbox
       set delivery_closed_at = now(), delivery_close_reason = 'MEMBER_OPENED' where id = $1`,
      [id],
    );
    const { rows: closed } = await db.query<{ delivery_close_reason: string }>(
      'select delivery_close_reason from public.notification_outbox where id = $1',
      [id],
    );
    expect(closed[0]?.delivery_close_reason).toBe('MEMBER_OPENED');

    await expect(
      db.query(
        `update public.notification_outbox
         set delivery_closed_at = now(), delivery_close_reason = 'BECAUSE_I_SAID_SO' where id = $1`,
        [id],
      ),
    ).rejects.toThrow();

    // A close time without a reason, or a reason without a time, is not a
    // record of anything.
    await expect(
      db.query('update public.notification_outbox set delivery_close_reason = null where id = $1', [id]),
    ).rejects.toThrow();
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
