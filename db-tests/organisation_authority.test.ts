/**
 * The authority model learns about services, and nothing else changes.
 *
 * `202609240023` introduces `current_role_in(organisation)` and its family, then
 * reimplements `current_dvd_role()` as a shim over `current_role_in(DVD)`. All
 * fifty-one policies keep their present text and resolve through the new path
 * instead of the old one. No policy changes, no command changes, no call site
 * changes. This is the phase whose entire job is to prove the two models are
 * the same before anything is allowed to depend on that.
 *
 * ---------------------------------------------------------------------------
 * Why the shim cannot simply read memberships
 * ---------------------------------------------------------------------------
 *
 * `sync_dvd_membership_from_grant` mirrors an operational grant into an active
 * DVD membership, so the two mostly agree. Two places they deliberately do not,
 * both measured on the hosted project rather than reasoned about:
 *
 *   grant        active  profile  DVD membership     current_dvd_role() today
 *   OWNER        yes     yes      NONE               OWNER
 *   FIREFIGHTER  no      no       FIREFIGHTER active NULL
 *
 * The first is the installation owner - the mirror deactivates an owner's DVD
 * membership on purpose, so a shim reading only memberships would lock the
 * owner out of their own installation. The second is a suspended account: the
 * mirror fires on `update of role` and never on `active`, so suspension leaves
 * the membership standing and only the account-level gate stops it.
 *
 * Both gates are therefore load-bearing, and both have a live row behind them.
 *
 * ---------------------------------------------------------------------------
 * What equivalence has to mean here
 * ---------------------------------------------------------------------------
 *
 * Not "the new function looks right". The suite builds one account per
 * combination of role, suspension and profile completeness, records what
 * `current_dvd_role()` answers for every one of them BEFORE the migration, then
 * applies it and asks again. A single differing answer fails the phase, and the
 * failure names the account.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, asUser, asUserCommitted, connect, createAccount } from './harness';

const AUTHORITY = 'supabase/migrations/202609240023_organisation_authority.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

const ROLES = ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER', 'PENDING', 'CITIZEN'] as const;

interface Scenario {
  label: string;
  userId: string;
  /** Puts the account into this scenario's state. Re-runnable. */
  prepare: () => Promise<void>;
}

let db: Client;
const scenarios: Scenario[] = [];
const before = new Map<string, string | null>();
const after = new Map<string, string | null>();
let ownerUserId = '';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

/** What `current_dvd_role()` answers for this account, asked as this account. */
async function dvdRoleFor(userId: string): Promise<string | null> {
  return asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ role: string | null }>(
      `select public.current_dvd_role() as role`,
    );
    return rows[0]!.role;
  });
}

async function boolFor(userId: string, expression: string): Promise<boolean> {
  return asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ value: boolean }>(`select ${expression} as value`);
    return rows[0]!.value;
  });
}

async function setProfileComplete(userId: string, complete: boolean, name: string): Promise<void> {
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456',
            date_of_birth = date '1990-01-01', profile_complete = $3
      where user_id = $1`,
    [userId, name, complete],
  );
}

/** Walks every scenario and records what the DVD role function answers. */
async function snapshot(into: Map<string, string | null>): Promise<void> {
  for (const scenario of scenarios) {
    await scenario.prepare();
    into.set(scenario.label, await dvdRoleFor(scenario.userId));
  }
}

/** The owner account, back in the state the rest of the suite expects. */
async function restoreOwner(): Promise<void> {
  await setProfileComplete(ownerUserId, true, 'Vlasnik Instalacije');
  await db.query(
    `update public.access_grants set role = 'OWNER', active = true where user_id = $1`,
    [ownerUserId],
  );
}

beforeAll(async () => {
  db = await connect();

  // Stage one: everything up to but NOT including this migration.
  await db.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  // Strictly before, not "everything except". Filtering works only while this
  // file is last in the list; slicing keeps working when it is not, which is
  // the bug P3 exposed in 202609240022's own test.
  const index = MIGRATIONS.indexOf(AUTHORITY);
  expect(index, 'the migration must be in the list').toBeGreaterThan(-1);
  for (const file of MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  /*
   * Every combination the present function actually reads: the six role values,
   * suspended or not, profile finished or not. Written directly into the columns
   * rather than through the owner command, because the command refuses most of
   * these states and the point is to cover what the DATABASE can hold.
   *
   * OWNER is the exception. `access_grants_single_owner` is a partial unique
   * index over `(true) where role = 'OWNER'`, so exactly one owner row may exist
   * at a time - four owner accounts is not a state this installation can be in.
   * Its four combinations therefore share one account and are reached by moving
   * it through them, which is why a scenario is a preparation step rather than
   * an account.
   */
  const ownerAccount = await createAccount(db, 'vlasnik.matrica@example.invalid');
  ownerUserId = ownerAccount.userId;

  for (const role of ROLES) {
    for (const active of [true, false]) {
      for (const complete of [true, false]) {
        const label = `${role}/${active ? 'active' : 'suspended'}/${complete ? 'complete' : 'incomplete'}`;

        if (role === 'OWNER') {
          scenarios.push({
            label,
            userId: ownerUserId,
            prepare: async () => {
              await setProfileComplete(ownerUserId, complete, 'Vlasnik Instalacije');
              await db.query(
                `update public.access_grants set role = 'OWNER', active = $2 where user_id = $1`,
                [ownerUserId, active],
              );
            },
          });
          continue;
        }

        const account = await createAccount(
          db,
          `${role}.${active}.${complete}@example.invalid`.toLowerCase(),
        );
        scenarios.push({
          label,
          userId: account.userId,
          prepare: async () => {
            await setProfileComplete(account.userId, complete, `Osoba ${label}`);
            await db.query(`update public.access_grants set role = $2 where user_id = $1`, [
              account.userId,
              role,
            ]);
            await db.query(`update public.access_grants set active = $2 where user_id = $1`, [
              account.userId,
              active,
            ]);
          },
        });
      }
    }
  }

  // Two states the matrix cannot reach by construction.
  const noGrant = await createAccount(db, 'bez.dozvole@example.invalid');
  scenarios.push({
    label: 'no grant row at all',
    userId: noGrant.userId,
    prepare: async () => {
      await setProfileComplete(noGrant.userId, true, 'Bez Dozvole');
      await db.query(`delete from public.access_grants where user_id = $1`, [noGrant.userId]);
    },
  });

  // An SZS membership must not, on its own, mean anything to DVD.
  const szsOnly = await createAccount(db, 'samo.szs@example.invalid');
  scenarios.push({
    label: 'SZS commander, nothing in DVD',
    userId: szsOnly.userId,
    prepare: async () => {
      await setProfileComplete(szsOnly.userId, true, 'Samo SZS');
      await db.query(
        `insert into public.organization_memberships(organization_id, user_id, role, active)
         values ($1, $2, 'COMMANDER', true)
         on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
        [SZS, szsOnly.userId],
      );
    },
  });

  await snapshot(before);

  // Stage two: the migration under test, then the same walk again.
  await db.query(sql(AUTHORITY));
  await snapshot(after);

  await restoreOwner();
});

afterAll(async () => db?.end());

describe('the shimmed current_dvd_role answers exactly what it used to', () => {
  it('covers the whole matrix, so the comparison is worth something', () => {
    // 6 roles x active/suspended x complete/incomplete, plus the two edge cases.
    expect(scenarios).toHaveLength(ROLES.length * 2 * 2 + 2);
    expect(before.size).toBe(scenarios.length);
    expect(after.size).toBe(scenarios.length);
  });

  it('gives an identical answer for every account', () => {
    const divergences = scenarios
      .filter((scenario) => after.get(scenario.label) !== before.get(scenario.label))
      .map(
        (scenario) =>
          `${scenario.label}: was ${before.get(scenario.label) ?? 'NULL'}, ` +
          `now ${after.get(scenario.label) ?? 'NULL'}`,
      );
    expect(divergences, 'the shim is not equivalent').toEqual([]);
  });

  it('really did exercise both answers, not only NULL', () => {
    // A matrix that produced NULL everywhere would pass the test above while
    // proving nothing at all.
    const answers = [...before.values()];
    expect(answers.filter((value) => value !== null).length, 'no account had a role').toBeGreaterThan(0);
    expect(answers.filter((value) => value === null).length, 'no account was refused').toBeGreaterThan(0);
    expect(new Set(answers.filter((value) => value !== null))).toEqual(
      new Set(['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER']),
    );
  });

  it('keeps the derived predicates in step with it', async () => {
    for (const scenario of scenarios) {
      await scenario.prepare();
      const role = await dvdRoleFor(scenario.userId);
      const staff = await boolFor(scenario.userId, 'public.is_dvd_staff()');
      const command = await boolFor(scenario.userId, 'public.is_dvd_command()');
      const owner = await boolFor(scenario.userId, 'public.is_dvd_owner()');

      expect(staff, `${scenario.label} staff`).toBe(
        role !== null && ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'].includes(role),
      );
      expect(command, `${scenario.label} command`).toBe(
        role !== null && ['OWNER', 'ADMIN', 'COMMANDER'].includes(role),
      );
      expect(owner, `${scenario.label} owner`).toBe(role === 'OWNER');
    }
    await restoreOwner();
  });
});

describe('the installation owner is not a member of anything', () => {
  it('holds authority with no membership at all, which is the live arrangement', async () => {
    /*
     * The hosted project's owner has NO DVD membership - the mirror deactivates
     * an owner's membership deliberately. A shim that read memberships alone
     * would lock the owner out of their own installation, so this is the single
     * most important row in the matrix above.
     */
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.organization_memberships
        where user_id = $1 and active = true`,
      [ownerUserId],
    );
    expect(rows[0]!.n, 'the fixture owner has no memberships either').toBe('0');

    expect(await boolFor(ownerUserId, 'public.is_installation_owner()')).toBe(true);
    expect(await boolFor(ownerUserId, `public.is_command_in('${DVD}')`)).toBe(true);
    expect(await boolFor(ownerUserId, `public.is_command_in('${SZS}')`)).toBe(true);
    expect(await boolFor(ownerUserId, `public.is_admin_in('${SZS}')`)).toBe(true);
    expect(await dvdRoleFor(ownerUserId)).toBe('OWNER');
  });

  it('is not the owner when suspended or half-registered', async () => {
    for (const label of [
      'OWNER/suspended/complete',
      'OWNER/active/incomplete',
      'OWNER/suspended/incomplete',
    ]) {
      const scenario = scenarios.find((s) => s.label === label)!;
      await scenario.prepare();
      expect(await boolFor(scenario.userId, 'public.is_installation_owner()'), label).toBe(false);
      expect(await boolFor(scenario.userId, `public.is_command_in('${DVD}')`), label).toBe(false);
    }
    await restoreOwner();
  });
});

describe('the two services do not see each other', () => {
  /*
   * A DVD membership is made by setting the grant and letting
   * `sync_dvd_membership_from_grant` mirror it, because that is the only way one
   * is ever made. Inserting the row directly produces a grant and a membership
   * that disagree - a state the installation cannot reach - and the invariant
   * test at the bottom of this file rightly fails on it. SZS has no mirror, so
   * there the row IS the way.
   */
  async function serviceMember(email: string, organisation: string, role: string): Promise<string> {
    const account = await createAccount(db, email);
    await db.query(
      `update public.profiles set full_name = 'Clan Sluzbe', phone_e164 = '+38267123456',
          date_of_birth = date '1990-01-01', profile_complete = true where user_id = $1`,
      [account.userId],
    );
    if (organisation === DVD) {
      await db.query(`update public.access_grants set role = $2 where user_id = $1`, [
        account.userId,
        role,
      ]);
    } else {
      await db.query(
        `insert into public.organization_memberships(organization_id, user_id, role, active)
         values ($1, $2, $3, true)
         on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
        [organisation, account.userId, role],
      );
    }
    return account.userId;
  }

  it('gives a commander authority in their own service and none in the other', async () => {
    const dvdCommander = await serviceMember('komandir.dvd@example.invalid', DVD, 'COMMANDER');
    const szsCommander = await serviceMember('komandir.szs@example.invalid', SZS, 'COMMANDER');

    expect(await boolFor(dvdCommander, `public.is_command_in('${DVD}')`)).toBe(true);
    expect(await boolFor(dvdCommander, `public.is_command_in('${SZS}')`)).toBe(false);
    expect(await boolFor(szsCommander, `public.is_command_in('${SZS}')`)).toBe(true);
    expect(await boolFor(szsCommander, `public.is_command_in('${DVD}')`)).toBe(false);

    expect(await asUser(db, szsCommander, async (client) => {
      const { rows } = await client.query<{ role: string | null }>(
        `select public.current_role_in($1) as role`,
        [SZS],
      );
      return rows[0]!.role;
    })).toBe('COMMANDER');

    // And the old question still answers the old way: an SZS commander is
    // nobody in DVD, which is what every existing policy is still asking.
    expect(await dvdRoleFor(szsCommander)).toBeNull();
  });

  it('separates admin from command from staff within one service', async () => {
    const admin = await serviceMember('admin.szs@example.invalid', SZS, 'ADMIN');
    const firefighter = await serviceMember('vatrogasac.szs@example.invalid', SZS, 'FIREFIGHTER');

    expect(await boolFor(admin, `public.is_admin_in('${SZS}')`)).toBe(true);
    expect(await boolFor(admin, `public.is_command_in('${SZS}')`)).toBe(true);
    expect(await boolFor(admin, `public.is_staff_in('${SZS}')`)).toBe(true);

    expect(await boolFor(firefighter, `public.is_admin_in('${SZS}')`)).toBe(false);
    expect(await boolFor(firefighter, `public.is_command_in('${SZS}')`)).toBe(false);
    expect(await boolFor(firefighter, `public.is_staff_in('${SZS}')`)).toBe(true);
  });

  it('refuses a suspended account whatever its memberships say', async () => {
    // The live suspended firefighter still has an ACTIVE DVD membership, because
    // the mirror never fires on `active`. Only the account gate stops it, and
    // this is that gate.
    const suspended = await serviceMember('suspendovan.szs@example.invalid', SZS, 'COMMANDER');
    await db.query(`update public.access_grants set active = false where user_id = $1`, [suspended]);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.organization_memberships
        where user_id = $1 and active = true`,
      [suspended],
    );
    expect(rows[0]!.n, 'the membership is untouched by suspension').toBe('1');

    expect(await boolFor(suspended, `public.is_command_in('${SZS}')`)).toBe(false);
    expect(await boolFor(suspended, `public.is_staff_in('${SZS}')`)).toBe(false);
  });

  it('refuses a half-registered account whatever its memberships say', async () => {
    const incomplete = await serviceMember('nepotpun.szs@example.invalid', SZS, 'COMMANDER');
    await db.query(`update public.profiles set profile_complete = false where user_id = $1`, [
      incomplete,
    ]);
    expect(await boolFor(incomplete, `public.is_command_in('${SZS}')`)).toBe(false);
  });

  it('refuses an inactive membership', async () => {
    const stoodDown = await serviceMember('povucen.szs@example.invalid', SZS, 'COMMANDER');
    await db.query(
      `update public.organization_memberships set active = false
        where user_id = $1 and organization_id = $2`,
      [stoodDown, SZS],
    );
    expect(await boolFor(stoodDown, `public.is_command_in('${SZS}')`)).toBe(false);
  });
});

describe('the member record is resolved per service', () => {
  it('finds the right record when a person serves in both', async () => {
    /*
     * P2 made `members` unique per service so one person can hold a record in
     * each. That is what left `current_member_id()` able to match two rows and
     * return an arbitrary one. `current_member_id_in` is the answer, and
     * `current_member_id()` is now its DVD shim.
     */
    const account = await createAccount(db, 'oba.servisa@example.invalid');
    await db.query(
      `update public.profiles set full_name = 'Oba Servisa', phone_e164 = '+38267123456',
          date_of_birth = date '1990-01-01', profile_complete = true where user_id = $1`,
      [account.userId],
    );
    await db.query(`update public.access_grants set role = 'FIREFIGHTER' where user_id = $1`, [
      account.userId,
    ]);
    await db.query(
      `insert into public.organization_memberships(organization_id, user_id, role, active)
       values ($1, $2, 'FIREFIGHTER', true)`,
      [SZS, account.userId],
    );

    const { rows: dvdMember } = await db.query<{ id: string }>(
      `insert into public.members(full_name, user_id, organization_id)
       values ('Oba Servisa', $1, $2) returning id`,
      [account.userId, DVD],
    );
    const { rows: szsMember } = await db.query<{ id: string }>(
      `insert into public.members(full_name, user_id, organization_id)
       values ('Oba Servisa', $1, $2) returning id`,
      [account.userId, SZS],
    );

    const resolved = await asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ dvd: string | null; szs: string | null; legacy: string | null }>(
        `select public.current_member_id_in($1) as dvd,
                public.current_member_id_in($2) as szs,
                public.current_member_id() as legacy`,
        [DVD, SZS],
      );
      return rows[0]!;
    });

    expect(resolved.dvd, 'the DVD record').toBe(dvdMember[0]!.id);
    expect(resolved.szs, 'the SZS record').toBe(szsMember[0]!.id);
    expect(resolved.dvd).not.toBe(resolved.szs);
    // The shim keeps answering the DVD question, deterministically now.
    expect(resolved.legacy, 'the legacy function resolves to DVD').toBe(dvdMember[0]!.id);
  });

  it('is nobody in a service it has no record in', async () => {
    const account = await createAccount(db, 'samo.dvd.clan@example.invalid');
    await db.query(
      `update public.profiles set full_name = 'Samo DVD', phone_e164 = '+38267123456',
          date_of_birth = date '1990-01-01', profile_complete = true where user_id = $1`,
      [account.userId],
    );
    await db.query(`update public.access_grants set role = 'FIREFIGHTER' where user_id = $1`, [
      account.userId,
    ]);
    await db.query(
      `insert into public.members(full_name, user_id, organization_id) values ('Samo DVD', $1, $2)`,
      [account.userId, DVD],
    );

    const resolved = await asUser(db, account.userId, async (client) => {
      const { rows } = await client.query<{ dvd: string | null; szs: string | null }>(
        `select public.current_member_id_in($1) as dvd, public.current_member_id_in($2) as szs`,
        [DVD, SZS],
      );
      return rows[0]!;
    });
    expect(resolved.dvd).not.toBeNull();
    expect(resolved.szs).toBeNull();
  });
});

describe('the mirror the shim depends on still holds', () => {
  it('keeps the DVD membership role equal to the operational grant', async () => {
    /*
     * The shim reads memberships where the old function read the grant, so they
     * have to agree for DVD. `sync_dvd_membership_from_grant` is what makes them
     * agree, and on the hosted project they do for every account. This asserts
     * the invariant rather than trusting it: if a later change lets the two
     * drift, an account silently gains or loses access and this is what says so.
     */
    const { rows } = await db.query<{ label: string }>(
      `select g.user_id::text || ': grant ' || g.role || ', membership ' ||
              coalesce(m.role, 'none') || coalesce(' active=' || m.active::text, '') as label
         from public.access_grants g
         left join public.organization_memberships m
                on m.user_id = g.user_id and m.organization_id = $1 and m.active = true
        where (g.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
                 and (m.role is distinct from g.role))
           or (g.role not in ('ADMIN', 'COMMANDER', 'FIREFIGHTER') and m.role is not null)`,
      [DVD],
    );
    expect(rows.map((r) => r.label), 'grant and DVD membership disagree').toEqual([]);
  });

  it('follows a role change through to the membership and back to the shim', async () => {
    const account = await createAccount(db, 'promjena.uloge@example.invalid');
    await db.query(
      `update public.profiles set full_name = 'Promjena Uloge', phone_e164 = '+38267123456',
          date_of_birth = date '1990-01-01', profile_complete = true where user_id = $1`,
      [account.userId],
    );

    await db.query(`update public.access_grants set role = 'FIREFIGHTER' where user_id = $1`, [
      account.userId,
    ]);
    expect(await dvdRoleFor(account.userId)).toBe('FIREFIGHTER');

    await db.query(`update public.access_grants set role = 'COMMANDER' where user_id = $1`, [
      account.userId,
    ]);
    expect(await dvdRoleFor(account.userId)).toBe('COMMANDER');

    await db.query(`update public.access_grants set role = 'CITIZEN' where user_id = $1`, [
      account.userId,
    ]);
    expect(await dvdRoleFor(account.userId), 'standing down removes it').toBeNull();
  });

  it('routes the owner command through unchanged', async () => {
    // `owner_set_organization_membership` is untouched by this phase; this is
    // the end-to-end check that the real administrative path still produces an
    // account the shim recognises.
    const account = await createAccount(db, 'preko.komande@example.invalid');
    await db.query(
      `update public.profiles set full_name = 'Preko Komande', phone_e164 = '+38267123456',
          date_of_birth = date '1990-01-01', profile_complete = true where user_id = $1`,
      [account.userId],
    );

    await asUserCommitted(db, ownerUserId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'DVD', 'COMMANDER')`, [
        account.userId,
      ]),
    );
    expect(await dvdRoleFor(account.userId)).toBe('COMMANDER');
    expect(await boolFor(account.userId, `public.is_command_in('${DVD}')`)).toBe(true);
    expect(await boolFor(account.userId, `public.is_command_in('${SZS}')`)).toBe(false);

    await asUserCommitted(db, ownerUserId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'SZS', 'FIREFIGHTER')`, [
        account.userId,
      ]),
    );
    expect(await boolFor(account.userId, `public.is_staff_in('${SZS}')`)).toBe(true);
    expect(await dvdRoleFor(account.userId), 'and DVD is unaffected').toBe('COMMANDER');
  });
});
