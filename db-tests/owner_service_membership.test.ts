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
 * Global authority and service membership are two different facts.
 *
 * OWNER says who governs the system. DVD FIREFIGHTER says who turns out to a
 * fire. One person can be both, and the owner of this system is. Two server
 * rules stood in the way, and a third would have quietly undone the fix:
 *
 *   1. `owner_set_organization_membership` refused a self-target outright.
 *   2. It refused an OWNER target outright.
 *   3. The `access_grants` trigger deactivates DVD membership for any role it
 *      does not consider operational - and OWNER is not in that list. So even
 *      once 1 and 2 were lifted, the next write to the owner's role column
 *      would switch the membership back off with nothing said.
 *
 * The third is the one worth having tests for: it fails silently and later.
 */
describe('The owner holds a service membership without losing the system', () => {
  let db: Client;
  let owner: TestAccount;
  let firefighter: TestAccount;

  const DVD = 'DVD';

  const membership = (account: TestAccount) =>
    asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ role: string | null; active: boolean }>(
        `select membership.role, membership.active
           from public.organization_memberships membership
           join public.organizations organization
             on organization.id = membership.organization_id
          where organization.code = $1 and membership.user_id = $2`,
        [DVD, account.userId],
      );
      return rows[0] ?? null;
    });

  const globalRole = (account: TestAccount) =>
    asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `select role from public.access_grants where user_id = $1`,
        [account.userId],
      );
      return rows[0]!.role;
    });

  beforeAll(async () => {
    db = await connect();
    await resetSchema(db);

    owner = await createAccount(db, 'vlasnik-servis@example.invalid');
    await completeProfile(db, owner.userId, 'Vlasnik Servis');
    await grantRole(db, owner.userId, 'OWNER');

    firefighter = await createAccount(db, 'vatrogasac-servis@example.invalid');
    await completeProfile(db, firefighter.userId, 'Vatrogasac Servis');
    await grantRole(db, firefighter.userId, 'FIREFIGHTER');
  });

  afterAll(async () => db.end());

  it('assigns itself a DVD service without giving up OWNER', async () => {
    await asUserCommitted(db, owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        owner.userId,
        DVD,
        'FIREFIGHTER',
      ]),
    );

    expect(await membership(owner)).toEqual({ role: 'FIREFIGHTER', active: true });
    // The whole point. A society with no owner is the failure this guards.
    expect(await globalRole(owner)).toBe('OWNER');
  });

  it('keeps that membership when the owner grant is written again', async () => {
    // The silent regression: `update of role` fires the sync trigger even when
    // the value does not change, and OWNER is not an operational role to it.
    await db.query(
      `update public.access_grants set role = 'OWNER', granted_at = now() where user_id = $1`,
      [owner.userId],
    );

    expect(await membership(owner)).toEqual({ role: 'FIREFIGHTER', active: true });
    expect(await globalRole(owner)).toBe('OWNER');
  });

  it('records the assignment in the membership audit', async () => {
    const { rows } = await asUser(db, owner.userId, (client) =>
      client.query<{ next_role: string; next_active: boolean }>(
        `select audit.next_role, audit.next_active
           from public.organization_membership_audit audit
          where audit.target_user_id = $1
          order by audit.changed_at desc limit 1`,
        [owner.userId],
      ),
    );
    expect(rows[0]).toEqual({ next_role: 'FIREFIGHTER', next_active: true });
  });

  it('can stand itself down from the service, still without losing OWNER', async () => {
    await asUserCommitted(db, owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        owner.userId,
        DVD,
        'NONE',
      ]),
    );

    expect(await membership(owner)).toEqual({ role: 'FIREFIGHTER', active: false });
    expect(await globalRole(owner)).toBe('OWNER');
  });

  it('no longer mirrors an ordinary member DVD change to the compatibility grant (P5)', async () => {
    // 202609250038 retired the mirror. A service assignment writes only the
    // membership; the compatibility grant is left exactly as it was. Authority is
    // the membership now, so the two no longer need to be kept in step.
    const before = await globalRole(firefighter);

    await asUserCommitted(db, owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        firefighter.userId,
        DVD,
        'COMMANDER',
      ]),
    );
    expect(await membership(firefighter)).toEqual({ role: 'COMMANDER', active: true });
    expect(await globalRole(firefighter), 'the grant is untouched by the membership command').toBe(before);

    await asUserCommitted(db, owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        firefighter.userId,
        DVD,
        'NONE',
      ]),
    );
    expect(await membership(firefighter)).toEqual({ role: 'COMMANDER', active: false });
    expect(await globalRole(firefighter), 'still untouched on stand-down').toBe(before);
  });

  it('is still the only role that may assign a service at all', async () => {
    const message = await expectRefused(db, firefighter.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        firefighter.userId,
        DVD,
        'COMMANDER',
      ]),
    );
    expect(message).toContain('OWNER_REQUIRED');
  });
});
