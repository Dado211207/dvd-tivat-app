import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  expectRefused,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';
import type { Client } from 'pg';

/**
 * The owner is also a firefighter.
 *
 * Holding OWNER is a statement about authority over the system. It says nothing
 * about whether the person turns out to a fire. The owner of this system is an
 * active member of the society, and reported two symptoms that looked unrelated:
 * his screen said his account was not linked to a member, and enabling
 * notifications failed with "check the connection".
 *
 * They are one defect. `register_web_push_subscription` refuses an account with
 * no member record, and the client maps every refusal it does not recognise to a
 * connection error. These tests pin the cause to the missing link, and prove the
 * owner can close it himself through the same commands the Records screen calls.
 */
describe('An owner who is also a firefighter', () => {
  let db: Client;
  let owner: TestAccount;

  const endpoint = 'https://push.example.test/subscriptions/owner-device';
  const p256dh = 'A'.repeat(65);
  const authSecret = 'B'.repeat(24);

  const registerDevice = (account: TestAccount) =>
    asUserCommitted(db, account.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.register_web_push_subscription($1, $2, $3, null, $4) as id`,
        [endpoint, p256dh, authSecret, 'Owner iPhone'],
      );
      return rows[0]!.id;
    });

  beforeAll(async () => {
    db = await connect();
    await resetSchema(db);

    // Deliberately no member record: this is the production state of the
    // owner's account, and the starting point of both symptoms.
    owner = await createAccount(db, 'vlasnik-vatrogasac@example.invalid');
    await completeProfile(db, owner.userId, 'Vlasnik Vatrogasac');
    await grantRole(db, owner.userId, 'OWNER');
  });

  afterAll(async () => db.end());

  it('is refused notifications for the real reason: no member record, not the connection', async () => {
    const message = await expectRefused(db, owner.userId, (client) =>
      client.query(`select public.register_web_push_subscription($1, $2, $3, null, $4)`, [
        endpoint,
        p256dh,
        authSecret,
        'Owner iPhone',
      ]),
    );

    // The exact wire reason matters: the client has to be able to tell this
    // apart from a network failure, which is the whole point of the fix.
    expect(message).toContain('ELIGIBLE_MEMBER_REQUIRED');
    expect(message).not.toContain('OPERATIONAL_ACCESS_REQUIRED');
  });

  it('has no member identity to answer a call-out with', async () => {
    const { rows } = await asUser(db, owner.userId, (client) =>
      client.query<{ member_id: string | null }>(`select public.current_member_id() as member_id`),
    );
    expect(rows[0]!.member_id).toBeNull();
  });

  it('may create its own member record and link its own account', async () => {
    // Both commands are what the Records screen calls. Neither is given any
    // special treatment here: the owner runs them as itself, under RLS.
    const memberId = await asUserCommitted(db, owner.userId, async (client) => {
      const created = await client.query<{ id: string }>(
        `select public.admin_create_member($1, $2) as id`,
        ['Vlasnik Vatrogasac', ['BOLNICAR']],
      );
      const id = created.rows[0]!.id;
      await client.query(`select public.admin_link_member_account($1, $2)`, [id, owner.userId]);
      return id;
    });

    expect(memberId).toMatch(/^[0-9a-f-]{36}$/);
    owner.memberId = memberId;

    const { rows } = await asUser(db, owner.userId, (client) =>
      client.query<{ member_id: string | null }>(`select public.current_member_id() as member_id`),
    );
    expect(rows[0]!.member_id).toBe(memberId);
  });

  it('counts as an eligible recipient once linked, so it can be called out', async () => {
    const { rows } = await asUser(db, owner.userId, (client) =>
      client.query<{ eligible: boolean }>(`select public.is_eligible_recipient($1) as eligible`, [
        owner.memberId,
      ]),
    );
    expect(rows[0]!.eligible).toBe(true);
  });

  it('can then enable notifications, with nothing else changed', async () => {
    const id = await registerDevice(owner);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await asUser(db, owner.userId, (client) =>
      client.query<{ role: string }>(
        `select role from public.access_grants where user_id = $1`,
        [owner.userId],
      ),
    );
    // Becoming a firefighter must not cost the society its only owner.
    expect(rows[0]!.role).toBe('OWNER');
  });
});
