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

  /*
   * A realistic rowset under the OLD shape, standing in for what production
   * holds. This has to be a WHOLE CALL-OUT, not a member and a vehicle: the
   * checksum below proves the backfill preserved what was there, and it proves
   * nothing at all about the seventeen child tables if they are empty when it
   * runs. An earlier version of this fixture described a call-out in its
   * comment and created three rows; that is why the two orphan cases below are
   * built explicitly rather than hoped for.
   */
  const commanderAccount = await createAccount(db, 'komandir.prije@example.invalid');
  await completeProfile(db, commanderAccount.userId, 'Komandir Prije');
  await grantRole(db, commanderAccount.userId, 'COMMANDER');

  const carried = await asUserCommitted(db, owner, async (client) => {
    const member = await client.query<{ id: string }>(
      `select public.admin_create_member($1, '{}') as id`,
      [CARRIED_MEMBER],
    );
    const vehicle = await client.query<{ id: string }>(
      `select public.admin_create_vehicle($1, 'Prije Vozilo', 'NAVALNO') as id`,
      [CARRIED_VEHICLE],
    );
    const group = await client.query<{ id: string }>(
      `select public.admin_create_group('Prije Smjena') as id`,
    );
    // A second vehicle, because the first stays out for the whole fixture and
    // `record_vehicle_departure` refuses one that has not come back.
    const spare = await client.query<{ id: string }>(
      `select public.admin_create_vehicle('PRIJE-2', 'Prije Vozilo Dva', 'NAVALNO') as id`,
    );
    await client.query(`select public.admin_link_member_account($1, $2)`, [
      member.rows[0]!.id,
      commanderAccount.userId,
    ]);
    await client.query(`select public.admin_set_group_members($1, array[$2]::uuid[])`, [
      group.rows[0]!.id,
      member.rows[0]!.id,
    ]);
    return {
      memberId: member.rows[0]!.id,
      vehicleId: vehicle.rows[0]!.id,
      spareVehicleId: spare.rows[0]!.id,
    };
  });

  // A call-out that leaves a row in most of the child tables.
  const published = await asUserCommitted(db, commanderAccount.userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select public.create_intervention_draft(
         'POZAR', 'Vjezba prije migracije', 'Okupljanje u bazi.', 'Poligon (izmisljena lokacija)',
         $1) as id`,
      [`prije-${Math.random().toString(36).slice(2)}`],
    );
    const id = rows[0]!.id;
    await client.query(`select public.publish_intervention($1, array[$2]::uuid[])`, [
      id,
      carried.memberId,
    ]);
    return id;
  });

  await asUserCommitted(db, commanderAccount.userId, async (client) => {
    await client.query(`select public.submit_response($1, 'DOLAZIM', 10, false)`, [published]);
    await client.query(`select public.acknowledge_intervention($1)`, [published]);
    await client.query(`select public.set_journey_progress($1, 'KRECEM')`, [published]);
    await client.query(`select public.set_own_availability(true, 'Spreman')`);
    await client.query(`select public.attendance_check_in($1, $2, null, null, null)`, [
      published,
      carried.memberId,
    ]);
    await client.query(`select public.record_vehicle_departure($1, $2, 'Intervencija')`, [
      carried.vehicleId,
      published,
    ]);
  });

  /*
   * The two orphan cases, built rather than assumed. Deleting an intervention
   * does not refuse - the foreign keys are `on delete set null` - so its audit
   * rows and vehicle movements survive with no parent. Production holds 22 such
   * audit rows and 1 such movement, and they have to be backfilled too.
   */
  const orphaned = await asUserCommitted(db, commanderAccount.userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select public.create_intervention_draft(
         'POZAR', 'Vjezba za brisanje', 'Okupljanje.', 'Poligon', $1) as id`,
      [`sirotan-${Math.random().toString(36).slice(2)}`],
    );
    const id = rows[0]!.id;
    await client.query(`select public.publish_intervention($1, array[$2]::uuid[])`, [
      id,
      carried.memberId,
    ]);
    await client.query(`select public.record_vehicle_departure($1, $2, 'Za brisanje')`, [
      carried.spareVehicleId,
      id,
    ]);
    return id;
  });
  await db.query(`delete from public.interventions where id = $1`, [orphaned]);

  const orphanCounts = await db.query<{ audit: string; movements: string }>(
    `select (select count(*)::text from public.operational_audit where intervention_id is null) as audit,
            (select count(*)::text from public.vehicle_movements where intervention_id is null) as movements`,
  );
  expect(Number(orphanCounts.rows[0]!.audit), 'the fixture must contain orphaned audit rows').toBeGreaterThan(0);
  expect(
    Number(orphanCounts.rows[0]!.movements),
    'the fixture must contain an orphaned vehicle movement',
  ).toBeGreaterThan(0);

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
  it('had rows in the child tables to begin with, or the checksum proves nothing', () => {
    // The guard on the test below. A fixture that leaves the child tables empty
    // makes "every row survived" a statement about nothing, and that is exactly
    // what the first version of this file did.
    const populated = [...beforeMigration.entries()].filter(([, v]) => v.rows > 0).map(([t]) => t);
    for (const table of [
      'members',
      'vehicles',
      'groups',
      'interventions',
      'group_members',
      'member_availability',
      'member_availability_history',
      'intervention_recipients',
      'intervention_responses',
      'intervention_response_revisions',
      'intervention_acknowledgements',
      'intervention_journey',
      'intervention_journey_history',
      'attendance_intervals',
      'vehicle_movements',
      'notification_outbox',
      'operational_audit',
    ]) {
      expect(populated, `${table} was empty before the migration`).toContain(table);
    }
  });

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

describe('a child cannot disagree with its parent', () => {
  /*
   * P4 intends to use these columns as an authorisation boundary: a policy will
   * read `organization_id` off the row rather than joining to the parent. That
   * only holds if the column cannot lie. Three ways it could:
   *
   *   - an INSERT that supplies a service its parent does not have;
   *   - an UPDATE that rewrites the column afterwards;
   *   - an UPDATE that re-parents the row to the other service.
   *
   * The first version of this migration allowed all three. It derived the value
   * only when none was supplied, and only on INSERT, which made the column a
   * suggestion rather than a fact.
   */
  async function szsIntervention(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.interventions(
         kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Vjezba SZS', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
      [owner, `szs-${Math.random().toString(36).slice(2)}`, SZS],
    );
    return rows[0]!.id;
  }

  async function dvdIntervention(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.interventions(
         kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Vjezba DVD', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
      [owner, `dvd-${Math.random().toString(36).slice(2)}`, DVD],
    );
    return rows[0]!.id;
  }

  it('refuses an insert that claims a service its parent does not have', async () => {
    const intervention = await dvdIntervention();
    const message = await expectRejected(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id, organization_id)
       values ($1, 'TEST_EVENT', '{}'::jsonb, $2, $3)`,
      [intervention, owner, SZS],
    );
    expect(message).toMatch(/ORGANIZATION_MISMATCH/);
  });

  it('accepts an insert that supplies the same service its parent has', async () => {
    // The refusal above must be about DISAGREEMENT, not about supplying a value
    // at all - a later phase will pass it explicitly.
    const intervention = await szsIntervention();
    await db.query(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id, organization_id)
       values ($1, 'TEST_EVENT', '{}'::jsonb, $2, $3)`,
      [intervention, owner, SZS],
    );
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.operational_audit where intervention_id = $1`,
      [intervention],
    );
    expect(rows[0]!.organization_id).toBe(SZS);
  });

  it('refuses rewriting the column after the row exists', async () => {
    const intervention = await dvdIntervention();
    await db.query(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
       values ($1, 'TEST_EVENT', '{}'::jsonb, $2)`,
      [intervention, owner],
    );
    const message = await expectRejected(
      `update public.operational_audit set organization_id = $2 where intervention_id = $1`,
      [intervention, SZS],
    );
    expect(message).toMatch(/ORGANIZATION_MISMATCH/);
  });

  it('refuses re-parenting a row into the other service', async () => {
    const dvd = await dvdIntervention();
    const szs = await szsIntervention();
    await db.query(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
       values ($1, 'TEST_EVENT', '{}'::jsonb, $2)`,
      [dvd, owner],
    );
    const message = await expectRejected(
      `update public.operational_audit set intervention_id = $2 where intervention_id = $1`,
      [dvd, szs],
    );
    expect(message).toMatch(/ORGANIZATION_MISMATCH/);
  });

  it('allows a re-parent that moves both together, because nothing then disagrees', async () => {
    const first = await szsIntervention();
    const second = await szsIntervention();
    await db.query(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
       values ($1, 'TEST_EVENT', '{}'::jsonb, $2)`,
      [first, owner],
    );
    await db.query(
      `update public.operational_audit set intervention_id = $2 where intervention_id = $1`,
      [first, second],
    );
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.operational_audit where intervention_id = $1`,
      [second],
    );
    expect(rows[0]!.organization_id).toBe(SZS);
  });

  it('keeps the service when the parent is detached by a delete', async () => {
    /*
     * `on delete set null` performs an UPDATE, so the rule above would re-derive
     * from a parent that is now gone and either wipe the value or fall back to
     * DVD. Either would rewrite the service of a historical SZS record at the
     * moment its call-out was deleted - silently, and exactly where the audit
     * trail matters most.
     */
    const intervention = await szsIntervention();
    await db.query(
      `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
       values ($1, 'DETACH_ME', '{}'::jsonb, $2)`,
      [intervention, owner],
    );
    await db.query(`delete from public.interventions where id = $1`, [intervention]);

    const { rows } = await db.query<{ organization_id: string; intervention_id: string | null }>(
      `select organization_id, intervention_id from public.operational_audit where event_type = 'DETACH_ME'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.intervention_id, 'the parent really was detached').toBeNull();
    expect(rows[0]!.organization_id, 'and the service survived it').toBe(SZS);
  });
});

describe('the two-parent tables, each on its own terms', () => {
  it('vehicle_movements follows the call-out, and falls back to the vehicle without one', async () => {
    const { rows: vehicle } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind, organization_id)
       values ('DVOJE-1', 'Vozilo Dvoje', 'NAVALNO', $1) returning id`,
      [DVD],
    );
    const { rows: intervention } = await db.query<{ id: string }>(
      `insert into public.interventions(
         kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Vjezba SZS dvoje', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
      [owner, `dvoje-${Math.random().toString(36).slice(2)}`, SZS],
    );

    // With a call-out, the call-out decides - consistent with every other child
    // of an intervention. A DVD vehicle at an SZS call-out therefore produces an
    // SZS movement row; see the migration header, this one needs an owner
    // decision before P7 and nothing depends on it yet.
    const { rows: withCallOut } = await db.query<{ organization_id: string }>(
      `insert into public.vehicle_movements(vehicle_id, intervention_id, purpose, departed_by)
       values ($1, $2, 'Intervencija', $3) returning organization_id`,
      [vehicle[0]!.id, intervention[0]!.id, owner],
    );
    expect(withCallOut[0]!.organization_id).toBe(SZS);

    // Without one, the vehicle is the only parent there is. A second vehicle,
    // because `vehicle_movement_no_overlap` refuses one that is already out.
    const { rows: spare } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind, organization_id)
       values ('DVOJE-1B', 'Vozilo Dvoje B', 'NAVALNO', $1) returning id`,
      [DVD],
    );
    const { rows: withoutCallOut } = await db.query<{ organization_id: string }>(
      `insert into public.vehicle_movements(vehicle_id, purpose, departed_by)
       values ($1, 'Servis', $2) returning organization_id`,
      [spare[0]!.id, owner],
    );
    expect(withoutCallOut[0]!.organization_id).toBe(DVD);
  });

  it('keeps a movement its service when its call-out is deleted', async () => {
    const { rows: vehicle } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind, organization_id)
       values ('DVOJE-2', 'Vozilo Dvoje Dva', 'NAVALNO', $1) returning id`,
      [DVD],
    );
    const { rows: intervention } = await db.query<{ id: string }>(
      `insert into public.interventions(
         kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Vjezba brisanje', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
      [owner, `brisanje-${Math.random().toString(36).slice(2)}`, SZS],
    );
    await db.query(
      `insert into public.vehicle_movements(vehicle_id, intervention_id, purpose, departed_by)
       values ($1, $2, 'Za brisanje', $3)`,
      [vehicle[0]!.id, intervention[0]!.id, owner],
    );
    await db.query(`delete from public.interventions where id = $1`, [intervention[0]!.id]);

    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.vehicle_movements
        where vehicle_id = $1 and purpose = 'Za brisanje'`,
      [vehicle[0]!.id],
    );
    // SZS, not the DVD its vehicle belongs to: the movement was SZS's when it
    // happened and deleting the record of the call-out does not change that.
    expect(rows[0]!.organization_id).toBe(SZS);
  });

  it('refuses moving a group member across services by update, not only by insert', async () => {
    const { rows: group } = await db.query<{ id: string }>(
      `insert into public.groups(name, organization_id) values ('Smjena Premjestaj', $1) returning id`,
      [DVD],
    );
    const { rows: dvdMember } = await db.query<{ id: string }>(
      `insert into public.members(full_name, organization_id) values ('Clan DVD Premjestaj', $1) returning id`,
      [DVD],
    );
    const { rows: szsMember } = await db.query<{ id: string }>(
      `insert into public.members(full_name, organization_id) values ('Clan SZS Premjestaj', $1) returning id`,
      [SZS],
    );
    await db.query(`insert into public.group_members(group_id, member_id) values ($1, $2)`, [
      group[0]!.id,
      dvdMember[0]!.id,
    ]);

    const message = await expectRejected(
      `update public.group_members set member_id = $3 where group_id = $1 and member_id = $2`,
      [group[0]!.id, dvdMember[0]!.id, szsMember[0]!.id],
    );
    expect(message).toMatch(/ORGANIZATION_MISMATCH/);
  });
});

describe('an owning record cannot change service under its children', () => {
  it('refuses moving an intervention to the other service', async () => {
    /*
     * The alternative to refusing is cascading, which would silently rewrite the
     * attribution of every child row - including attendance credit - for a
     * record of something that already happened. Whose call-out it was is not an
     * editable field. If a real transfer is ever needed it wants a deliberate
     * command with its own audit, not an UPDATE that reaches seventeen tables.
     */
    const { rows } = await db.query<{ id: string }>(
      `insert into public.interventions(
         kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Vjezba nepromjenjiva', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
      [owner, `nepromjenjiva-${Math.random().toString(36).slice(2)}`, DVD],
    );
    const message = await expectRejected(
      `update public.interventions set organization_id = $2 where id = $1`,
      [rows[0]!.id, SZS],
    );
    expect(message).toMatch(/ORGANIZATION_IMMUTABLE/);
  });

  it('refuses it for members, vehicles and groups too', async () => {
    const member = await db.query<{ id: string }>(
      `insert into public.members(full_name, organization_id) values ('Clan Nepromjenjiv', $1) returning id`,
      [DVD],
    );
    const vehicle = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind, organization_id)
       values ('NEPR-1', 'Vozilo Nepromjenjivo', 'NAVALNO', $1) returning id`,
      [DVD],
    );
    const group = await db.query<{ id: string }>(
      `insert into public.groups(name, organization_id) values ('Smjena Nepromjenjiva', $1) returning id`,
      [DVD],
    );

    for (const [table, id] of [
      ['members', member.rows[0]!.id],
      ['vehicles', vehicle.rows[0]!.id],
      ['groups', group.rows[0]!.id],
    ] as const) {
      const message = await expectRejected(
        `update public.${table} set organization_id = $2 where id = $1`,
        [id, SZS],
      );
      expect(message, `${table} let its service be changed`).toMatch(/ORGANIZATION_IMMUTABLE/);
    }
  });

  it('still allows an update that leaves the service alone', async () => {
    // The guard must be on the column, not on the table: ordinary edits keep
    // working, which is what `admin_update_member` does on every roster change.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.members(full_name, organization_id) values ('Clan Preimenovan', $1) returning id`,
      [DVD],
    );
    await db.query(`update public.members set full_name = 'Clan Preimenovan Opet' where id = $1`, [
      rows[0]!.id,
    ]);
    const { rows: after } = await db.query<{ full_name: string }>(
      `select full_name from public.members where id = $1`,
      [rows[0]!.id],
    );
    expect(after[0]!.full_name).toBe('Clan Preimenovan Opet');
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
