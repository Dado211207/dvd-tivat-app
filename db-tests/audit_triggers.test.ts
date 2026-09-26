import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';
import type { Client } from 'pg';

/**
 * A role cannot be changed without leaving a record, whatever path changes it.
 *
 * The gap these triggers close is specific and was demonstrated in production:
 * `role_audit` was written only by explicit `insert` statements inside
 * `owner_set_role` and `owner_set_organization_membership`. The direct SQL that
 * `docs/OWNER_BOOTSTRAP.md` prescribes for transferring ownership went nowhere
 * near either function, so on 2026-09-21 ownership of the whole system moved
 * and the database recorded nothing by itself. The two rows that exist were
 * typed by hand alongside the change.
 *
 * So the test that matters is not "does the application write an audit row" -
 * it always did. It is **does a change that bypasses the application entirely
 * still produce one**. Every test below writes with `db` directly, as the
 * superuser, with no `auth.uid()` and no function call: the closest thing to
 * somebody pasting SQL into the dashboard.
 *
 * WHAT THIS DOES NOT TEST, BECAUSE IT CANNOT BE TRUE
 *
 * These triggers do not make the audit forgery-proof. A superuser - which is
 * what the Supabase SQL editor is - can still insert rows directly, disable the
 * trigger, or delete history. Postgres offers nothing that stops its own
 * superuser, so "a record with no change" stays possible. What is closed is the
 * opposite and more dangerous case: "a change with no record".
 */
describe('Every role change writes its own audit row, including raw SQL', () => {
  let db: Client;
  let owner: TestAccount;
  let member: TestAccount;

  const DVD = 'DVD';

  const roleAudit = (account: TestAccount) =>
    db
      .query<{
        previous_role: string | null;
        next_role: string;
        changed_by: string | null;
      }>(
        `select previous_role, next_role, changed_by
           from public.role_audit
          where target_user_id = $1
          order by changed_at, next_role`,
        [account.userId],
      )
      .then((r) => r.rows);

  const membershipAudit = (account: TestAccount) =>
    db
      .query<{
        previous_role: string | null;
        next_role: string | null;
        previous_active: boolean | null;
        next_active: boolean;
        changed_by: string | null;
      }>(
        `select previous_role, next_role, previous_active, next_active, changed_by
           from public.organization_membership_audit
          where target_user_id = $1
          order by changed_at`,
        [account.userId],
      )
      .then((r) => r.rows);

  beforeAll(async () => {
    db = await connect();
    await resetSchema(db);

    owner = await createAccount(db, 'vlasnik-audit@example.invalid');
    await completeProfile(db, owner.userId, 'Vlasnik Audit');
    await grantRole(db, owner.userId, 'OWNER');

    member = await createAccount(db, 'clan-audit@example.invalid');
    await completeProfile(db, member.userId, 'Clan Audit');
  });

  afterAll(async () => db.end());

  it('records a direct UPDATE that never touched the application', async () => {
    /*
     * The 2026-09-21 case, reproduced. No function, no session, no `auth.uid()`
     * - exactly what the ownership-transfer runbook tells somebody to paste
     * into the SQL editor.
     */
    const before = (await roleAudit(member)).length;

    await db.query(`update public.access_grants set role = 'COMMANDER' where user_id = $1`, [
      member.userId,
    ]);

    const rows = await roleAudit(member);
    expect(rows.length, 'a raw UPDATE must produce exactly one new row').toBe(before + 1);

    const written = rows[rows.length - 1]!;
    expect(written.previous_role, 'and it records what the role was').toBe('CITIZEN');
    expect(written.next_role, 'and what it became').toBe('COMMANDER');
    // Null is the point, not a gap: there was no application session, and
    // saying so is more useful than naming an actor nobody can vouch for.
    expect(
      written.changed_by,
      'a change with no session records no actor, rather than inventing one',
    ).toBeNull();
  });

  it('records the transfer of ownership itself, the exact production case', async () => {
    // Both halves of the runbook block, in one transaction, as documented.
    await db.query('begin');
    await db.query(`update public.access_grants set role = 'CITIZEN' where role = 'OWNER'`);
    await db.query(`update public.access_grants set role = 'OWNER' where user_id = $1`, [
      member.userId,
    ]);
    await db.query('commit');

    const demoted = await roleAudit(owner);
    expect(demoted.at(-1)).toEqual({
      previous_role: 'OWNER',
      next_role: 'CITIZEN',
      changed_by: null,
    });

    const promoted = await roleAudit(member);
    expect(promoted.at(-1)).toEqual({
      previous_role: 'COMMANDER',
      next_role: 'OWNER',
      changed_by: null,
    });

    // And the system still has exactly one owner.
    const { rows } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.access_grants where role = 'OWNER'`,
    );
    expect(rows[0]!.count).toBe('1');
  });

  it('does not record a write that changes nothing', async () => {
    // `update ... of role` fires the trigger even when the value is unchanged.
    // An unchanged role is not an event, and recording it would bury the ones
    // that are.
    const before = (await roleAudit(member)).length;
    await db.query(
      `update public.access_grants set role = 'OWNER', granted_at = now() where user_id = $1`,
      [member.userId],
    );
    expect((await roleAudit(member)).length).toBe(before);
  });

  it('writes exactly one row when the application changes a role, not two', async () => {
    /*
     * The trigger replaced the hand-written insert inside `owner_set_role`. If
     * that insert had been left in place the audit would double every
     * application change - worse than incomplete, because it would look
     * deliberate.
     */
    const subject = await createAccount(db, 'clan-audit-2@example.invalid');
    await completeProfile(db, subject.userId, 'Clan Audit Dva');

    const before = (await roleAudit(subject)).length;
    // Post-P5 owner_set_role is baseline-only; the grant change it still makes
    // (a baseline transition) is what must audit exactly once.
    await asUserCommitted(db, member.userId, (client) =>
      client.query(`select public.owner_set_role($1, $2)`, [subject.userId, 'PENDING']),
    );

    const rows = await roleAudit(subject);
    expect(rows.length, 'one change, one row').toBe(before + 1);

    const written = rows[rows.length - 1]!;
    expect(written.next_role).toBe('PENDING');
    // Through the application there IS a session, so the actor is recorded.
    expect(written.changed_by, 'and the application records who did it').toBe(member.userId);
  });

  it('records a service membership changed by raw SQL too', async () => {
    const { rows: orgs } = await db.query<{ id: string }>(
      `select id from public.organizations where code = $1`,
      [DVD],
    );
    const organizationId = orgs[0]!.id;

    const before = (await membershipAudit(owner)).length;
    await db.query(
      `insert into public.organization_memberships(organization_id, user_id, role, active)
       values ($1, $2, 'FIREFIGHTER', true)
       on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
      [organizationId, owner.userId],
    );

    const rows = await membershipAudit(owner);
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1]!.next_role).toBe('FIREFIGHTER');
    expect(rows[rows.length - 1]!.next_active).toBe(true);
  });

  it('still lets a signed-in person read the audit, and never write it', async () => {
    // The application role could never forge these rows - it holds SELECT only.
    // Pinned here because it is the half of "cannot fabricate" that IS true,
    // and it would be easy to lose in a future grant change.
    await asUser(db, member.userId, async (client) => {
      await expect(
        client.query(
          `insert into public.role_audit(target_user_id, previous_role, next_role, changed_by)
           values ($1, 'CITIZEN', 'OWNER', $1)`,
          [member.userId],
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    const readable = await asUser(db, member.userId, async (client) => {
      const { rows } = await client.query(`select count(*)::text as count from public.role_audit`);
      return rows[0] as { count: string };
    });
    expect(Number(readable.count)).toBeGreaterThan(0);
  });

  it('refuses the role change outright when the audit row does not appear', async () => {
    /*
     * The independent guarantee, and the reason `owner_set_role` did not simply
     * lose its own insert.
     *
     * Deleting that insert would have been a real loss: the function's write
     * was a guarantee that did not depend on the trigger, and without it,
     * disabling one trigger silently removes auditing from the application path
     * too. That was measured before this assertion existed - with the trigger
     * off, `owner_set_role` changed a role to FIREFIGHTER and recorded nothing.
     *
     * So the function asserts rather than duplicates. Redundancy becomes a
     * tripwire: when auditing stops working, role changes stop working.
     *
     * Disabling the trigger here is the only honest way to prove it. It is not
     * a contrived condition - `alter table ... disable trigger` is exactly what
     * a superuser can do to this system, and is named in the migration header
     * as one of the things no trigger can prevent.
     */
    const subject = await createAccount(db, 'clan-failclosed@example.invalid');
    await completeProfile(db, subject.userId, 'Clan Fail Closed');
    const before = await roleAudit(subject);

    await db.query(
      `alter table public.access_grants disable trigger audit_access_grant_role_change`,
    );
    let message = '';
    try {
      // A baseline transition (CITIZEN -> PENDING): the grant change owner_set_role
      // still makes post-P5, and the one whose audit the tripwire guards.
      await asUserCommitted(db, member.userId, (client) =>
        client.query(`select public.owner_set_role($1, $2)`, [subject.userId, 'PENDING']),
      );
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await db.query(
        `alter table public.access_grants enable trigger audit_access_grant_role_change`,
      );
    }

    expect(message, 'it refuses loudly rather than changing quietly').toMatch(/AUDIT_NOT_WRITTEN/);

    const { rows } = await db.query<{ role: string }>(
      `select role from public.access_grants where user_id = $1`,
      [subject.userId],
    );
    expect(rows[0]!.role, 'and the change is rolled back, not silently applied').toBe('CITIZEN');
    expect(await roleAudit(subject), 'and no audit row was left behind either').toHaveLength(
      before.length,
    );
  });

  it('refuses a service assignment whose membership audit does not appear', async () => {
    /*
     * The same tripwire on the other function that gave up its own insert.
     * Leaving `owner_set_organization_membership` without it would mean the two
     * fail differently, and the weaker one is the one nobody remembers.
     */
    const subject = await createAccount(db, 'clan-svc-failclosed@example.invalid');
    await completeProfile(db, subject.userId, 'Clan Servis');

    await db.query(
      `alter table public.organization_memberships disable trigger audit_organization_membership_change`,
    );
    let message = '';
    try {
      await asUserCommitted(db, member.userId, (client) =>
        client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
          subject.userId,
          DVD,
          'FIREFIGHTER',
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await db.query(
        `alter table public.organization_memberships enable trigger audit_organization_membership_change`,
      );
    }

    expect(message).toMatch(/AUDIT_NOT_WRITTEN/);
    const { rows } = await db.query(
      `select 1 from public.organization_memberships om
         join public.organizations o on o.id = om.organization_id
        where om.user_id = $1 and o.code = $2`,
      [subject.userId, DVD],
    );
    expect(rows, 'the membership was rolled back, not left behind').toHaveLength(0);
  });

  it('no longer writes access_grants when assigning a service (P5 retired the mirror)', async () => {
    /*
     * Pre-P5 the service assignment audited two facts: the membership, and the
     * global role it mirrored into `access_grants`. 202609250038 retired that
     * mirror, so a service assignment touches only the membership. Proven the
     * strong way: with the ACCESS_GRANTS audit trigger disabled - the condition
     * that used to make the mirror's second write fail closed - the call now
     * SUCCEEDS (there is no grant write to audit), the grant stays at its
     * baseline, and the membership and its audit are written as before.
     */
    const subject = await createAccount(db, 'clan-mirror-retired@example.invalid');
    await completeProfile(db, subject.userId, 'Clan Mirror');
    const before = (await membershipAudit(subject)).length;

    await db.query(
      `alter table public.access_grants disable trigger audit_access_grant_role_change`,
    );
    let message = '';
    try {
      await asUserCommitted(db, member.userId, (client) =>
        client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
          subject.userId,
          DVD,
          'FIREFIGHTER',
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await db.query(
        `alter table public.access_grants enable trigger audit_access_grant_role_change`,
      );
    }

    expect(message, 'the assignment no longer writes access_grants, so nothing fails closed there').toBe('');
    const { rows } = await db.query<{ role: string }>(
      `select role from public.access_grants where user_id = $1`,
      [subject.userId],
    );
    expect(rows[0]!.role, 'the grant is left at its baseline, unmirrored').toBe('CITIZEN');
    expect(await membershipAudit(subject), 'and the membership itself is audited as before').toHaveLength(
      before + 1,
    );
  });

  it('lets a service no-op through, and a stand-down with nothing to stand down', async () => {
    // Two shapes the assertion must NOT fire on, because the trigger correctly
    // writes nothing for either: re-assigning the role already held, and
    // standing down an account that has no membership at all.
    const subject = await createAccount(db, 'clan-svc-noop@example.invalid');
    await completeProfile(db, subject.userId, 'Clan Servis No Op');

    await asUserCommitted(db, member.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        subject.userId,
        DVD,
        'FIREFIGHTER',
      ]),
    );
    const settled = (await membershipAudit(subject)).length;

    // Same role again - nothing changes, nothing audits, no complaint.
    await asUserCommitted(db, member.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        subject.userId,
        DVD,
        'FIREFIGHTER',
      ]),
    );
    expect(await membershipAudit(subject)).toHaveLength(settled);

    // Standing down an account with no membership at all is also a no-op.
    const bare = await createAccount(db, 'clan-svc-bare@example.invalid');
    await completeProfile(db, bare.userId, 'Clan Bez Sluzbe');
    await asUserCommitted(db, member.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, $2, $3)`, [
        bare.userId,
        DVD,
        'NONE',
      ]),
    );
    expect(await membershipAudit(bare)).toHaveLength(0);
  });

  it('still allows a no-op write, which legitimately audits nothing', async () => {
    // The assertion must not fire when the trigger correctly stays silent. An
    // unchanged role is not an event, so asserting on it would turn a harmless
    // write into an outage - the exact over-reach this guard must avoid.
    const subject = await createAccount(db, 'clan-noop@example.invalid');
    await completeProfile(db, subject.userId, 'Clan No Op');
    await asUserCommitted(db, member.userId, (client) =>
      client.query(`select public.owner_set_role($1, $2)`, [subject.userId, 'PENDING']),
    );
    const before = await roleAudit(subject);

    // Same value again: the trigger writes nothing and the function must not
    // complain about it.
    await asUserCommitted(db, member.userId, (client) =>
      client.query(`select public.owner_set_role($1, $2)`, [subject.userId, 'PENDING']),
    );

    expect(await roleAudit(subject)).toHaveLength(before.length);
  });
});
