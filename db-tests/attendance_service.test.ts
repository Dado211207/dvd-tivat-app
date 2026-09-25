/**
 * Attendance, and asking for it to be corrected, in the service that owns it.
 *
 * P4d of docs/MULTI_ORG_PLAN.md. P4b already scoped every read of the four P4d
 * tables and every attendance and vehicle command (202609250028, -029). What
 * was left is the one direct write a member may make and the rule that keeps
 * what these rows MEAN from being rewritten later:
 *
 *   `correction_requests_self_create`  the INSERT policy checks the interval's
 *                                      member against `current_member_id()`,
 *                                      the DVD shim - so an SZS member cannot
 *                                      ask for a correction to their own SZS
 *                                      attendance, and a dual-service member
 *                                      only for their DVD attendance
 *   who, when, already decided          the same policy lets the requester set
 *                                      `resolved_by`, `resolved_at`,
 *                                      `resolution_note` and `requested_at`, so
 *                                      a request can arrive already "decided"
 *                                      by a commander who never saw it
 *   what a row is about                 an interval's call-out and member, a
 *                                      correction's interval, a request's
 *                                      interval and author can be rewritten by
 *                                      an UPDATE that keeps organization_id
 *                                      consistent - the row keeps its history
 *                                      and changes whose it is
 *
 * The plan's rule since P4a: every column that decides what a history row
 * means is settled at insert. The first two are about who may write; the third
 * is about whether what was written stays true.
 *
 * Deliberately NOT here: crediting. `credited_organization_id` is insert-only
 * and equal to the call-out's service for every row a command can produce;
 * whether it may ever differ is Q5's, which is unanswered. This file proves it
 * stays equal and cannot be rewritten - nothing more.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const ATTENDANCE = 'supabase/migrations/202609250031_attendance_service.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const UNKNOWN = '00000000-0000-4000-8fff-000000000001';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

type Label =
  | 'owner'
  | 'dvdCommander'
  | 'dvdFirefighter'
  | 'dvdOther'
  | 'dvdSuspended'
  | 'szsCommander'
  | 'szsFirefighter'
  | 'szsOther'
  | 'szsSuspended'
  | 'dual'
  | 'dualSzsWithdrawn'
  | 'citizen';
interface Person {
  user: string;
  dvd?: string;
  szs?: string;
  /** Their closed interval on each service's call-out, where they have one. */
  dvdInterval?: string;
  szsInterval?: string;
}
const people = {} as Record<Label, Person>;

let dvdCallout = '';
let szsCallout = '';
let dvdVehicle = '';
let szsVehicle = '';

/**
 * One statement as `userId`, inside the caller's open transaction, answered as
 * 'OK', the refusal code, or 'RLS' for a row-level security refusal. Savepoints,
 * for the reason the P4a file records.
 */
async function act(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint act');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
    await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint act');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint act');
    await db.query('reset role');
    const message = (error as Error).message;
    if (/row-level security/.test(message)) return 'RLS';
    return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** As postgres - the only role able to UPDATE these tables - inside a savepoint. */
async function asOwnerRole(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint raw');
  try {
    await db.query(statement, params);
    await db.query('release savepoint raw');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint raw');
    return (error as Error).message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

/** A correction request as `who`, for `interval`, with only what a client sends. */
const request = (who: Label, interval: string | undefined, message = 'Molim ispravku vremena') =>
  act(
    people[who].user,
    `insert into public.attendance_correction_requests(interval_id, requested_by, message)
     values ($1, auth.uid(), $2)`,
    [interval, message],
  );

async function account(label: string, grantRole: string): Promise<string> {
  const created = await createAccount(db, `${label.toLowerCase()}.p4d@example.invalid`);
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456', date_of_birth = date '1990-01-01', profile_complete = true
      where user_id = $1`,
    [created.userId, `${label} Test`],
  );
  await db.query(`update public.access_grants set role = $2 where user_id = $1`, [created.userId, grantRole]);
  return created.userId;
}

async function membership(user: string, organization: string, role: string): Promise<void> {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active)
     values ($1, $2, $3, true)
     on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
    [organization, user, role],
  );
}

async function memberIn(organization: string, name: string, user: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.members(full_name, user_id, organization_id, active) values ($1, $2, $3, true) returning id`,
    [name, user, organization],
  );
  return rows[0]!.id;
}

/** One command as `user`, COMMITTED: fixture building through the real commands. */
async function committed(user: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(user)]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(statement, params);
    await db.query('commit');
    return String(Object.values((rows[0] ?? {}) as object)[0] ?? '');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

/**
 * A closed interval for `who` on `callout`: checked in by themselves, moved an
 * hour back (as the other files do, so there is a duration), checked out.
 */
async function attend(who: Label, callout: string): Promise<string> {
  const interval = await committed(people[who].user, 'select public.attendance_check_in($1)', [callout]);
  await db.query(`update public.attendance_intervals set started_at = now() - interval '1 hour' where id = $1`, [interval]);
  await committed(people[who].user, 'select public.attendance_check_out($1)', [callout]);
  return interval;
}

/** Rows of one statement run as `who`, inside the caller's open transaction. */
async function rowsAs<T extends object>(who: Label, statement: string, params: unknown[] = []): Promise<T[]> {
  await db.query('savepoint rows_as');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(people[who].user)]);
    await db.query('set local role authenticated');
    const { rows } = await db.query<T & Record<string, unknown>>(statement, params);
    await db.query('reset role');
    await db.query('release savepoint rows_as');
    return rows;
  } catch (error) {
    await db.query('rollback to savepoint rows_as');
    await db.query('reset role');
    throw error;
  }
}

/** Which services' rows `who` can read from `table`, as `code:count` pairs. */
async function servicesSeen(who: Label, table: string): Promise<string> {
  await db.query('savepoint look');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(people[who].user)]);
  await db.query('set local role authenticated');
  const { rows } = await db.query<{ seen: string | null }>(
    `select string_agg(o.code || ':' || n, ',' order by o.code) as seen
       from (select organization_id, count(*) as n from public.${table} group by 1) x
       join public.organizations o on o.id = x.organization_id`,
  );
  await db.query('reset role');
  await db.query('release savepoint look');
  return rows[0]!.seen ?? '';
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
  // Everything before P4d. Until the migration exists this is every migration
  // there is, and the second half of this file fails - which is the point.
  const index = MIGRATIONS.indexOf(ATTENDANCE);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  // The installation owner holds no membership and no member record.
  people.owner = { user: await account('Vlasnik', 'OWNER') };

  for (const [label, role] of [
    ['dvdCommander', 'COMMANDER'],
    ['dvdFirefighter', 'FIREFIGHTER'],
    ['dvdOther', 'FIREFIGHTER'],
    ['dvdSuspended', 'FIREFIGHTER'],
  ] as const) {
    const user = await account(label, role);
    people[label] = { user, dvd: await memberIn(DVD, `${label} Clan`, user) };
  }
  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership.
  for (const [label, role] of [
    ['szsCommander', 'COMMANDER'],
    ['szsFirefighter', 'FIREFIGHTER'],
    ['szsOther', 'FIREFIGHTER'],
    ['szsSuspended', 'FIREFIGHTER'],
  ] as const) {
    const user = await account(label, 'CITIZEN');
    await membership(user, SZS, role);
    people[label] = { user, szs: await memberIn(SZS, `${label} Clan`, user) };
  }
  // Two people serving in both, each with a member record in each service.
  for (const label of ['dual', 'dualSzsWithdrawn'] as const) {
    const user = await account(label, 'FIREFIGHTER');
    await membership(user, SZS, 'FIREFIGHTER');
    people[label] = {
      user,
      dvd: await memberIn(DVD, `${label} DVD`, user),
      szs: await memberIn(SZS, `${label} SZS`, user),
    };
  }
  people.citizen = { user: await account('Gradjanin', 'CITIZEN') };

  dvdVehicle = (await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind, organization_id) values ('P4D-DVD', 'Vozilo DVD', 'NAVALNO', $1) returning id`,
    [DVD],
  )).rows[0]!.id;
  szsVehicle = (await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind, organization_id) values ('P4D-SZS', 'Vozilo SZS', 'NAVALNO', $1) returning id`,
    [SZS],
  )).rows[0]!.id;

  // One call-out per service, through the real commands, each to its own
  // service's members only.
  dvdCallout = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'DVD poziv', 'Okupljanje u bazi.', 'Poligon DVD', 'p4d-dvd')`,
  );
  await committed(people.dvdCommander.user, 'select public.publish_intervention($1, $2)', [
    dvdCallout,
    (['dvdFirefighter', 'dvdOther', 'dvdSuspended', 'dual', 'dualSzsWithdrawn'] as const).map((who) => people[who].dvd),
  ]);
  szsCallout = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'POZAR', 'SZS poziv', 'Okupljanje kod doma.', 'Poligon SZS', 'p4d-szs')`,
    [SZS],
  );
  await committed(people.szsCommander.user, 'select public.publish_intervention($1, $2)', [
    szsCallout,
    (['szsFirefighter', 'szsOther', 'szsSuspended', 'dual', 'dualSzsWithdrawn'] as const).map((who) => people[who].szs),
  ]);

  for (const who of ['dvdFirefighter', 'dvdOther', 'dvdSuspended', 'dual', 'dualSzsWithdrawn'] as const) {
    people[who].dvdInterval = await attend(who, dvdCallout);
  }
  for (const who of ['szsFirefighter', 'szsOther', 'szsSuspended', 'dual', 'dualSzsWithdrawn'] as const) {
    people[who].szsInterval = await attend(who, szsCallout);
  }
  // A confirmed interval in each service, and a vehicle out on each call-out.
  await committed(people.dvdCommander.user, 'select public.attendance_confirm($1, null)', [people.dvdOther.dvdInterval]);
  await committed(people.szsCommander.user, 'select public.attendance_confirm($1, null)', [people.szsOther.szsInterval]);
  await committed(people.dvdCommander.user, 'select public.record_vehicle_departure($1, $2, null)', [dvdVehicle, dvdCallout]);
  await committed(people.szsCommander.user, 'select public.record_vehicle_departure($1, $2, null)', [szsVehicle, szsCallout]);

  // Only now does each of these lose standing: the attendance stays theirs,
  // what changes is whether they may still ask about it.
  for (const who of ['dvdSuspended', 'szsSuspended'] as const) {
    await db.query(`update public.access_grants set active = false where user_id = $1`, [people[who].user]);
  }
  await db.query(`update public.organization_memberships set active = false where user_id = $1 and organization_id = $2`, [
    people.dualSzsWithdrawn.user,
    SZS,
  ]);
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before P4d: a correction request is asked of the DVD shim', () => {
  it('refuses an SZS member a correction to their own SZS attendance', async () => {
    await isolated(async () => {
      expect(await request('szsFirefighter', people.szsFirefighter.szsInterval)).toBe('RLS');
      // A dual-service member only for their DVD record.
      expect(await request('dual', people.dual.szsInterval)).toBe('RLS');
      expect(await request('dual', people.dual.dvdInterval)).toBe('OK');
      expect(await request('dvdFirefighter', people.dvdFirefighter.dvdInterval)).toBe('OK');
    });
  });

  it('lets a request arrive already decided, at a time of the requester\'s choosing', async () => {
    await isolated(async () => {
      expect(
        await act(
          people.dvdFirefighter.user,
          `insert into public.attendance_correction_requests(
             interval_id, requested_by, message, resolved_by, resolved_at, resolution_note, requested_at)
           values ($1, auth.uid(), 'Molim ispravku', $2, now(), 'Odobreno', now() - interval '30 days')`,
          [people.dvdFirefighter.dvdInterval, people.dvdCommander.user],
        ),
      ).toBe('OK');
    });
  });

  it('lets an UPDATE move a history row onto another call-out, member or interval', async () => {
    await isolated(async () => {
      // Consistent with organization_id each time, which is all the existing
      // triggers ask.
      expect(
        await asOwnerRole(
          `update public.attendance_intervals set intervention_id = $2, organization_id = $3 where id = $1`,
          [people.dvdFirefighter.dvdInterval, szsCallout, SZS],
        ),
      ).toBe('OK');
      // Onto somebody with no attendance of their own, so no overlap rule
      // stands in for the missing one.
      expect(
        await asOwnerRole(`update public.attendance_intervals set member_id = $2 where id = $1`, [
          people.dvdOther.dvdInterval,
          people.szsCommander.szs,
        ]),
      ).toBe('OK');
    });
  });
});

describe('after P4d: attendance is asked about, and stays, in the service that owns it', () => {
  beforeAll(async () => {
    // P4d and everything that sorts after it, so a later migration that
    // reopens any of this fails here rather than in production.
    const index = MIGRATIONS.indexOf(ATTENDANCE);
    if (index > -1) {
      for (const file of MIGRATIONS.slice(index)) await db.query(sql(file));
    }
  }, 120_000);

  describe('asking for a correction', () => {
    it('an SZS member asks about their own SZS attendance, and the request is SZS\'s', async () => {
      await isolated(async () => {
        expect(await request('szsFirefighter', people.szsFirefighter.szsInterval)).toBe('OK');
        const { rows } = await db.query<{ organization: string; requested_by: string; state: string }>(
          `select o.code as organization, r.requested_by::text, r.state
             from public.attendance_correction_requests r join public.organizations o on o.id = r.organization_id
            where r.interval_id = $1`,
          [people.szsFirefighter.szsInterval],
        );
        expect(rows).toEqual([{ organization: 'SZS', requested_by: people.szsFirefighter.user, state: 'OPEN' }]);
      });
    });

    it('somebody serving in both asks about each record in its own service', async () => {
      await isolated(async () => {
        expect(await request('dual', people.dual.szsInterval)).toBe('OK');
        expect(await request('dual', people.dual.dvdInterval)).toBe('OK');
        const { rows } = await db.query<{ organization: string }>(
          `select o.code as organization from public.attendance_correction_requests r
             join public.organizations o on o.id = r.organization_id
            where r.requested_by = $1 order by 1`,
          [people.dual.user],
        );
        expect(rows.map((row) => row.organization)).toEqual(['DVD', 'SZS']);
      });
    });

    it('DVD, unchanged: a DVD member asks about their own DVD attendance', async () => {
      await isolated(async () => {
        expect(await request('dvdFirefighter', people.dvdFirefighter.dvdInterval)).toBe('OK');
      });
    });

    it('nobody asks about somebody else\'s attendance, in either service', async () => {
      await isolated(async () => {
        expect(await request('szsFirefighter', people.szsOther.szsInterval)).toBe('RLS');
        expect(await request('dvdFirefighter', people.dvdOther.dvdInterval)).toBe('RLS');
        expect(await request('dual', people.dvdFirefighter.dvdInterval)).toBe('RLS');
        // Commanders decide corrections; they do not file them for others.
        expect(await request('szsCommander', people.szsFirefighter.szsInterval)).toBe('RLS');
        expect(await request('dvdCommander', people.dvdFirefighter.dvdInterval)).toBe('RLS');
      });
    });

    it('a record or role in one service never asks about attendance in the other', async () => {
      await isolated(async () => {
        expect(await request('dvdFirefighter', people.szsFirefighter.szsInterval)).toBe('RLS');
        expect(await request('szsFirefighter', people.dvdFirefighter.dvdInterval)).toBe('RLS');
        // Their SZS membership withdrawn, their DVD one active.
        expect(await request('dualSzsWithdrawn', people.dualSzsWithdrawn.szsInterval)).toBe('RLS');
        expect(await request('dualSzsWithdrawn', people.dualSzsWithdrawn.dvdInterval)).toBe('OK');
      });
    });

    it('the owner without a member record, a suspended member and a citizen are refused', async () => {
      await isolated(async () => {
        for (const interval of [people.dvdFirefighter.dvdInterval, people.szsFirefighter.szsInterval]) {
          expect(await request('owner', interval)).toBe('RLS');
          expect(await request('citizen', interval)).toBe('RLS');
        }
        expect(await request('szsSuspended', people.szsSuspended.szsInterval)).toBe('RLS');
        expect(await request('dvdSuspended', people.dvdSuspended.dvdInterval)).toBe('RLS');
      });
    });

    it('refuses a forged service, an unknown interval, and somebody else as the author', async () => {
      await isolated(async () => {
        expect(
          await act(
            people.szsFirefighter.user,
            `insert into public.attendance_correction_requests(interval_id, requested_by, message, organization_id)
             values ($1, auth.uid(), 'Molim ispravku', $2)`,
            [people.szsFirefighter.szsInterval, DVD],
          ),
        ).toBe('ORGANIZATION_MISMATCH');
        expect(await request('szsFirefighter', UNKNOWN)).toBe('RLS');
        expect(
          await act(
            people.szsFirefighter.user,
            `insert into public.attendance_correction_requests(interval_id, requested_by, message)
             values ($1, $2, 'Molim ispravku')`,
            [people.szsFirefighter.szsInterval, people.szsOther.user],
          ),
        ).toBe('RLS');
      });
    });

    it('refuses a request that arrives already decided, or dated by the requester', async () => {
      await isolated(async () => {
        // The DVD member is the one this CHANGES for: before P4d the policy let
        // them file exactly these. The SZS member is asserted alongside so the
        // rule is the same in both services.
        for (const [who, own] of [
          ['dvdFirefighter', people.dvdFirefighter.dvdInterval],
          ['szsFirefighter', people.szsFirefighter.szsInterval],
        ] as const) {
          for (const [column, value] of [
            ['resolved_by', `'${people.dvdCommander.user}'`],
            ['resolved_at', 'now()'],
            ['resolution_note', `'Odobreno'`],
            ['state', `'ACCEPTED'`],
            ['requested_at', `now() - interval '30 days'`],
          ] as const) {
            expect(
              await act(
                people[who].user,
                `insert into public.attendance_correction_requests(interval_id, requested_by, message, ${column})
                 values ($1, auth.uid(), 'Molim ispravku', ${value})`,
                [own],
              ),
              `${who} ${column}`,
            ).toBe('RLS');
          }
          // And the same request, as a client sends it, is accepted.
          expect(await request(who, own), who).toBe('OK');
        }
      });
    });
  });

  describe('what a request can be seen by', () => {
    it('its service\'s command and its author, and nobody in the other service', async () => {
      await isolated(async () => {
        expect(await request('szsFirefighter', people.szsFirefighter.szsInterval)).toBe('OK');
        expect(await request('dual', people.dual.szsInterval)).toBe('OK');
        expect(await request('dvdFirefighter', people.dvdFirefighter.dvdInterval)).toBe('OK');
        expect(await servicesSeen('szsCommander', 'attendance_correction_requests')).toBe('SZS:2');
        expect(await servicesSeen('dvdCommander', 'attendance_correction_requests')).toBe('DVD:1');
        expect(await servicesSeen('owner', 'attendance_correction_requests')).toBe('DVD:1,SZS:2');
        expect(await servicesSeen('szsFirefighter', 'attendance_correction_requests')).toBe('SZS:1');
        expect(await servicesSeen('dual', 'attendance_correction_requests')).toBe('SZS:1');
        expect(await servicesSeen('szsOther', 'attendance_correction_requests')).toBe('');
        expect(await servicesSeen('citizen', 'attendance_correction_requests')).toBe('');
      });
    });
  });

  describe('deciding corrections, and the other P4d tables', () => {
    it('only command in the interval\'s own service confirms, rejects, unconfirms or corrects it', async () => {
      await isolated(async () => {
        const szsOpen = people.szsFirefighter.szsInterval;
        const szsConfirmed = people.szsOther.szsInterval;
        const dvdCommander = people.dvdCommander.user;
        expect(await act(dvdCommander, 'select public.attendance_confirm($1, null)', [szsOpen])).toBe('ORGANIZATION_MISMATCH');
        expect(await act(dvdCommander, `select public.attendance_reject($1, 'Ne')`, [szsOpen])).toBe('ORGANIZATION_MISMATCH');
        expect(await act(dvdCommander, `select public.attendance_unconfirm($1, 'Ne')`, [szsConfirmed])).toBe('ORGANIZATION_MISMATCH');
        expect(
          await act(dvdCommander, `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Ne')`, [szsOpen]),
        ).toBe('ORGANIZATION_MISMATCH');

        const szsCommander = people.szsCommander.user;
        expect(
          await act(szsCommander, `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Ispravka')`, [szsOpen]),
        ).toBe('OK');
        expect(await act(szsCommander, 'select public.attendance_confirm($1, null)', [szsOpen])).toBe('OK');
        const { rows } = await db.query<{ correction: string; audit: string }>(
          `select (select string_agg(o.code, ',') from public.attendance_corrections c
                     join public.organizations o on o.id = c.organization_id where c.interval_id = $1) as correction,
                  (select string_agg(distinct o.code, ',') from public.operational_audit a
                     join public.organizations o on o.id = a.organization_id
                    where a.intervention_id = $2 and a.event_type like 'ATTENDANCE%') as audit`,
          [szsOpen, szsCallout],
        );
        expect(rows[0]).toEqual({ correction: 'SZS', audit: 'SZS' });
      });
    });

    it('confirming a batch skips whatever belongs to the other service', async () => {
      await isolated(async () => {
        const rows = await rowsAs<{ interval_id: string; outcome: string }>(
          'dvdCommander',
          'select interval_id::text, outcome from public.attendance_confirm_many($1, null)',
          [[people.dvdFirefighter.dvdInterval, people.szsFirefighter.szsInterval]],
        );
        const outcome = Object.fromEntries(rows.map((row) => [row.interval_id, row.outcome]));
        expect(outcome[people.dvdFirefighter.dvdInterval!]).toBe('CONFIRMED');
        expect(outcome[people.szsFirefighter.szsInterval!]).toBe('ORGANIZATION_MISMATCH');
        const { rows: szs } = await db.query<{ verified: boolean }>(
          'select verified from public.attendance_intervals where id = $1',
          [people.szsFirefighter.szsInterval],
        );
        expect(szs[0]!.verified, 'the SZS interval is untouched').toBe(false);
      });
    });

    it('command of one service reads none of the other\'s attendance, corrections or movements', async () => {
      await isolated(async () => {
        expect(
          await act(people.szsCommander.user, `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Ispravka')`, [
            people.szsFirefighter.szsInterval,
          ]),
        ).toBe('OK');
        expect(
          await act(people.dvdCommander.user, `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Ispravka')`, [
            people.dvdFirefighter.dvdInterval,
          ]),
        ).toBe('OK');
        for (const table of ['attendance_intervals', 'attendance_corrections', 'vehicle_movements']) {
          const dvd = await servicesSeen('dvdCommander', table);
          const szs = await servicesSeen('szsCommander', table);
          expect(dvd, `${table} as DVD command`).toMatch(/^DVD:\d+$/);
          expect(szs, `${table} as SZS command`).toMatch(/^SZS:\d+$/);
        }
        expect(await servicesSeen('owner', 'attendance_intervals')).toMatch(/^DVD:\d+,SZS:\d+$/);
      });
    });

    it('attendance_totals() counts each service\'s people for its own command, and one record once', async () => {
      await isolated(async () => {
        const totals = (who: Label) =>
          rowsAs<{ member_id: string; organization: string; closed: number }>(
            who,
            `select t.member_id::text, o.code as organization,
                    (t.confirmed_intervals + t.unverified_intervals)::int as closed
               from public.attendance_totals('-infinity', 'infinity') t
               join public.members m on m.id = t.member_id
               join public.organizations o on o.id = m.organization_id
              order by 2, 1`,
          );
        const dvd = await totals('dvdCommander');
        const szs = await totals('szsCommander');
        expect(new Set(dvd.map((row) => row.organization))).toEqual(new Set(['DVD']));
        expect(new Set(szs.map((row) => row.organization))).toEqual(new Set(['SZS']));
        // Somebody serving in both is two people to the totals, one per
        // service, each with that service's attendance only - never one person
        // credited twice.
        expect(dvd.filter((row) => row.member_id === people.dual.dvd)).toEqual([
          { member_id: people.dual.dvd, organization: 'DVD', closed: 1 },
        ]);
        expect(szs.filter((row) => row.member_id === people.dual.szs)).toEqual([
          { member_id: people.dual.szs, organization: 'SZS', closed: 1 },
        ]);
        const owner = await totals('owner');
        expect(owner.length).toBe(dvd.length + szs.length);
      });
    });
  });

  describe('what a row is about is settled when it is written', () => {
    it('credits every interval to the service whose call-out it was, and no other', async () => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.attendance_intervals a
           join public.interventions i on i.id = a.intervention_id
           join public.members m on m.id = a.member_id
          where a.credited_organization_id is distinct from a.organization_id
             or a.organization_id is distinct from i.organization_id
             or m.organization_id is distinct from a.organization_id`,
      );
      expect(rows[0]!.n).toBe(0);
    });

    it('refuses moving an interval onto another call-out, member or credit', async () => {
      await isolated(async () => {
        const interval = people.dvdFirefighter.dvdInterval;
        expect(
          await asOwnerRole(`update public.attendance_intervals set intervention_id = $2, organization_id = $3 where id = $1`, [
            interval,
            szsCallout,
            SZS,
          ]),
        ).toBe('ATTENDANCE_IDENTITY_FIXED');
        expect(await asOwnerRole(`update public.attendance_intervals set member_id = $2 where id = $1`, [interval, people.dvdCommander.dvd])).toBe(
          'ATTENDANCE_IDENTITY_FIXED',
        );
        expect(await asOwnerRole(`update public.attendance_intervals set credited_organization_id = $2 where id = $1`, [interval, SZS])).toBe(
          'ATTENDANCE_IDENTITY_FIXED',
        );
      });
    });

    it('still lets the lifecycle move the times, the confirmation and the vehicle', async () => {
      await isolated(async () => {
        const interval = people.dvdFirefighter.dvdInterval;
        expect(await asOwnerRole(`update public.attendance_intervals set started_at = started_at - interval '1 minute' where id = $1`, [interval])).toBe('OK');
        expect(await asOwnerRole(`update public.attendance_intervals set vehicle_id = $2 where id = $1`, [interval, dvdVehicle])).toBe('OK');
        // A vehicle being retired still detaches itself (ON DELETE SET NULL).
        expect(await asOwnerRole(`delete from public.vehicle_movements where vehicle_id = $1`, [dvdVehicle])).toBe('OK');
        expect(await asOwnerRole(`delete from public.vehicles where id = $1`, [dvdVehicle])).toBe('OK');
      });
    });

    it('keeps the correction history append-only', async () => {
      await isolated(async () => {
        expect(
          await act(people.szsCommander.user, `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Ispravka')`, [
            people.szsFirefighter.szsInterval,
          ]),
        ).toBe('OK');
        const { rows } = await db.query<{ id: string }>(`select id::text from public.attendance_corrections where interval_id = $1`, [
          people.szsFirefighter.szsInterval,
        ]);
        const correction = rows[0]!.id;
        expect(
          await asOwnerRole(`update public.attendance_corrections set interval_id = $2, organization_id = $3 where id = $1`, [
            correction,
            people.dvdFirefighter.dvdInterval,
            DVD,
          ]),
        ).toBe('CORRECTION_HISTORY_APPEND_ONLY');
        expect(await asOwnerRole(`update public.attendance_corrections set reason = 'Prepravljeno' where id = $1`, [correction])).toBe(
          'CORRECTION_HISTORY_APPEND_ONLY',
        );
        expect(await asOwnerRole(`delete from public.attendance_corrections where id = $1`, [correction])).toBe('CORRECTION_HISTORY_APPEND_ONLY');
      });
    });

    it('fixes who asked, about what and when - and leaves the decision to be recorded', async () => {
      await isolated(async () => {
        expect(await request('szsFirefighter', people.szsFirefighter.szsInterval)).toBe('OK');
        const { rows } = await db.query<{ id: string }>(`select id::text from public.attendance_correction_requests where interval_id = $1`, [
          people.szsFirefighter.szsInterval,
        ]);
        const id = rows[0]!.id;
        for (const [change, params] of [
          ['interval_id = $2, organization_id = $3', [people.dvdFirefighter.dvdInterval, DVD]],
          ['requested_by = $2', [people.szsOther.user]],
          [`requested_at = now() - interval '1 day'`, []],
          [`message = 'Nesto drugo'`, []],
        ] as const) {
          expect(await asOwnerRole(`update public.attendance_correction_requests set ${change} where id = $1`, [id, ...params]), change).toBe(
            'CORRECTION_REQUEST_IDENTITY_FIXED',
          );
        }
        // A decision is still something that can be recorded on it.
        expect(
          await asOwnerRole(
            `update public.attendance_correction_requests
                set state = 'ACCEPTED', resolved_by = $2, resolved_at = now(), resolution_note = 'Ispravljeno'
              where id = $1`,
            [id, people.szsCommander.user],
          ),
        ).toBe('OK');
      });
    });
  });

  describe('the change itself', () => {
    it('leaves no DVD-only question on any P4d table', async () => {
      const { rows } = await db.query<{ what: string }>(
        `select tablename || '.' || policyname as what from pg_policies
          where schemaname = 'public'
            and tablename in ('attendance_intervals', 'attendance_corrections', 'attendance_correction_requests', 'vehicle_movements')
            and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_dvd_(staff|command|admin|owner)\\(\\)|current_dvd_role\\(\\)|current_member_id\\(\\)'
         union all
         select p.proname from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.prosrc ~ '\\m(attendance_intervals|attendance_corrections|attendance_correction_requests|vehicle_movements)\\M'
            and p.prosrc ~ 'is_dvd_(staff|command|admin|owner)\\(\\)|current_dvd_role\\(\\)|current_member_id\\(\\)'`,
      );
      expect(rows).toEqual([]);
    });

    it('keeps the grants a client holds on the four tables exactly as they were', async () => {
      const { rows } = await db.query<{ grants: string }>(
        `select string_agg(c.relname || ':' || coalesce(array_to_string(c.relacl, ' '), ''), ' / ' order by c.relname) as grants
           from pg_class c
          where c.relnamespace = 'public'::regnamespace
            and c.relname in ('attendance_intervals', 'attendance_corrections', 'attendance_correction_requests', 'vehicle_movements')`,
      );
      expect(rows[0]!.grants).toBe(
        [
          'attendance_correction_requests:postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=ar/postgres',
          'attendance_corrections:postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=r/postgres',
          'attendance_intervals:postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=r/postgres',
          'vehicle_movements:postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=r/postgres',
        ].join(' / '),
      );
    });

    it('is a no-op to apply twice', async () => {
      // Each list ordered by its own text: inside an aggregate `order by 1` is
      // the constant 1, which left the order to the catalogue - and re-creating
      // a trigger moves it to the end once a later migration has added any.
      const shape = async () =>
        (await db.query<{ h: string }>(
          `select md5(coalesce((select string_agg(x, '|' order by x) from (
                                  select tablename || policyname || coalesce(qual, '') || coalesce(with_check, '') as x
                                    from pg_policies where schemaname = 'public') p), '')
                      || coalesce((select string_agg(x, '|' order by x) from (
                                    select tgname || pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal) t), '')
                      || coalesce((select string_agg(x, '|' order by x) from (
                                    select proname || md5(prosrc) as x from pg_proc
                                     where pronamespace = 'public'::regnamespace) f), '')) as h`,
        )).rows[0]!.h;
      const before = await shape();
      await isolated(async () => {
        await db.query(sql(ATTENDANCE));
        expect(await shape()).toBe(before);
      });
    });
  });
});
