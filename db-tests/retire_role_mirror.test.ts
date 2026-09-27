/**
 * P5: membership is the only statement of operational authority.
 *
 * Until 202609250038 two copies of "who serves in DVD" were kept in step by a
 * mirror: `access_grants.role` and the DVD `organization_memberships` row.
 * Authority already resolved from the membership (P3's `current_role_in`), so the
 * grant's operational value was a second copy that could only agree or disagree.
 * P5 retires the mirror: the grant carries only the installation-wide baseline
 * (OWNER, plus CITIZEN/PENDING), and the membership carries the operational role.
 *
 * The first describe runs on the pre-P5 schema and shows the grant was
 * authoritative through the mirror - the behaviour P5 removes. The second applies
 * P5 and proves the four acceptance criteria and the cases that must be preserved.
 *
 * Everything runs inside one committed fixture and per-test transactions
 * (`isolated`), with role switches done by savepoint (`asRole`) so a mutating
 * test cannot leak into the next.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, completeProfile, connect, createAccount, createMember, grantRole } from './harness';

const P5 = 'supabase/migrations/202609250038_retire_dvd_role_mirror.sql';
const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

const sqlFile = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

interface Person {
  userId: string;
  memberId?: string;
}
const cast = {} as Record<
  'owner' | 'existingCommander' | 'existingFirefighter' | 'citizen' | 'dual',
  Person
>;

async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

/** Runs `work` as `userId` with RLS in force, in a savepoint inside the caller's open transaction. */
async function asRole<T>(userId: string, work: (client: Client) => Promise<T>): Promise<T> {
  await db.query('savepoint as_role');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
    const result = await work(db);
    await db.query('reset role');
    await db.query('release savepoint as_role');
    return result;
  } catch (error) {
    await db.query('rollback to savepoint as_role');
    await db.query('reset role');
    throw error;
  }
}

/** One command as `userId`, in a savepoint: 'OK' or the exception's own code. */
async function commandAs(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  try {
    await asRole(userId, (client) => client.query(statement, params));
    return 'OK';
  } catch (error) {
    const message = (error as Error).message;
    return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

const roleIn = (userId: string, org: string) =>
  asRole(userId, async (client) =>
    (await client.query<{ role: string | null }>('select public.current_role_in($1) as role', [org])).rows[0]!.role,
  );
const dvdRole = (userId: string) =>
  asRole(userId, async (client) =>
    (await client.query<{ role: string | null }>('select public.current_dvd_role() as role')).rows[0]!.role,
  );
const ownMemberId = (userId: string) =>
  asRole(userId, async (client) =>
    (await client.query<{ id: string | null }>('select public.current_member_id() as id')).rows[0]!.id,
  );

/** A raw change to the account's global grant, as the superuser - no command, no mirror. */
const rawGrant = (userId: string, role: string) =>
  db.query(`update public.access_grants set role = $2 where user_id = $1`, [userId, role]);

async function account(email: string, name: string): Promise<Person> {
  const created = await createAccount(db, email);
  await completeProfile(db, created.userId, name);
  return { userId: created.userId };
}

beforeAll(async () => {
  db = await connect();
  await db.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  // Everything up to (not including) P5: the mirror is still present, so the
  // first describe can show it. Until P5 exists this is every migration there is.
  const index = MIGRATIONS.indexOf(P5);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sqlFile(file));
  }

  // Built while the mirror is present: grantRole writes the grant, and (pre-P5)
  // the trigger turns it into the DVD membership; from P5 on the helper writes
  // the membership itself. Either way these accounts have the memberships that
  // carry authority, which is what "existing staff keep their powers" needs.
  cast.owner = await account('p5-owner@example.invalid', 'Vlasnik Pet');
  await grantRole(db, cast.owner.userId, 'OWNER'); // no membership, by design

  cast.existingCommander = await account('p5-cmd@example.invalid', 'Postojeci Komandir');
  await grantRole(db, cast.existingCommander.userId, 'COMMANDER');
  cast.existingCommander.memberId = await createMember(db, 'Postojeci Komandir', cast.existingCommander.userId);

  cast.existingFirefighter = await account('p5-ff@example.invalid', 'Postojeci Vatrogasac');
  await grantRole(db, cast.existingFirefighter.userId, 'FIREFIGHTER');
  cast.existingFirefighter.memberId = await createMember(db, 'Postojeci Vatrogasac', cast.existingFirefighter.userId);

  cast.citizen = await account('p5-citizen@example.invalid', 'Obicni Gradjanin');

  // A dual-service person: a DVD membership (via the grant) and an SZS one, with
  // a separate member record in each service.
  cast.dual = await account('p5-dual@example.invalid', 'Clan Dvije Sluzbe');
  await grantRole(db, cast.dual.userId, 'FIREFIGHTER');
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active, granted_by, granted_at)
     values ($1, $2, 'COMMANDER', true, $2, now())
     on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
    [SZS, cast.dual.userId],
  );
  cast.dual.memberId = await createMember(db, 'Clan DVD', cast.dual.userId);
  await db.query(
    `insert into public.members(full_name, user_id, organization_id, active) values ($1, $2, $3, true)`,
    ['Clan SZS', cast.dual.userId, SZS],
  );
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before P5: the grant is authoritative through the mirror', () => {
  it('a raw change to access_grants.role moves operational access', async () => {
    await isolated(async () => {
      expect(await dvdRole(cast.citizen.userId)).toBeNull();
      // Raw grant to COMMANDER: the mirror creates the DVD membership, so access appears.
      await rawGrant(cast.citizen.userId, 'COMMANDER');
      expect(await dvdRole(cast.citizen.userId)).toBe('COMMANDER');
      // Raw grant back to CITIZEN: the mirror stands the membership down.
      await rawGrant(cast.citizen.userId, 'CITIZEN');
      expect(await dvdRole(cast.citizen.userId)).toBeNull();
    });
  });

  it('the mirror trigger and its function exist', async () => {
    const { rows } = await db.query<{ trg: number; fn: number }>(
      `select (select count(*) from pg_trigger where tgname = 'sync_dvd_membership_after_grant')::int as trg,
              (select count(*) from pg_proc where proname = 'sync_dvd_membership_from_grant')::int as fn`,
    );
    expect(rows[0]).toEqual({ trg: 1, fn: 1 });
  });
});

describe('after P5: membership is the only statement of authority', () => {
  beforeAll(async () => {
    if (MIGRATIONS.includes(P5)) await db.query(sqlFile(P5));
  }, 60_000);

  it('the mirror is gone: trigger and function dropped', async () => {
    const { rows } = await db.query<{ trg: number; fn: number }>(
      `select (select count(*) from pg_trigger where tgname = 'sync_dvd_membership_after_grant')::int as trg,
              (select count(*) from pg_proc where proname = 'sync_dvd_membership_from_grant')::int as fn`,
    );
    expect(rows[0]).toEqual({ trg: 0, fn: 0 });
  });

  // Criterion 1.
  it('a change to access_grants.role no longer changes operational access', async () => {
    await isolated(async () => {
      expect(await dvdRole(cast.existingFirefighter.userId)).toBe('FIREFIGHTER');
      await rawGrant(cast.existingFirefighter.userId, 'CITIZEN');
      expect(await dvdRole(cast.existingFirefighter.userId), 'membership unchanged by the grant').toBe('FIREFIGHTER');
      await rawGrant(cast.existingFirefighter.userId, 'ADMIN');
      expect(await dvdRole(cast.existingFirefighter.userId)).toBe('FIREFIGHTER');
      // A citizen given an operational grant directly gains nothing.
      await rawGrant(cast.citizen.userId, 'COMMANDER');
      expect(await dvdRole(cast.citizen.userId)).toBeNull();
    });
  });

  // Criterion 2.
  it('suspending an account removes access in both services at once', async () => {
    await isolated(async () => {
      expect(await roleIn(cast.dual.userId, DVD)).toBe('FIREFIGHTER');
      expect(await roleIn(cast.dual.userId, SZS)).toBe('COMMANDER');
      expect(
        await commandAs(cast.owner.userId, 'select public.owner_set_account_active($1, false, $2)', [
          cast.dual.userId,
          'P5 test suspenzija',
        ]),
      ).toBe('OK');
      expect(await roleIn(cast.dual.userId, DVD)).toBeNull();
      expect(await roleIn(cast.dual.userId, SZS)).toBeNull();
    });
  });

  // Criterion 3 + a preserved case.
  it('the owner keeps OWNER and full access with zero memberships, and still needs a member record to act as a firefighter', async () => {
    await isolated(async () => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.organization_memberships where user_id = $1`,
        [cast.owner.userId],
      );
      expect(rows[0]!.n, 'the owner holds no membership row').toBe(0);
      expect(await dvdRole(cast.owner.userId)).toBe('OWNER');
      expect(await roleIn(cast.owner.userId, SZS)).toBe('OWNER');
      const isOwner = await asRole(cast.owner.userId, async (client) =>
        (await client.query<{ v: boolean }>('select public.is_installation_owner() as v')).rows[0]!.v,
      );
      expect(isOwner).toBe(true);
      // Full administrative access, but not an operational member without a record.
      expect(await ownMemberId(cast.owner.userId), 'not a firefighter without a member record').toBeNull();
    });
  });

  // Criterion 4.
  it('the audit tripwires still fire on both owner commands', async () => {
    await isolated(async () => {
      await db.query(`alter table public.access_grants disable trigger audit_access_grant_role_change`);
      expect(
        await commandAs(cast.owner.userId, 'select public.owner_set_role($1, $2)', [cast.citizen.userId, 'PENDING']),
      ).toBe('AUDIT_NOT_WRITTEN');
    });
    await isolated(async () => {
      await db.query(`alter table public.organization_memberships disable trigger audit_organization_membership_change`);
      expect(
        await commandAs(cast.owner.userId, 'select public.owner_set_organization_membership($1, $2, $3)', [
          cast.citizen.userId,
          'DVD',
          'FIREFIGHTER',
        ]),
      ).toBe('AUDIT_NOT_WRITTEN');
    });
  });

  // Preserved case: existing DVD staff keep their powers.
  it('existing DVD firefighters and commanders keep their DVD authority', async () => {
    await isolated(async () => {
      expect(await dvdRole(cast.existingCommander.userId)).toBe('COMMANDER');
      expect(await dvdRole(cast.existingFirefighter.userId)).toBe('FIREFIGHTER');
    });
  });

  // Preserved case: a new account starts a citizen; the owner assigns via membership.
  it('a new account is a citizen, and the owner assigns a service through membership', async () => {
    await isolated(async () => {
      expect(await dvdRole(cast.citizen.userId)).toBeNull();
      expect(
        await commandAs(cast.owner.userId, 'select public.owner_set_organization_membership($1, $2, $3)', [
          cast.citizen.userId,
          'DVD',
          'FIREFIGHTER',
        ]),
      ).toBe('OK');
      expect(await dvdRole(cast.citizen.userId)).toBe('FIREFIGHTER');
      const { rows } = await db.query<{ role: string }>('select role from public.access_grants where user_id = $1', [
        cast.citizen.userId,
      ]);
      expect(rows[0]!.role, 'the grant stays at the CITIZEN baseline').toBe('CITIZEN');
    });
  });

  // Preserved case: dual-service is two independent memberships.
  it('a dual-service person has independent state per service; standing down one leaves the other', async () => {
    await isolated(async () => {
      expect(await roleIn(cast.dual.userId, DVD)).toBe('FIREFIGHTER');
      expect(await roleIn(cast.dual.userId, SZS)).toBe('COMMANDER');
      expect(
        await commandAs(cast.owner.userId, 'select public.owner_set_organization_membership($1, $2, $3)', [
          cast.dual.userId,
          'DVD',
          'NONE',
        ]),
      ).toBe('OK');
      expect(await roleIn(cast.dual.userId, DVD), 'DVD stood down').toBeNull();
      expect(await roleIn(cast.dual.userId, SZS), 'SZS untouched').toBe('COMMANDER');
    });
  });

  it('owner_set_role is baseline-only: it refuses an operational role', async () => {
    await isolated(async () => {
      expect(
        await commandAs(cast.owner.userId, 'select public.owner_set_role($1, $2)', [cast.citizen.userId, 'COMMANDER']),
      ).toBe('ROLE_NOT_ASSIGNABLE');
    });
  });

  it('is a no-op to apply twice', async () => {
    const shape = async () =>
      (await db.query<{ h: string }>(
        `select md5(coalesce((select string_agg(x, '|' order by x) from (
                                select tgname || pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal) t), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select proname || md5(pg_get_functiondef(oid)) as x from pg_proc
                                   where pronamespace = 'public'::regnamespace) f), '')) as h`,
      )).rows[0]!.h;
    const before = await shape();
    await isolated(async () => {
      await db.query(sqlFile(P5));
      expect(await shape()).toBe(before);
    });
  });
});
