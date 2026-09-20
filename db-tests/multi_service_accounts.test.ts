import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  expectRefused,
  grantRole,
  resetSchema,
} from './harness';

let db: Client;
let owner: string;
let target: string;
let firefighter: string;

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  const make = async (email: string, name: string, role: string): Promise<string> => {
    const account = await createAccount(db, email);
    await completeProfile(db, account.userId, name);
    await grantRole(db, account.userId, role);
    return account.userId;
  };

  owner = await make('owner-services@example.invalid', 'Vlasnik Sistema', 'OWNER');
  target = await make('target-services@example.invalid', 'Clan Za Sluzbe', 'PENDING');
  firefighter = await make('ordinary-services@example.invalid', 'Obicni Vatrogasac', 'FIREFIGHTER');
}, 60_000);

afterAll(async () => {
  await db?.end();
});

async function memberships(userId: string) {
  const { rows } = await db.query<{ code: string; role: string; active: boolean }>(
    `select organization.code, membership.role, membership.active
       from public.organization_memberships membership
       join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = $1 order by organization.code`,
    [userId],
  );
  return rows;
}

describe('owner multi-service account administration', () => {
  it('assigns DVD access and the operational grant in one transaction', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'DVD', 'FIREFIGHTER')`, [target]),
    );

    expect(await memberships(target)).toContainEqual({ code: 'DVD', role: 'FIREFIGHTER', active: true });
    const role = await asUser(db, target, async (client) => {
      const { rows } = await client.query<{ role: string | null }>('select public.current_dvd_role() as role');
      return rows[0]!.role;
    });
    expect(role).toBe('FIREFIGHTER');
  });

  it('adds an independent SZS role without widening DVD authority', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'SZS', 'COMMANDER')`, [target]),
    );

    expect(await memberships(target)).toEqual([
      { code: 'DVD', role: 'FIREFIGHTER', active: true },
      { code: 'SZS', role: 'COMMANDER', active: true },
    ]);
    const { rows } = await db.query('select role from public.access_grants where user_id = $1', [target]);
    expect(rows[0]!.role).toBe('FIREFIGHTER');
  });

  it('removes DVD access while preserving the SZS membership', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'DVD', 'NONE')`, [target]),
    );

    expect(await memberships(target)).toEqual([
      { code: 'DVD', role: 'FIREFIGHTER', active: false },
      { code: 'SZS', role: 'COMMANDER', active: true },
    ]);
    const role = await asUser(db, target, async (client) => {
      const { rows } = await client.query<{ role: string | null }>('select public.current_dvd_role() as role');
      return rows[0]!.role;
    });
    expect(role).toBeNull();
  });

  it('refuses every non-owner and protects the owner account', async () => {
    expect(
      await expectRefused(db, firefighter, (client) =>
        client.query(`select public.owner_set_organization_membership($1, 'SZS', 'ADMIN')`, [target]),
      ),
    ).toContain('OWNER_REQUIRED');
    expect(
      await expectRefused(db, owner, (client) =>
        client.query(`select public.owner_set_organization_membership($1, 'SZS', 'ADMIN')`, [owner]),
      ),
    ).toContain('CANNOT_CHANGE_OWN_ROLE');
  });

  it('lets users read only their memberships while the owner sees the directory', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'SZS', 'FIREFIGHTER')`, [
        firefighter,
      ]),
    );
    const ownCount = await asUser(db, target, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        'select count(*)::text as count from public.organization_memberships',
      );
      return Number(rows[0]!.count);
    });
    expect(ownCount).toBe(2);

    const ownerCount = await asUser(db, owner, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        'select count(*)::text as count from public.organization_memberships',
      );
      return Number(rows[0]!.count);
    });
    expect(ownerCount).toBe(4);
  });

  it('records organization, role and actor in the audit', async () => {
    const { rows } = await db.query(
      `select organization.code, audit.next_role, audit.next_active, audit.changed_by
         from public.organization_membership_audit audit
         join public.organizations organization on organization.id = audit.organization_id
        where audit.target_user_id = $1 and organization.code = 'SZS'`,
      [target],
    );
    expect(rows).toContainEqual({ code: 'SZS', next_role: 'COMMANDER', next_active: true, changed_by: owner });
  });
});
