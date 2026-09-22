import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createMember,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';
import type { Client } from 'pg';

/**
 * Writing a role must not quietly stand the owner down from his own service.
 *
 * `sync_dvd_membership_after_grant` fires `AFTER INSERT OR UPDATE OF role` on
 * `access_grants`. Before migration 202609210016, `sync_dvd_membership_from_grant`
 * tested `new.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')` and fell through to
 * an `else` branch that sets `organization_memberships.active = false`. OWNER is
 * not in that list. So **any** write of the owner's role - re-running the
 * bootstrap, a re-grant, a future admin path - deactivated his DVD service
 * membership, silently, in a trigger nobody was looking at.
 *
 * What is actually at risk, stated precisely rather than dramatically:
 *
 * - **At risk:** `organization_memberships.active` for DVD. That is the service
 *   assignment - what the Accounts screen shows and what
 *   `owner_set_organization_membership` manages.
 * - **NOT at risk:** the `members` row and its `user_id` link. The trigger never
 *   touches `members`.
 * - **NOT at risk:** call-out eligibility. `current_dvd_role()` and
 *   `is_eligible_recipient()` both read `access_grants`, not
 *   `organization_memberships`, so a deactivated service membership would not
 *   have stopped the owner being called out or receiving a push.
 *
 * The existing test in `owner_service_membership.test.ts` asserts the service
 * row survives one same-value rewrite. It does not assert the member link, and
 * it does not cover a genuine reassignment. This file covers both, and keeps
 * the negative case that proves the guard is OWNER-specific rather than a
 * blanket disabling of the trigger.
 */
describe('Rewriting the owner grant leaves his member link and his service intact', () => {
  let db: Client;
  let owner: TestAccount;
  let firefighter: TestAccount;
  let ownerMemberId: string;
  let firefighterMemberId: string;

  const DVD = 'DVD';

  const service = (account: TestAccount) =>
    asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ role: string; active: boolean }>(
        `select membership.role, membership.active
           from public.organization_memberships membership
           join public.organizations organization
             on organization.id = membership.organization_id
          where organization.code = $1 and membership.user_id = $2`,
        [DVD, account.userId],
      );
      return rows[0] ?? null;
    });

  /** The member link as the application sees it, through the real function. */
  const ownMemberId = (account: TestAccount) =>
    asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        `select public.current_member_id() as id`,
      );
      return rows[0]!.id;
    });

  const eligible = (account: TestAccount, memberId: string) =>
    asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        `select public.is_eligible_recipient($1) as ok`,
        [memberId],
      );
      return rows[0]!.ok;
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

    owner = await createAccount(db, 'vlasnik-rewrite@example.invalid');
    await completeProfile(db, owner.userId, 'Vlasnik Rewrite');
    await grantRole(db, owner.userId, 'OWNER');
    ownerMemberId = await createMember(db, 'Vlasnik Rewrite', owner.userId);

    firefighter = await createAccount(db, 'vatrogasac-rewrite@example.invalid');
    await completeProfile(db, firefighter.userId, 'Vatrogasac Rewrite');
    await grantRole(db, firefighter.userId, 'FIREFIGHTER');
    firefighterMemberId = await createMember(db, 'Vatrogasac Rewrite', firefighter.userId);

    // The owner assigns himself the DVD service, which is the state the whole
    // defect is about: OWNER, a linked member record, and a service at once.
    await asUserCommitted(db, owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        owner.userId,
        DVD,
        'FIREFIGHTER',
      ]),
    );
  });

  afterAll(async () => db.end());

  it('starts from the state the defect is about: OWNER, a member link and a service', async () => {
    expect(await globalRole(owner)).toBe('OWNER');
    expect(await ownMemberId(owner)).toBe(ownerMemberId);
    expect(await service(owner)).toEqual({ role: 'FIREFIGHTER', active: true });
    expect(await eligible(owner, ownerMemberId)).toBe(true);
  });

  it('survives the owner grant being written again with the same role', async () => {
    // `update ... of role` fires the trigger even when the value is unchanged,
    // which is what made this reachable by simply re-running the bootstrap.
    await db.query(
      `update public.access_grants set role = 'OWNER', granted_at = now() where user_id = $1`,
      [owner.userId],
    );

    expect(await service(owner), 'the DVD service must not be stood down').toEqual({
      role: 'FIREFIGHTER',
      active: true,
    });
    expect(await ownMemberId(owner), 'the member link must survive').toBe(ownerMemberId);
    expect(await globalRole(owner)).toBe('OWNER');
    expect(await eligible(owner, ownerMemberId), 'he can still be called out').toBe(true);
  });

  it('survives a genuine reassignment back to OWNER, with one stale label', async () => {
    /*
     * A real reassignment rather than a same-value rewrite: the row leaves
     * OWNER and returns, so the trigger fires twice and the second firing is
     * the one the guard has to catch.
     *
     * This test was written expecting the service to read FIREFIGHTER
     * afterwards, and it failed. The behaviour is defensible and was simply
     * never written down, so it is pinned here rather than left to be
     * rediscovered:
     *
     *   1. Writing COMMANDER mirrors legitimately - the account really is a
     *      commander at that moment - so the DVD membership becomes COMMANDER.
     *   2. Writing OWNER back hits the guard, which returns without touching
     *      the membership. It has no way to know what the service was before,
     *      and inventing one would be the mirror overreaching again.
     *
     * So the membership stays ACTIVE - which is the whole point of the guard,
     * and the thing the defect broke - but its ROLE is left at whatever the
     * intermediate role was. The owner keeps his link, his eligibility and his
     * service; the service label is stale until somebody sets it through
     * `owner_set_organization_membership`.
     *
     * That is a cosmetic inaccuracy on the Accounts screen, not an operational
     * one. Worth knowing, not worth having the trigger guess.
     */
    await grantRole(db, owner.userId, 'COMMANDER');
    await grantRole(db, owner.userId, 'OWNER');

    const after = await service(owner);
    expect(after?.active, 'the DVD service must still be active - this is the defect').toBe(true);
    expect(after?.role, 'and its label is the intermediate role, not the original').toBe(
      'COMMANDER',
    );

    expect(await ownMemberId(owner), 'the member link must survive').toBe(ownerMemberId);
    expect(await globalRole(owner)).toBe('OWNER');
    expect(await eligible(owner, ownerMemberId), 'he can still be called out').toBe(true);
  });

  it('lets the owner correct that stale label through the proper command', async () => {
    await asUserCommitted(db, owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        owner.userId,
        DVD,
        'FIREFIGHTER',
      ]),
    );

    expect(await service(owner)).toEqual({ role: 'FIREFIGHTER', active: true });
    expect(await globalRole(owner)).toBe('OWNER');
  });

  it('still stands an ORDINARY member down when their role is taken away', async () => {
    /*
     * The guard must be OWNER-specific. If it had been written as "never
     * deactivate", losing a role would stop removing the service with it, and
     * a withdrawn firefighter would keep a DVD membership he should not have.
     * That failure would be invisible in every test above.
     */
    expect(await service(firefighter)).toEqual({ role: 'FIREFIGHTER', active: true });

    await grantRole(db, firefighter.userId, 'CITIZEN');

    expect(await service(firefighter), 'an ordinary member loses the service').toEqual({
      role: 'FIREFIGHTER',
      active: false,
    });
    // And the roster record itself is untouched either way - the trigger has
    // never had anything to do with `members`.
    const { rows } = await db.query<{ user_id: string | null; active: boolean }>(
      `select user_id, active from public.members where id = $1`,
      [firefighterMemberId],
    );
    expect(rows[0]).toEqual({ user_id: firefighter.userId, active: true });
  });
});
