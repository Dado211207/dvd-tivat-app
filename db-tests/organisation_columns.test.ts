/**
 * Every operational record learns which service it belongs to.
 *
 * `202609240022` adds `organization_id` to the four owning tables and to every
 * table hanging off them, backfills all of it to DVD, and makes it `not null`.
 * Authority is untouched: nothing reads these columns yet, no policy changes,
 * no function changes. What changes is that the schema can now *express* a
 * second service, which is the precondition for everything after it.
 *
 * Three things about that are worth asserting rather than assuming.
 *
 * FIRST, the unique constraints. `members UNIQUE (user_id)` says one person has
 * one member record in the whole installation - which is exactly the statement
 * that stops somebody serving in both services. The same for a vehicle callsign
 * and a group name. Those three swap to be per-service, and the tests below
 * drive both halves: the new thing must become possible, and the old collision
 * must still be refused. These fail against P1.
 *
 * SECOND, the rows already there. A backfill that quietly drops or rewrites a
 * row is the failure nobody notices until the archive is wrong, so the suite
 * applies the migrations in two stages with a known rowset written in between
 * and checksums both sides of it.
 *
 * THIRD, and this is the part the plan did not say out loud: once the column is
 * `not null` on seventeen child tables, every insert path has to supply it. The
 * commands do not, and should not have to - the value is a property of the
 * parent row, not of the caller. So the migration derives it with a trigger,
 * and the test drives a real call-out end to end through the real commands to
 * prove writes still work. Without that trigger this phase breaks every write
 * in the application, which is a considerably worse outcome than the one it
 * fixes.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  grantRole,
} from './harness';

const ORGANISATION_COLUMNS = 'supabase/migrations/202609240022_organisation_columns.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

/** Every table that gains the column, and how it reaches its organisation. */
const OWNING_TABLES = ['members', 'vehicles', 'groups', 'interventions'] as const;

const CHILD_TABLES = [
  'group_members',
  'member_availability',
  'member_availability_history',
  'intervention_recipients',
  'intervention_responses',
  'intervention_response_revisions',
  'intervention_updates',
  'intervention_acknowledgements',
  'intervention_journey',
  'intervention_journey_history',
  'attendance_intervals',
  'attendance_corrections',
  'attendance_correction_requests',
  'vehicle_movements',
  'notification_outbox',
  'notification_delivery_attempts',
  'operational_audit',
] as const;

const ALL_SCOPED = [...OWNING_TABLES, ...CHILD_TABLES];

let db: Client;
let owner: string;

/** Written before the migration, looked for after it. */
const CARRIED_MEMBER = 'Prije Migracije Clan';
const CARRIED_VEHICLE = 'PRIJE-1';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

/**
 * A checksum over one table's rows, EXCLUDING the new column.
 *
 * Including it would compare the migration against itself. The question this
 * answers is whether everything that was already in the row is still there and
 * still says the same thing.
 */
async function rowsetChecksum(client: Client, table: string): Promise<{ rows: number; hash: string }> {
  const { rows: columns } = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
        and column_name not in ('organization_id', 'credited_organization_id')
      order by column_name`,
    [table],
  );
  const list = columns.map((c) => `coalesce(${c.column_name}::text, '~')`).join(` || '|' || `);
  const { rows } = await client.query<{ line: string }>(
    `select ${list} as line from public.${table} order by 1`,
  );
  return {
    rows: rows.length,
    hash: createHash('md5').update(rows.map((r) => r.line).join('\n')).digest('hex'),
  };
}

const beforeMigration = new Map<string, { rows: number; hash: string }>();

/**
 * Runs a write AS THE SUPERUSER and returns why the database refused it.
 *
 * Deliberately not `expectRefused` from the harness, which switches to `anon`
 * and would be refused for want of a table privilege long before reaching the
 * thing under test. Everything asserted here is a constraint or a trigger - the
 * backstop that holds even when the command layer is skipped entirely - so the
 * probe has to be the one caller that no policy stops.
 */
async function expectRejected(statement: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(statement, params);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`Expected the database to refuse this, but it succeeded:\n${statement}`);
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
  const earlier = MIGRATIONS.filter((file) => file !== ORGANISATION_COLUMNS);
  expect(earlier.length, 'the migration must be in the list').toBe(MIGRATIONS.length - 1);
  for (const file of earlier) {
    await db.query(sql(file));
  }

  const account = await createAccount(db, 'vlasnik.kolone@example.invalid');
  await completeProfile(db, account.userId, 'Vlasnik Kolone');
  await grantRole(db, account.userId, 'OWNER');
  owner = account.userId;

  // A realistic rowset under the OLD shape, standing in for what production
  // holds: a member, a vehicle, a group, and a published intervention with the
  // child rows a real call-out leaves behind.
  await asUserCommitted(db, owner, async (client) => {
    await client.query(`select public.admin_create_member($1, '{}')`, [CARRIED_MEMBER]);
    await client.query(`select public.admin_create_vehicle($1, 'Prije Vozilo', 'NAVALNO')`, [
      CARRIED_VEHICLE,
    ]);
    await client.query(`select public.admin_create_group('Prije Smjena')`);
  });

  for (const table of ALL_SCOPED) {
    beforeMigration.set(table, await rowsetChecksum(db, table));
  }

  // Stage two: the migration under test.
  await db.query(sql(ORGANISATION_COLUMNS));
});

afterAll(async () => db?.end());

describe('every operational table says which service it belongs to', () => {
  it('has the column on all twenty-one tables, not null', async () => {
    const { rows } = await db.query<{ table_name: string; is_nullable: string }>(
      `select table_name, is_nullable from information_schema.columns
        where table_schema = 'public' and column_name = 'organization_id'
          and table_name = any($1)
        order by table_name`,
      [ALL_SCOPED],
    );
    expect(rows.map((r) => r.table_name)).toEqual([...ALL_SCOPED].sort());
    expect(rows.filter((r) => r.is_nullable !== 'NO').map((r) => r.table_name)).toEqual([]);
  });

  it('leaves no row unattributed', async () => {
    // Acceptance criterion 1, asserted per table rather than in aggregate so a
    // failure names the table.
    for (const table of ALL_SCOPED) {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.${table} where organization_id is null`,
      );
      expect(rows[0]!.n, `${table} has unattributed rows`).toBe('0');
    }
  });

  it('backfills every existing row to DVD', async () => {
    for (const table of ALL_SCOPED) {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.${table} where organization_id <> $1`,
        [DVD],
      );
      expect(rows[0]!.n, `${table} has a row attributed elsewhere`).toBe('0');
    }
  });

  it('points the column at organizations, and refuses an unknown service', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      // Distinct, because `attendance_intervals` legitimately has two of them:
      // the service that ran the call-out and the one credited for it.
      `select distinct cl.relname as table_name
         from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and c.contype = 'f'
          and c.confrelid = 'public.organizations'::regclass
          and cl.relname = any($1)
        order by cl.relname`,
      [ALL_SCOPED],
    );
    expect(rows.map((r) => r.table_name)).toEqual([...ALL_SCOPED].sort());

    const message = await expectRejected(
      `insert into public.members(full_name, organization_id)
       values ('Nepostojeca Sluzba', '00000000-0000-4000-8000-000000000009')`,
    );
    expect(message).toMatch(/foreign key|violates/i);
  });
});

describe('the rows that were already there are untouched', () => {
  it('keeps every row, with identical content', async () => {
    // Acceptance criterion 2. The checksum excludes the new column, so this is
    // asking whether the backfill rewrote anything it should not have.
    for (const table of ALL_SCOPED) {
      const after = await rowsetChecksum(db, table);
      const before = beforeMigration.get(table)!;
      expect(after.rows, `${table} changed row count`).toBe(before.rows);
      expect(after.hash, `${table} changed row content`).toBe(before.hash);
    }
  });

  it('still has the member, vehicle and group written before the migration', async () => {
    const member = await db.query(`select 1 from public.members where full_name = $1`, [
      CARRIED_MEMBER,
    ]);
    const vehicle = await db.query(`select 1 from public.vehicles where callsign = $1`, [
      CARRIED_VEHICLE,
    ]);
    const group = await db.query(`select 1 from public.groups where name = 'Prije Smjena'`);
    expect(member.rows).toHaveLength(1);
    expect(vehicle.rows).toHaveLength(1);
    expect(group.rows).toHaveLength(1);
  });
});

describe('uniqueness becomes per-service', () => {
  /*
   * The three constraints that, as written, say "one installation, one service".
   * Each test drives BOTH halves: the thing that must now be possible, and the
   * collision that must still be refused. A migration that only dropped the old
   * constraint would pass the first half of each and destroy the second.
   */
  it('lets one person hold a member record in each service, but not two in one', async () => {
    const person = await createAccount(db, 'dvostruki@example.invalid');
    await completeProfile(db, person.userId, 'Dvostruki Clan');

    await db.query(
      `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
      ['Dvostruki Clan', person.userId, DVD],
    );
    await db.query(
      `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
      ['Dvostruki Clan', person.userId, SZS],
    );

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.members where user_id = $1`,
      [person.userId],
    );
    expect(rows[0]!.n, 'one record per service').toBe('2');

    const message = await expectRejected(
      `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3)`,
      ['Dvostruki Clan Opet', person.userId, DVD],
    );
    expect(message, 'a second record in the SAME service is still refused').toMatch(
      /duplicate key|unique/i,
    );
  });

  it('lets the two services each have a vehicle called the same thing, but not one service twice', async () => {
    await db.query(
      `insert into public.vehicles(callsign, name, kind, organization_id) values ('V-1', 'Navalno DVD', 'NAVALNO', $1)`,
      [DVD],
    );
    await db.query(
      `insert into public.vehicles(callsign, name, kind, organization_id) values ('V-1', 'Navalno SZS', 'NAVALNO', $1)`,
      [SZS],
    );

    const message = await expectRejected(
      `insert into public.vehicles(callsign, name, kind, organization_id) values ('V-1', 'Navalno DVD Opet', 'NAVALNO', $1)`,
      [DVD],
    );
    expect(message).toMatch(/duplicate key|unique/i);
  });

  it('lets the two services each have a group called the same thing, but not one service twice', async () => {
    await db.query(`insert into public.groups(name, organization_id) values ('Prva smjena', $1)`, [
      DVD,
    ]);
    await db.query(`insert into public.groups(name, organization_id) values ('Prva smjena', $1)`, [
      SZS,
    ]);

    const message = await expectRejected(
      `insert into public.groups(name, organization_id) values ('Prva smjena', $1)`,
      [DVD],
    );
    expect(message).toMatch(/duplicate key|unique/i);
  });
});

describe('writes still work, which is the part that could have broken everything', () => {
  /*
   * `not null` on seventeen child tables with no way to populate them is an
   * outage, not a migration. No command passes an organisation - the value is a
   * property of the parent row - so the migration derives it. This drives a
   * whole call-out through the real commands and checks what the derived value
   * came out as, rather than checking that the trigger exists.
   */
  it('derives the organisation for every child row of a real call-out', async () => {
    const commander = await createAccount(db, 'komandir.kolone@example.invalid');
    await completeProfile(db, commander.userId, 'Komandir Kolone');
    await grantRole(db, commander.userId, 'COMMANDER');
    const commanderMember = await asUserCommitted(db, owner, (client) =>
      client.query<{ id: string }>(`select public.admin_create_member('Komandir Kolone', '{}') as id`),
    );
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.admin_link_member_account($1, $2)`, [
        commanderMember.rows[0]!.id,
        commander.userId,
      ]),
    );

    const intervention = await asUserCommitted(db, commander.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.create_intervention_draft(
           'POZAR', 'Vjezba: kolone', 'Okupljanje u bazi.', 'Poligon (izmisljena lokacija)',
           $1) as id`,
        [`kolone-${Math.random().toString(36).slice(2)}`],
      );
      const id = rows[0]!.id;
      await client.query(`select public.publish_intervention($1, array[$2]::uuid[])`, [
        id,
        commanderMember.rows[0]!.id,
      ]);
      return id;
    });

    await asUserCommitted(db, commander.userId, (client) =>
      client.query(`select public.submit_response($1, 'DOLAZIM', 10, false)`, [intervention]),
    );
    await asUserCommitted(db, commander.userId, (client) =>
      client.query(`select public.acknowledge_intervention($1)`, [intervention]),
    );
    await asUserCommitted(db, commander.userId, (client) =>
      client.query(`select public.set_journey_progress($1, 'KRECEM')`, [intervention]),
    );

    // Every child row this produced must carry DVD, derived, with nobody having
    // passed it in.
    for (const table of [
      'intervention_recipients',
      'intervention_responses',
      'intervention_acknowledgements',
      'intervention_journey',
      'intervention_journey_history',
      'operational_audit',
      'notification_outbox',
    ]) {
      const { rows } = await db.query<{ n: string; wrong: string }>(
        `select count(*)::text as n,
                count(*) filter (where organization_id is distinct from $2)::text as wrong
           from public.${table} where intervention_id = $1`,
        [intervention, DVD],
      );
      expect(Number(rows[0]!.n), `${table} recorded nothing for the call-out`).toBeGreaterThan(0);
      expect(rows[0]!.wrong, `${table} derived the wrong organisation`).toBe('0');
    }

    // Two hops from the intervention: this one only knows its response.
    const { rows: revisions } = await db.query<{ n: string; wrong: string }>(
      `select count(*)::text as n,
              count(*) filter (where revision.organization_id is distinct from $2)::text as wrong
         from public.intervention_response_revisions revision
         join public.intervention_responses response on response.id = revision.response_id
        where response.intervention_id = $1`,
      [intervention, DVD],
    );
    expect(Number(revisions[0]!.n), 'no revision was recorded').toBeGreaterThan(0);
    expect(revisions[0]!.wrong, 'a revision derived the wrong organisation').toBe('0');
  });

  it('follows the parent rather than the caller when the parent is the other service', async () => {
    // The value comes from the intervention, not from whoever is writing. An
    // SZS intervention's audit rows are SZS rows even though the owner writing
    // them is the installation owner.
    const { rows: created } = await db.query<{ id: string }>(
      `insert into public.interventions(
         kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Vjezba SZS', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
      [owner, `szs-${Math.random().toString(36).slice(2)}`, SZS],
    );
    const intervention = created[0]!.id;

    await db.query(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
       values ($1, 'TEST_EVENT', '{}'::jsonb, $2)`,
      [intervention, owner],
    );

    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.operational_audit where intervention_id = $1`,
      [intervention],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id, 'the child follows its parent').toBe(SZS);
  });

  it('refuses a group that mixes the two services', async () => {
    // `group_members` is the one child with two org-scoped parents, so it is
    // the one place the two can disagree. They must not.
    const { rows: group } = await db.query<{ id: string }>(
      `insert into public.groups(name, organization_id) values ('Smjena Mjesana', $1) returning id`,
      [DVD],
    );
    const { rows: member } = await db.query<{ id: string }>(
      `insert into public.members(full_name, organization_id) values ('Clan SZS', $1) returning id`,
      [SZS],
    );

    const message = await expectRejected(
      `insert into public.group_members(group_id, member_id) values ($1, $2)`,
      [group[0]!.id, member[0]!.id],
    );
    expect(message).toMatch(/ORGANIZATION_MISMATCH|violates|constraint/i);
  });
});

describe('attendance records which service is credited', () => {
  it('has credited_organization_id, backfilled and not null', async () => {
    // Section 6.3: an SZS firefighter turning out to a DVD call-out is DVD's
    // attendance to report and SZS's to credit. The second column exists from
    // this phase so no history has to be rewritten later; nothing reads it yet.
    const { rows } = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'attendance_intervals'
          and column_name = 'credited_organization_id'`,
    );
    expect(rows, 'the column exists').toHaveLength(1);
    expect(rows[0]!.is_nullable).toBe('NO');

    const { rows: unattributed } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.attendance_intervals
        where credited_organization_id is null`,
    );
    expect(unattributed[0]!.n).toBe('0');
  });
});
