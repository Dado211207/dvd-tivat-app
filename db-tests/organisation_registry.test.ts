/**
 * The registry stops being one society's and starts being each service's.
 *
 * P4a of docs/MULTI_ORG_PLAN.md: the seven read policies over `members`,
 * `groups`, `group_members`, `vehicles`, `member_availability` and
 * `member_availability_history`, plus the thirteen `security definer` writers
 * behind them.
 *
 * ---------------------------------------------------------------------------
 * Why the policies are only half the job
 * ---------------------------------------------------------------------------
 *
 * Every one of these tables is `enable row level security` WITHOUT
 * `force row level security`, and every registry writer is `security definer`
 * owned by `postgres`. A table's owner bypasses its own policies unless FORCE
 * is set, so the twelve `admin_*` commands and `set_own_availability` read and
 * write these tables with RLS switched off entirely.
 *
 * Rewriting the policies therefore closes the READ path and leaves every WRITE
 * path exactly as open as it was. `is_dvd_admin()` asks "may you administer the
 * society", and after P2 there are two societies; nothing in these functions
 * ever asks WHICH. So the tests below come in two halves, and the second half
 * is the one that matters:
 *
 *   reads   a commander of one service must not see the other's rows
 *   writes  an administrator of one service must not be able to rename, stand
 *           down, relink or regroup the other's rows, and must not be able to
 *           reach across by passing a service argument
 *
 * ---------------------------------------------------------------------------
 * What "nothing changes for DVD" has to mean
 * ---------------------------------------------------------------------------
 *
 * Not "the policies look right". The suite records the exact set of row ids
 * every DVD account can see BEFORE the migration, applies it, and asks again.
 * A single id appearing or disappearing fails the phase and names the table.
 * The same is done for the registry powers a DVD ADMIN holds: each command is
 * called through its EXISTING signature, before and after, and must behave
 * identically both times (D9 - no account loses access).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, asUser, connect, createAccount } from './harness';

const REGISTRY = 'supabase/migrations/202609240024_organisation_registry.sql';
const AUDIT = 'supabase/migrations/202609240025_registry_audit_organisation.sql';
const APPEND_ONLY = 'supabase/migrations/202609240026_registry_audit_append_only.sql';

/** A name distinctive enough that finding it anywhere is proof of a leak. */
const SECRET_SZS_NAME = 'Tajni Clan SZS';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

/**
 * The six tables this phase owns.
 *
 * `id` is whatever identifies a row for comparison, which is not always a
 * column called `id`: `group_members` is a pair and `member_availability` is
 * keyed by its member. Every one of them carries `organization_id` after P2,
 * and that - not the identifier - is what the isolation assertions read.
 */
const TABLES = [
  { table: 'members', id: 'id::text', read: 'staff' },
  { table: 'groups', id: 'id::text', read: 'staff' },
  { table: 'group_members', id: `group_id::text || ':' || member_id::text`, read: 'staff' },
  { table: 'vehicles', id: 'id::text', read: 'staff' },
  { table: 'member_availability', id: 'member_id::text', read: 'staff' },
  // Command only - plus a self-read, which no account in this fixture can use
  // because none of them is the member whose history rows exist.
  { table: 'member_availability_history', id: 'id::text', read: 'command' },
] as const;

/**
 * What each account is, stated once.
 *
 * `staffIn` and `commandIn` are the services the account holds that authority
 * in, and together they say exactly which rows each of the six tables should
 * show it. Writing the expectation out per account rather than asserting
 * "everyone sees their own service everywhere" is the difference between a
 * test that describes the policies and one that merely agrees with them: the
 * history table does NOT read like the other five, and a blanket assertion
 * hides that.
 */
const ACCOUNTS = [
  { label: 'owner', staffIn: [DVD, SZS], commandIn: [DVD, SZS] },
  { label: 'dvdAdmin', staffIn: [DVD], commandIn: [DVD] },
  { label: 'dvdCommander', staffIn: [DVD], commandIn: [DVD] },
  { label: 'dvdFirefighter', staffIn: [DVD], commandIn: [] },
  { label: 'szsAdmin', staffIn: [SZS], commandIn: [SZS] },
  { label: 'szsCommander', staffIn: [SZS], commandIn: [SZS] },
  // Firefighter in DVD through the mirrored grant, commander in SZS.
  { label: 'dual', staffIn: [DVD, SZS], commandIn: [SZS] },
  { label: 'suspended', staffIn: [], commandIn: [] },
  { label: 'incomplete', staffIn: [], commandIn: [] },
] as const;

/** The services an account should see rows from, in one table. */
function expectedServices(label: string, read: 'staff' | 'command'): string[] {
  const account = ACCOUNTS.find((candidate) => candidate.label === label)!;
  return [...(read === 'command' ? account.commandIn : account.staffIn)].sort();
}

interface Row {
  id: string;
  organization: string;
}

interface ServiceRows {
  memberId: string;
  groupId: string;
  vehicleId: string;
}

let db: Client;

let ownerUser = '';
let dvdAdmin = '';
let dvdCommander = '';
let dvdFirefighter = '';
let szsAdmin = '';
let szsCommander = '';
let dualUser = '';
let suspendedUser = '';
let incompleteUser = '';

let dvd: ServiceRows;
let szs: ServiceRows;

const visibleBefore = new Map<string, Row[]>();
const powersBefore = new Map<string, string>();

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

/** A bare refusal code, as this schema raises them. */
const isRefusal = (value: string) => /^[A-Z][A-Z_]{4,}$/.test(value);

/**
 * Runs one statement as `userId` INSIDE the caller's open transaction.
 *
 * Two things make this a savepoint rather than a transaction. A nested `begin`
 * is a no-op whose `rollback` discards the CALLER's work - so a helper that
 * opened its own transaction would silently undo the rows an earlier step in
 * the same snapshot had just created. And a refusal aborts the transaction, so
 * without a savepoint to roll back to, every probe after the first one would
 * report the same "current transaction is aborted" rather than its own answer.
 *
 * Returns the command's scalar result, or the refusal code. A `returns void`
 * command comes back as an empty string, so empty is reported as 'OK' - which
 * means a query whose own result may legitimately be empty needs a sentinel
 * rather than '', or the two become indistinguishable.
 */
async function act(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint act');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint act');
    // A `returns void` command comes back as an empty string here, not null,
    // so "nothing to report" has three spellings and all three mean OK.
    const value = rows.length === 1 ? Object.values(rows[0] as object)[0] : null;
    return value === null || value === undefined || value === '' ? 'OK' : String(value);
  } catch (error) {
    await db.query('rollback to savepoint act');
    await db.query('reset role');
    // The refusals are bare codes; keep the code and drop PostgreSQL's
    // decoration, so a comparison is about behaviour and not wording.
    return (error as Error).message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** As `act`, but in a transaction of its own that is always rolled back. */
async function probe(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('begin');
  try {
    return await act(userId, statement, params);
  } finally {
    await db.query('rollback');
  }
}

/** Everything this account can read from one table. */
async function visible(userId: string, table: string, idExpression: string): Promise<Row[]> {
  return asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ id: string; organization: string }>(
      `select ${idExpression} as id, organization_id::text as organization
         from public.${table} order by 1`,
    );
    return rows;
  });
}

async function snapshotVisible(into: Map<string, Row[]>): Promise<void> {
  const accounts: [string, string][] = [
    ['owner', ownerUser],
    ['dvdAdmin', dvdAdmin],
    ['dvdCommander', dvdCommander],
    ['dvdFirefighter', dvdFirefighter],
    ['szsAdmin', szsAdmin],
    ['szsCommander', szsCommander],
    ['dual', dualUser],
    ['suspended', suspendedUser],
    ['incomplete', incompleteUser],
  ];
  for (const [label, userId] of accounts) {
    for (const { table, id } of TABLES) {
      into.set(`${label}/${table}`, await visible(userId, table, id));
    }
  }
}

/** The distinct services whose rows this account can see in one table. */
function servicesSeen(from: Map<string, Row[]>, label: string, table: string): string[] {
  return [...new Set((from.get(`${label}/${table}`) ?? []).map((row) => row.organization))].sort();
}

/** The ids this account can see in one table, restricted to one service. */
function idsSeen(from: Map<string, Row[]>, label: string, table: string, service: string): string[] {
  return (from.get(`${label}/${table}`) ?? [])
    .filter((row) => row.organization === service)
    .map((row) => row.id)
    .sort();
}

/** Makes an account usable: active grant, finished profile. */
async function usable(userId: string, name: string, role = 'CITIZEN'): Promise<void> {
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456',
            date_of_birth = date '1990-01-01', profile_complete = true
      where user_id = $1`,
    [userId, name],
  );
  await db.query(`update public.access_grants set role = $2 where user_id = $1`, [userId, role]);
}

/**
 * An account that serves in SZS and nowhere else.
 *
 * The grant role has to stay CITIZEN: `sync_dvd_membership_from_grant` mirrors
 * ADMIN, COMMANDER and FIREFIGHTER into an ACTIVE DVD membership, so giving
 * this account the role it holds in SZS would quietly make it DVD staff too and
 * the isolation fixture would be testing nothing. P5 is where the grant stops
 * carrying a role at all; until then, CITIZEN is how an SZS-only account is
 * spelled.
 */
async function szsOnly(email: string, name: string, role: string): Promise<string> {
  const account = await createAccount(db, email);
  await usable(account.userId, name);
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active)
     values ($1, $2, $3, true)`,
    [SZS, account.userId, role],
  );
  return account.userId;
}

/** One member, one group, one vehicle and the rows hanging off them. */
async function buildService(organization: string, suffix: string): Promise<ServiceRows> {
  const { rows: member } = await db.query<{ id: string }>(
    `insert into public.members(full_name, specialties, organization_id)
     values ($1, '{"Vozac"}', $2) returning id`,
    [`Clan ${suffix}`, organization],
  );
  const { rows: group } = await db.query<{ id: string }>(
    `insert into public.groups(name, organization_id) values ($1, $2) returning id`,
    [`Smjena ${suffix}`, organization],
  );
  const { rows: vehicle } = await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind, organization_id)
     values ($1, $2, 'NAVALNO', $3) returning id`,
    [`V-${suffix}`, `Vozilo ${suffix}`, organization],
  );
  const memberId = member[0]!.id;
  await db.query(`insert into public.group_members(group_id, member_id) values ($1, $2)`, [
    group[0]!.id,
    memberId,
  ]);
  // organization_id on these two is derived from `members` by P2's trigger.
  await db.query(
    `insert into public.member_availability(member_id, available, changed_by) values ($1, true, $2)`,
    [memberId, ownerUser],
  );
  await db.query(
    `insert into public.member_availability_history(
       member_id, previous_available, next_available, changed_by) values ($1, null, true, $2)`,
    [memberId, ownerUser],
  );
  return { memberId, groupId: group[0]!.id, vehicleId: vehicle[0]!.id };
}

/**
 * Exercises every registry power a DVD ADMIN holds, through the signatures the
 * client uses today, and records the outcome of each.
 *
 * Run before and after the migration. Anything that changes is an account
 * losing - or gaining - access, which D9 forbids. The whole thing runs in one
 * transaction that is always rolled back: the rows it creates must not survive
 * into the visibility comparison.
 */
async function snapshotPowers(into: Map<string, string>): Promise<void> {
  const unique = Math.random().toString(36).slice(2, 8);
  const record = async (command: string, statement: string, params: unknown[] = []) => {
    const result = await act(dvdAdmin, statement, params);
    into.set(command, isRefusal(result) ? result : 'OK');
    return result;
  };

  await db.query('begin');
  try {
    const member = await record(
      'admin_create_member',
      `select public.admin_create_member($1, '{"Prva pomoc"}')`,
      [`Novi Clan ${unique}`],
    );
    await record('admin_update_member', `select public.admin_update_member($1, $2, '{"Vozac"}')`, [
      member,
      `Preimenovan ${unique}`,
    ]);
    await record(
      'admin_set_member_active',
      `select public.admin_set_member_active($1, false, 'Razlog')`,
      [member],
    );
    await record('admin_link_member_account', `select public.admin_link_member_account($1, $2)`, [
      member,
      incompleteUser,
    ]);
    await record(
      'admin_unlink_member_account',
      `select public.admin_unlink_member_account($1, 'Razlog')`,
      [member],
    );

    const group = await record('admin_create_group', `select public.admin_create_group($1)`, [
      `Nova Smjena ${unique}`,
    ]);
    await record('admin_rename_group', `select public.admin_rename_group($1, $2)`, [
      group,
      `Preimenovana ${unique}`,
    ]);
    await record('admin_set_group_members', `select public.admin_set_group_members($1, $2)`, [
      group,
      [dvd.memberId],
    ]);
    await record(
      'admin_set_group_active',
      `select public.admin_set_group_active($1, false, 'Razlog')`,
      [group],
    );

    const vehicle = await record(
      'admin_create_vehicle',
      `select public.admin_create_vehicle($1, $2, 'NAVALNO')`,
      [`NV-${unique}`, `Novo Vozilo ${unique}`],
    );
    await record('admin_update_vehicle', `select public.admin_update_vehicle($1, $2, $3, 'CISTERNA')`, [
      vehicle,
      `NV2-${unique}`,
      `Preimenovano ${unique}`,
    ]);
    await record(
      'admin_set_vehicle_active',
      `select public.admin_set_vehicle_active($1, false, 'Razlog')`,
      [vehicle],
    );

    // The firefighter's own availability, through the two-argument signature
    // the client uses today.
    const availability = await act(
      dvdFirefighter,
      `select public.set_own_availability(true, 'Dostupan')`,
    );
    into.set('set_own_availability', isRefusal(availability) ? availability : 'OK');
  } finally {
    await db.query('rollback');
  }
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
  // Strictly before, not "everything except": filtering by name only works
  // while this file is last in the list, and it will not be for long.
  const index = MIGRATIONS.indexOf(REGISTRY);
  expect(index, 'the migration must be in the harness list').toBeGreaterThan(-1);
  for (const file of MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  // --- the accounts -------------------------------------------------------

  const owner = await createAccount(db, 'vlasnik.registar@example.invalid');
  ownerUser = owner.userId;
  await usable(ownerUser, 'Vlasnik Instalacije', 'OWNER');
  // Deliberately no membership anywhere: the live installation owner holds
  // none, and P3's is_installation_owner() is the only thing carrying them.

  const admin = await createAccount(db, 'admin.dvd.registar@example.invalid');
  dvdAdmin = admin.userId;
  await usable(dvdAdmin, 'Administrator DVD', 'ADMIN');

  const commander = await createAccount(db, 'komandir.dvd.registar@example.invalid');
  dvdCommander = commander.userId;
  await usable(dvdCommander, 'Komandir DVD', 'COMMANDER');

  const firefighter = await createAccount(db, 'vatrogasac.dvd.registar@example.invalid');
  dvdFirefighter = firefighter.userId;
  await usable(dvdFirefighter, 'Vatrogasac DVD', 'FIREFIGHTER');

  szsAdmin = await szsOnly('admin.szs.registar@example.invalid', 'Administrator SZS', 'ADMIN');
  szsCommander = await szsOnly('komandir.szs.registar@example.invalid', 'Komandir SZS', 'COMMANDER');

  // Serves in both. P2 made `members` unique per service precisely so this
  // person may hold a record in each.
  const dual = await createAccount(db, 'oba.servisa.registar@example.invalid');
  dualUser = dual.userId;
  await usable(dualUser, 'Oba Servisa', 'FIREFIGHTER');
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active)
     values ($1, $2, 'COMMANDER', true)`,
    [SZS, dualUser],
  );

  // Suspended, but the DVD membership is still standing: the mirror fires on
  // `update of role` and never on `active`, so only the account gate stops it.
  const suspended = await createAccount(db, 'suspendovan.registar@example.invalid');
  suspendedUser = suspended.userId;
  await usable(suspendedUser, 'Suspendovan Clan', 'FIREFIGHTER');
  await db.query(`update public.access_grants set active = false where user_id = $1`, [
    suspendedUser,
  ]);

  // Registered but never finished the profile - five such accounts exist on the
  // live installation today, holding operational grants and no access.
  const incomplete = await createAccount(db, 'nepotpun.registar@example.invalid');
  incompleteUser = incomplete.userId;
  await usable(incompleteUser, 'Nepotpun Profil', 'FIREFIGHTER');
  await db.query(`update public.profiles set profile_complete = false where user_id = $1`, [
    incompleteUser,
  ]);

  // --- the rows -----------------------------------------------------------

  dvd = await buildService(DVD, 'DVD');
  szs = await buildService(SZS, 'SZS');

  // The dual-service person's own member record in each service, so
  // current_member_id_in() has something to resolve on both sides.
  await db.query(
    `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
    ['Oba Servisa', dualUser, DVD],
  );
  await db.query(
    `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
    ['Oba Servisa', dualUser, SZS],
  );
  // And the DVD firefighter's, so set_own_availability has a member to write.
  await db.query(
    `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
    ['Vatrogasac DVD', dvdFirefighter, DVD],
  );

  // Real, COMMITTED DVD registry history, written through the real commands.
  // Everything else in this file rolls back, so without these the audit table
  // would be empty and 202609240025's backfill would have nothing to attribute
  // - a test that passes because there was no work to do.
  await db.query('begin');
  await act(dvdAdmin, `select public.admin_create_member($1, '{}')`, ['Evidencija Clan']);
  await act(dvdAdmin, `select public.admin_create_group($1)`, ['Evidencija Smjena']);
  await act(dvdAdmin, `select public.admin_create_vehicle($1, $2, 'NAVALNO')`, [
    'E-1',
    'Evidencija Vozilo',
  ]);
  await db.query('commit');

  await snapshotVisible(visibleBefore);
  await snapshotPowers(powersBefore);
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before P4a: the registry does not know which service it belongs to', () => {
  it.each(TABLES)('leaks SZS $table to a DVD commander', ({ table }) => {
    expect(servicesSeen(visibleBefore, 'dvdCommander', table)).toEqual([DVD, SZS].sort());
  });

  it('shows an SZS administrator nothing at all', () => {
    for (const { table } of TABLES) {
      expect(visibleBefore.get(`szsAdmin/${table}`), table).toEqual([]);
    }
  });

  it('lets a DVD administrator rename an SZS group', async () => {
    expect(
      await probe(dvdAdmin, `select public.admin_rename_group($1, 'Preuzeto')`, [szs.groupId]),
    ).toBe('OK');
  });

  it('lets a DVD administrator stand down an SZS member and vehicle', async () => {
    expect(
      await probe(dvdAdmin, `select public.admin_set_member_active($1, false, 'Razlog')`, [
        szs.memberId,
      ]),
    ).toBe('OK');
    expect(
      await probe(dvdAdmin, `select public.admin_set_vehicle_active($1, false, 'Razlog')`, [
        szs.vehicleId,
      ]),
    ).toBe('OK');
  });

  it('refuses an SZS administrator every registry command', async () => {
    // Fails closed rather than open, but it is still wrong: an SZS ADMIN
    // cannot administer SZS, which is what D9 says they must be able to do.
    expect(await probe(szsAdmin, `select public.admin_create_member('Novi', '{}')`)).toBe(
      'ADMIN_REQUIRED',
    );
    expect(await probe(szsAdmin, `select public.admin_rename_group($1, 'Nova')`, [szs.groupId])).toBe(
      'ADMIN_REQUIRED',
    );
  });

  it('refuses an SZS member their own availability', async () => {
    expect(await probe(szsCommander, `select public.set_own_availability(true, null)`)).toBe(
      'STAFF_REQUIRED',
    );
  });
});

describe('after P4a: each service sees and administers only its own registry', () => {
  const visibleAfter = new Map<string, Row[]>();
  const powersAfter = new Map<string, string>();

  beforeAll(async () => {
    await db.query(sql(REGISTRY));
    await snapshotVisible(visibleAfter);
    await snapshotPowers(powersAfter);
  }, 120_000);

  // --- reads --------------------------------------------------------------

  it.each(TABLES)('leaves every DVD row id in $table unchanged', ({ table }) => {
    for (const label of ['owner', 'dvdAdmin', 'dvdCommander', 'dvdFirefighter', 'dual']) {
      expect(
        idsSeen(visibleAfter, label, table, DVD),
        `${label} must see exactly the DVD ${table} it saw before`,
      ).toEqual(idsSeen(visibleBefore, label, table, DVD));
    }
  });

  it.each(TABLES)('shows every account exactly its own services in $table', ({ table, read }) => {
    for (const { label } of ACCOUNTS) {
      expect(servicesSeen(visibleAfter, label, table), `${label} in ${table}`).toEqual(
        expectedServices(label, read),
      );
    }
  });

  it.each(TABLES)('never shows one service a row belonging to the other in $table', ({ table }) => {
    for (const label of ['dvdAdmin', 'dvdCommander', 'dvdFirefighter']) {
      expect(servicesSeen(visibleAfter, label, table), label).not.toContain(SZS);
    }
    for (const label of ['szsAdmin', 'szsCommander']) {
      expect(servicesSeen(visibleAfter, label, table), label).not.toContain(DVD);
    }
  });

  it('gives the installation owner both services without a membership anywhere', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.organization_memberships where user_id = $1`,
      [ownerUser],
    );
    expect(rows[0]!.n, 'the owner holds no membership').toBe('0');
    for (const { table } of TABLES) {
      expect(servicesSeen(visibleAfter, 'owner', table), table).toEqual([DVD, SZS].sort());
    }
  });

  it('gives a dual-service account each registry at the authority it holds there', () => {
    // Firefighter in DVD, commander in SZS - so both rosters, but only SZS's
    // availability history. One account, two different answers.
    for (const { table, read } of TABLES) {
      expect(servicesSeen(visibleAfter, 'dual', table), table).toEqual(
        read === 'command' ? [SZS] : [DVD, SZS].sort(),
      );
    }
  });

  it('shows a suspended account nothing, membership or not', () => {
    for (const { table } of TABLES) {
      expect(visibleAfter.get(`suspended/${table}`), table).toEqual([]);
    }
  });

  it('shows an account with an unfinished profile nothing', () => {
    for (const { table } of TABLES) {
      expect(visibleAfter.get(`incomplete/${table}`), table).toEqual([]);
    }
  });

  it('resolves the history self-read per service, not through the DVD shim', async () => {
    // The dual-service person holds a member record in each service. The old
    // `current_member_id()` could only ever answer one of them.
    const resolved = await asUser(db, dualUser, async (client) => {
      const { rows } = await client.query<{ dvd: string | null; szs: string | null }>(
        `select public.current_member_id_in($1) as dvd, public.current_member_id_in($2) as szs`,
        [DVD, SZS],
      );
      return rows[0]!;
    });
    expect(resolved.dvd).not.toBeNull();
    expect(resolved.szs).not.toBeNull();
    expect(resolved.dvd).not.toBe(resolved.szs);
  });

  // --- writes -------------------------------------------------------------

  it('keeps every registry power a DVD administrator holds today', () => {
    expect(powersAfter).toEqual(powersBefore);
    // And none of them was a refusal to begin with, in either snapshot.
    expect([...powersBefore.values()].sort()).toEqual([...powersBefore.keys()].map(() => 'OK'));
    expect(powersBefore.size, 'all thirteen writers are exercised').toBe(13);
  });

  it.each([
    ['admin_update_member', `select public.admin_update_member($1, 'Preuzeto', '{}')`],
    ['admin_set_member_active', `select public.admin_set_member_active($1, false, 'Razlog')`],
    ['admin_unlink_member_account', `select public.admin_unlink_member_account($1, 'Razlog')`],
  ])('refuses a DVD administrator the SZS %s', async (_name, statement) => {
    expect(await probe(dvdAdmin, statement, [szs.memberId])).toBe('ORGANIZATION_MISMATCH');
  });

  it.each([
    ['admin_rename_group', `select public.admin_rename_group($1, 'Preuzeto')`],
    ['admin_set_group_active', `select public.admin_set_group_active($1, false, 'Razlog')`],
  ])('refuses a DVD administrator the SZS %s', async (_name, statement) => {
    expect(await probe(dvdAdmin, statement, [szs.groupId])).toBe('ORGANIZATION_MISMATCH');
  });

  it.each([
    ['admin_update_vehicle', `select public.admin_update_vehicle($1, 'X-1', 'Preuzeto', 'NAVALNO')`],
    ['admin_set_vehicle_active', `select public.admin_set_vehicle_active($1, false, 'Razlog')`],
  ])('refuses a DVD administrator the SZS %s', async (_name, statement) => {
    expect(await probe(dvdAdmin, statement, [szs.vehicleId])).toBe('ORGANIZATION_MISMATCH');
  });

  it('refuses a DVD administrator the SZS admin_link_member_account', async () => {
    expect(
      await probe(dvdAdmin, `select public.admin_link_member_account($1, $2)`, [
        szs.memberId,
        incompleteUser,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('refuses a DVD administrator the SZS admin_set_group_members', async () => {
    expect(
      await probe(dvdAdmin, `select public.admin_set_group_members($1, $2)`, [
        szs.groupId,
        [szs.memberId],
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('refuses an SZS administrator every DVD row, in both directions', async () => {
    expect(await probe(szsAdmin, `select public.admin_rename_group($1, 'Preuzeto')`, [dvd.groupId])).toBe(
      'ORGANIZATION_MISMATCH',
    );
    expect(
      await probe(szsAdmin, `select public.admin_set_member_active($1, false, 'Razlog')`, [
        dvd.memberId,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
    expect(
      await probe(szsAdmin, `select public.admin_update_vehicle($1, 'X-9', 'Preuzeto', 'NAVALNO')`, [
        dvd.vehicleId,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('refuses a forged service argument on a create', async () => {
    // A DVD administrator naming SZS as the target service, and the reverse.
    expect(
      await probe(dvdAdmin, `select public.admin_create_member_in($1, 'Podmetnut', '{}')`, [SZS]),
    ).toBe('ADMIN_REQUIRED');
    expect(await probe(dvdAdmin, `select public.admin_create_group_in($1, 'Podmetnuta')`, [SZS])).toBe(
      'ADMIN_REQUIRED',
    );
    expect(
      await probe(dvdAdmin, `select public.admin_create_vehicle_in($1, 'P-1', 'Podmetnuto', 'NAVALNO')`, [
        SZS,
      ]),
    ).toBe('ADMIN_REQUIRED');
    expect(
      await probe(szsAdmin, `select public.admin_create_member_in($1, 'Podmetnut', '{}')`, [DVD]),
    ).toBe('ADMIN_REQUIRED');
  });

  it('gives an edit no service argument to forge in the first place', async () => {
    // The strongest form of "reject a forged service on an edit" is for there
    // to be nothing to forge: an edit reads the service off its stored row and
    // takes no service parameter at all. Asserted rather than described,
    // because a later phase adding one would quietly reopen the question.
    const { rows } = await db.query<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_update_member', 'admin_set_member_active',
                            'admin_link_member_account', 'admin_unlink_member_account',
                            'admin_rename_group', 'admin_set_group_active',
                            'admin_set_group_members', 'admin_update_vehicle',
                            'admin_set_vehicle_active')
        order by p.proname`,
    );
    expect(rows, 'all nine edits are present exactly once each').toHaveLength(9);
    for (const row of rows) {
      expect(row.args, row.proname).not.toMatch(/organization/);
    }
  });

  it('keeps every create signature the client uses today, and adds a service-aware one', async () => {
    const { rows } = await db.query<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('admin_create_member', 'admin_create_member_in',
                            'admin_create_group', 'admin_create_group_in',
                            'admin_create_vehicle', 'admin_create_vehicle_in',
                            'set_own_availability', 'set_own_availability_in')
        order by p.proname`,
    );
    const signatures = Object.fromEntries(rows.map((row) => [row.proname, row.args]));
    // Unchanged - this is what `src/auth/roster.ts` and the Evidencija screen
    // call, and a single overload here would make every one of those ambiguous.
    expect(signatures.admin_create_member).toBe('requested_full_name text, requested_specialties text[]');
    expect(signatures.admin_create_group).toBe('requested_name text');
    expect(signatures.admin_create_vehicle).toBe('requested_callsign text, requested_name text, requested_kind text');
    expect(signatures.set_own_availability).toBe('requested_available boolean, requested_note text');
    // And the service-aware path beside it.
    expect(signatures.admin_create_member_in).toBe(
      'target_organization uuid, requested_full_name text, requested_specialties text[]',
    );
    expect(signatures.set_own_availability_in).toBe(
      'target_organization uuid, requested_available boolean, requested_note text',
    );
  });

  it('refuses a group member from the other service', async () => {
    expect(
      await probe(dvdAdmin, `select public.admin_set_group_members($1, $2)`, [
        dvd.groupId,
        [dvd.memberId, szs.memberId],
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
    // The group is untouched: a refused call changes nothing.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.group_members where group_id = $1`,
      [dvd.groupId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('lets an SZS administrator administer SZS, and only SZS', async () => {
    await db.query('begin');
    try {
      const created = await act(szsAdmin, `select public.admin_create_member_in($1, 'Novi SZS', '{}')`, [
        SZS,
      ]);
      expect(isRefusal(created), `creating an SZS member: ${created}`).toBe(false);
      const { rows } = await db.query<{ organization_id: string }>(
        `select organization_id from public.members where id = $1`,
        [created],
      );
      expect(rows[0]!.organization_id, 'the new member belongs to SZS').toBe(SZS);
      expect(
        await act(szsAdmin, `select public.admin_update_member($1, 'Preimenovan', '{}')`, [created]),
        'and its own administrator may edit it',
      ).toBe('OK');
    } finally {
      await db.query('rollback');
    }
  });

  it("lets each service reuse the other service's names", async () => {
    // P2 made these constraints per-service. The commands were still checking
    // installation-wide, so an SZS group could not be called what a DVD group
    // was already called.
    await db.query('begin');
    try {
      expect(
        await act(szsAdmin, `select public.admin_create_group_in($1, 'Smjena DVD')`, [SZS]),
        'the name is only taken within DVD',
      ).not.toBe('GROUP_NAME_TAKEN');
      expect(
        await act(szsAdmin, `select public.admin_create_vehicle_in($1, 'V-DVD', 'Vozilo', 'NAVALNO')`, [
          SZS,
        ]),
        'and so is the callsign',
      ).not.toBe('CALLSIGN_TAKEN');
      // Within one service it is still taken.
      expect(await act(szsAdmin, `select public.admin_create_group_in($1, 'Smjena SZS')`, [SZS])).toBe(
        'GROUP_NAME_TAKEN',
      );
    } finally {
      await db.query('rollback');
    }
  });

  it('lets one person hold a member record in each service', async () => {
    await db.query('begin');
    try {
      const created = await act(szsAdmin, `select public.admin_create_member_in($1, 'Vatrogasac', '{}')`, [
        SZS,
      ]);
      // This account already holds a DVD member record. Linking it to an SZS
      // record is exactly what `members_organization_user_key` permits.
      expect(
        await act(szsAdmin, `select public.admin_link_member_account($1, $2)`, [
          created,
          dvdFirefighter,
        ]),
      ).toBe('OK');
    } finally {
      await db.query('rollback');
    }
  });

  it('gives an SZS member their own availability, and writes it to SZS', async () => {
    await db.query('begin');
    try {
      await db.query(
        `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
        ['Komandir SZS', szsCommander, SZS],
      );
      expect(
        await act(szsCommander, `select public.set_own_availability_in($1, true, 'Dostupan')`, [SZS]),
      ).toBe('OK');
      const { rows } = await db.query<{ organization_id: string }>(
        `select a.organization_id from public.member_availability a
           join public.members m on m.id = a.member_id
          where m.user_id = $1`,
        [szsCommander],
      );
      expect(rows[0]!.organization_id).toBe(SZS);
      // Without naming a service the call still means DVD, and they are not
      // DVD staff - the old path is unchanged and still fails closed.
      expect(await act(szsCommander, `select public.set_own_availability(true, null)`)).toBe(
        'STAFF_REQUIRED',
      );
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses a member setting availability in a service they do not serve', async () => {
    expect(await probe(dvdFirefighter, `select public.set_own_availability_in($1, true, null)`, [SZS])).toBe(
      'STAFF_REQUIRED',
    );
  });

  /*
   * The six tables are isolated by here. Their HISTORY is not, and this is the
   * one place in the phase where that is still true - so it is asserted as a
   * leak rather than described as one, and 202609240025 is what turns these
   * three expectations over.
   */
  it('still leaks the SZS audit trail, names and all, to a DVD administrator', async () => {
    await db.query('begin');
    try {
      const created = await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        SECRET_SZS_NAME,
      ]);
      expect(isRefusal(created), `the SZS member was created: ${created}`).toBe(false);

      const seen = await act(
        dvdAdmin,
        `select coalesce(string_agg(detail->>'full_name', ','), 'NONE') as names
           from public.registry_audit where entity_id = $1`,
        [created],
      );
      expect(seen, "a DVD administrator can read the SZS member's name").toBe(SECRET_SZS_NAME);

      const own = await act(
        szsAdmin,
        `select count(*)::text from public.registry_audit where entity_id = $1`,
        [created],
      );
      expect(own, 'and the SZS administrator who wrote it can read nothing').toBe('0');
    } finally {
      await db.query('rollback');
    }
  });

  it('has no organization_id on registry_audit at all yet', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.columns
        where table_schema = 'public' and table_name = 'registry_audit'
          and column_name = 'organization_id'`,
    );
    expect(rows[0]!.n, 'the column the policy would need does not exist').toBe('0');
  });

  it('leaves no is_dvd_* guard in the tables this phase owns', async () => {
    const { rows } = await db.query<{ policyname: string; qual: string }>(
      `select policyname, coalesce(qual, '') as qual from pg_policies
        where schemaname = 'public'
          and tablename in ('members','groups','group_members','vehicles',
                            'member_availability','member_availability_history')`,
    );
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.qual, row.policyname).not.toMatch(/is_dvd_(staff|command|admin)/);
    }

    const { rows: functions } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like 'admin\\_%' or p.proname = 'set_own_availability')
          and p.prosrc ~ 'is_dvd_(staff|command|admin)'
        order by 1`,
    );
    expect(functions.map((row) => row.proname)).toEqual([]);
  });
});

describe('after 202609240025: the audit trail belongs to a service too', () => {
  /** Row counts before the migration, so nothing can be lost by it. */
  let auditRowsBefore = 0;
  let dvdAuditRowsBefore: string[] = [];

  beforeAll(async () => {
    const { rows: total } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit`,
    );
    auditRowsBefore = Number(total[0]!.n);
    const { rows: visible } = await db.query<{ id: string }>(
      `select id::text from public.registry_audit order by 1`,
    );
    dvdAuditRowsBefore = visible.map((row) => row.id);

    await db.query(sql(AUDIT));
  }, 120_000);

  it('keeps every existing row, and attributes them all to DVD', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit`,
    );
    expect(Number(rows[0]!.n), 'no audit row was lost').toBe(auditRowsBefore);
    expect(auditRowsBefore, 'there were rows to attribute in the first place').toBeGreaterThan(0);

    const { rows: byService } = await db.query<{ organization_id: string; n: string }>(
      `select organization_id::text, count(*)::text as n
         from public.registry_audit group by 1 order by 1`,
    );
    expect(byService, 'every pre-existing row is DVD, which is what it was').toEqual([
      { organization_id: DVD, n: String(auditRowsBefore) },
    ]);

    const { rows: stillThere } = await db.query<{ id: string }>(
      `select id::text from public.registry_audit order by 1`,
    );
    expect(stillThere.map((row) => row.id), 'the same rows, by id').toEqual(dvdAuditRowsBefore);
  });

  it('leaves the existing columns exactly as they were', async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'registry_audit'
          and column_name <> 'organization_id'
        order by ordinal_position`,
    );
    expect(rows).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'entity_kind', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'entity_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'event_type', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'detail', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'reason', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'changed_by', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'changed_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
  });

  it('shows a DVD administrator only DVD audit, and no SZS name', async () => {
    await db.query('begin');
    try {
      const created = await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        SECRET_SZS_NAME,
      ]);
      expect(isRefusal(created), `the SZS member was created: ${created}`).toBe(false);

      const services = await act(
        dvdAdmin,
        `select coalesce(string_agg(distinct organization_id::text, ','), 'NONE') from public.registry_audit`,
      );
      expect(services, 'a DVD administrator sees DVD rows and nothing else').toBe(DVD);

      const names = await act(
        dvdAdmin,
        `select coalesce(string_agg(detail->>'full_name', ','), 'NONE') from public.registry_audit
          where detail->>'full_name' = $1`,
        [SECRET_SZS_NAME],
      );
      expect(names, 'and the SZS name is nowhere in what they can read').toBe('NONE');
    } finally {
      await db.query('rollback');
    }
  });

  it('shows an SZS administrator their own audit trail, and only theirs', async () => {
    await db.query('begin');
    try {
      const created = await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        SECRET_SZS_NAME,
      ]);
      const own = await act(
        szsAdmin,
        `select coalesce(string_agg(detail->>'full_name', ','), 'NONE') from public.registry_audit
          where entity_id = $1`,
        [created],
      );
      expect(own, 'the administrator who wrote it can now read it back').toBe(SECRET_SZS_NAME);

      const services = await act(
        szsAdmin,
        `select coalesce(string_agg(distinct organization_id::text, ','), 'NONE') from public.registry_audit`,
      );
      expect(services, 'and sees no DVD row').toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  it('shows the installation owner both services', async () => {
    await db.query('begin');
    try {
      await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        SECRET_SZS_NAME,
      ]);
      const services = await act(
        ownerUser,
        `select coalesce(string_agg(distinct organization_id::text, ','), 'NONE') from public.registry_audit`,
      );
      expect(services.split(',').sort()).toEqual([DVD, SZS].sort());
    } finally {
      await db.query('rollback');
    }
  });

  it('keeps the existing DVD audit view: an administrator reads it, nobody else does', async () => {
    // Exactly the property `registry.test.ts` has asserted since the audit table
    // existed. A service filter must not have narrowed it to nothing.
    const asAdmin = await probe(dvdAdmin, `select count(*)::text from public.registry_audit`);
    expect(Number(asAdmin), 'a DVD administrator still reads the DVD trail').toBeGreaterThan(0);

    for (const [label, user] of [
      ['commander', dvdCommander],
      ['firefighter', dvdFirefighter],
      ['suspended', suspendedUser],
      ['incomplete', incompleteUser],
    ] as const) {
      expect(await probe(user, `select count(*)::text from public.registry_audit`), label).toBe('0');
    }
  });

  it('derives the service from the entity rather than from the writer', async () => {
    // The writers are security definer, so a value they supplied would be a
    // claim. A row naming a service its entity does not belong to is refused,
    // and one naming none is filled in from the entity.
    await db.query('begin');
    try {
      const mismatched = await db
        .query(
          `insert into public.registry_audit(
             entity_kind, entity_id, event_type, detail, changed_by, organization_id)
           values ('MEMBER', $1, 'FORGED', '{}'::jsonb, $2, $3)`,
          [dvd.memberId, ownerUser, SZS],
        )
        .then(() => 'OK')
        .catch((error: Error) => error.message);
      expect(String(mismatched)).toContain('ORGANIZATION_MISMATCH');
    } finally {
      await db.query('rollback');
    }

    await db.query('begin');
    try {
      const { rows } = await db.query<{ organization_id: string }>(
        `insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
         values ('VEHICLE', $1, 'DERIVED', '{}'::jsonb, $2) returning organization_id::text`,
        [szs.vehicleId, ownerUser],
      );
      expect(rows[0]!.organization_id, "filled in from the vehicle's own service").toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses a row about an entity it cannot attribute', async () => {
    await db.query('begin');
    try {
      const orphan = await db
        .query(
          `insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
           values ('MEMBER', gen_random_uuid(), 'ORPHAN', '{}'::jsonb, $1)`,
          [ownerUser],
        )
        .then(() => 'OK')
        .catch((error: Error) => error.message);
      expect(String(orphan), 'refused rather than guessed at').toContain('ORGANIZATION_UNKNOWN');
    } finally {
      await db.query('rollback');
    }
  });

  it('settles the service when the row is written, and never after', async () => {
    await db.query('begin');
    try {
      const changed = await db
        .query(`update public.registry_audit set organization_id = $1`, [SZS])
        .then(() => 'OK')
        .catch((error: Error) => error.message);
      expect(String(changed)).toContain('ORGANIZATION_IMMUTABLE');
    } finally {
      await db.query('rollback');
    }
  });

  /*
   * ...but only that column is watched, and the service is not the only thing
   * that decides which service a row belongs to. `entity_id` does too, and
   * nothing guards it - so a DVD row can be repointed into SZS while keeping
   * its DVD label. Asserted as the hole it still is; 202609240026 turns it over.
   */
  it('still lets an audit row be repointed at another service\'s entity', async () => {
    await db.query('begin');
    try {
      const szsMember = await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        SECRET_SZS_NAME,
      ]);
      const { rows: before } = await db.query<{ id: string }>(
        `select id from public.registry_audit where organization_id = $1 limit 1`,
        [DVD],
      );
      expect(before, 'there is a DVD audit row to repoint').toHaveLength(1);

      await db.query(`update public.registry_audit set entity_id = $1 where id = $2`, [
        szsMember,
        before[0]!.id,
      ]);

      const { rows: after } = await db.query<{ label: string; entity: string; name: string }>(
        `select audit.organization_id::text as label,
                member.organization_id::text as entity,
                member.full_name as name
           from public.registry_audit audit
           join public.members member on member.id = audit.entity_id
          where audit.id = $1`,
        [before[0]!.id],
      );
      expect(after[0]!.label, 'the row still reads as DVD').toBe(DVD);
      expect(after[0]!.entity, 'while pointing into SZS').toBe(SZS);
      expect(after[0]!.name).toBe(SECRET_SZS_NAME);
    } finally {
      await db.query('rollback');
    }
  });

  it('leaves no is_dvd_* guard on the audit table either', async () => {
    const { rows } = await db.query<{ policyname: string; qual: string }>(
      `select policyname, coalesce(qual, '') as qual from pg_policies
        where schemaname = 'public' and tablename = 'registry_audit'`,
    );
    expect(rows.map((row) => row.policyname)).toEqual(['registry_audit_admin_read']);
    expect(rows[0]!.qual).not.toMatch(/is_dvd_admin/);
    expect(rows[0]!.qual).toMatch(/is_admin_in/);
  });
});

describe('after 202609240026: an audit entry is written once and never touched', () => {
  let auditRows = 0;
  let dvdAuditRow = '';

  beforeAll(async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.registry_audit where organization_id = $1 order by changed_at limit 1`,
      [DVD],
    );
    dvdAuditRow = rows[0]!.id;
    const { rows: total } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit`,
    );
    auditRows = Number(total[0]!.n);

    await db.query(sql(APPEND_ONLY));
  }, 120_000);

  /** Runs one statement as the superuser and reports OK or the refusal. */
  async function attempt(statement: string, params: unknown[] = []): Promise<string> {
    await db.query('begin');
    try {
      await db.query(statement, params);
      return 'OK';
    } catch (error) {
      return (error as Error).message;
    } finally {
      await db.query('rollback');
    }
  }

  it('refuses the repointing that 202609240025 still allowed', async () => {
    await db.query('begin');
    try {
      const szsMember = await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        SECRET_SZS_NAME,
      ]);
      await db.query('savepoint repoint');
      const refused = await db
        .query(`update public.registry_audit set entity_id = $1 where id = $2`, [
          szsMember,
          dvdAuditRow,
        ])
        .then(() => 'OK')
        .catch((error: Error) => error.message);
      await db.query('rollback to savepoint repoint');
      expect(String(refused)).toContain('AUDIT_APPEND_ONLY');
    } finally {
      await db.query('rollback');
    }
  });

  const UPDATES: ReadonlyArray<readonly [string, string, 'row' | 'service' | 'account']> = [
    ['entity_kind', `update public.registry_audit set entity_kind = 'VEHICLE' where id = $1`, 'row'],
    ['entity_id', `update public.registry_audit set entity_id = gen_random_uuid() where id = $1`, 'row'],
    ['organization_id', `update public.registry_audit set organization_id = $2 where id = $1`, 'service'],
    ['detail', `update public.registry_audit set detail = '{"full_name":"Neko Drugi"}' where id = $1`, 'row'],
    ['event_type', `update public.registry_audit set event_type = 'REWRITTEN' where id = $1`, 'row'],
    ['changed_by', `update public.registry_audit set changed_by = $2 where id = $1`, 'account'],
    ['changed_at', `update public.registry_audit set changed_at = now() where id = $1`, 'row'],
    ['reason', `update public.registry_audit set reason = 'drugi razlog' where id = $1`, 'row'],
  ];

  it.each(UPDATES)('refuses an update of %s', async (column, statement, shape) => {
    // Every column, not only the ones somebody thought of: rewriting `detail`
    // falsifies the recorded name and rewriting `changed_by` blames the wrong
    // person, both worse than a mislabelled service.
    const params =
      shape === 'service' ? [dvdAuditRow, SZS]
      : shape === 'account' ? [dvdAuditRow, szsAdmin]
      : [dvdAuditRow];
    expect(String(await attempt(statement, params)), column).toContain('AUDIT_APPEND_ONLY');
  });

  it('refuses a delete, including by the superuser', async () => {
    expect(
      String(await attempt(`delete from public.registry_audit where id = $1`, [dvdAuditRow])),
    ).toContain('AUDIT_APPEND_ONLY');
    expect(String(await attempt(`delete from public.registry_audit`))).toContain(
      'AUDIT_APPEND_ONLY',
    );
  });

  it('still appends, which is the whole point', async () => {
    await db.query('begin');
    try {
      const created = await act(szsAdmin, `select public.admin_create_member_in($1, $2, '{}')`, [
        SZS,
        'Novi Poslije Zabrane',
      ]);
      expect(isRefusal(created), `the command still works: ${created}`).toBe(false);
      const { rows } = await db.query<{ organization_id: string }>(
        `select organization_id::text from public.registry_audit where entity_id = $1`,
        [created],
      );
      expect(rows, 'and its audit row was written').toHaveLength(1);
      expect(rows[0]!.organization_id, 'still attributed from the entity').toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  it('keeps 202609240025 backfill intact: same rows, same attribution', async () => {
    const { rows: total } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit`,
    );
    expect(Number(total[0]!.n), 'no row lost to the new guard').toBe(auditRows);

    const { rows: nulls } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit where organization_id is null`,
    );
    expect(nulls[0]!.n, 'every row is still attributed').toBe('0');
  });

  it('replaced the narrower guard rather than stacking on it', async () => {
    const { rows } = await db.query<{ tgname: string; def: string }>(
      `select t.tgname, pg_get_triggerdef(t.oid) as def
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and n.nspname = 'public' and c.relname = 'registry_audit'
        order by t.tgname`,
    );
    expect(rows.map((row) => row.tgname).sort()).toEqual(['enforce_organization', 'refuse_change']);
    const refuse = rows.find((row) => row.tgname === 'refuse_change')!;
    // PostgreSQL normalises the event list, so this reads DELETE OR UPDATE.
    expect(refuse.def, 'covers both statements').toMatch(/BEFORE DELETE OR UPDATE/i);
  });

  it('leaves the guard uncallable as an RPC', async () => {
    const { rows } = await db.query<{ acl: string }>(
      `select coalesce(array_to_string(p.proacl::text[], ' '), 'DEFAULT') as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'refuse_registry_audit_change'`,
    );
    expect(rows[0]!.acl).not.toMatch(/\banon=/);
    expect(rows[0]!.acl).not.toMatch(/\bauthenticated=/);
    expect(rows[0]!.acl, 'and no bare PUBLIC grant either').not.toMatch(/(^|\s)=X/);
  });
});
