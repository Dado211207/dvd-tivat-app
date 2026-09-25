/**
 * A published call-out, and the history written under it, stay in the database.
 *
 * The owner's rule (2026-09-25): a published intervention and its response
 * history must remain. It is closed or cancelled, never hard-deleted through
 * ordinary database operations. A draft nobody was ever sent may still go.
 *
 * Three history tables had no append-only rule of their own, measured on the
 * P4f tree before anything here was written:
 *
 *   member_availability_history      one row per change of a member's
 *                                    availability, by set_own_availability_in
 *   intervention_journey_history     one row per step of a member's journey to
 *                                    a call-out, by set_journey_progress
 *   intervention_response_revisions  every answer a member gave to a call-out,
 *                                    by submit_response - and it went with its
 *                                    answer (ON DELETE CASCADE)
 *
 * Each is written only by INSERT, from one `security definer` command. But the
 * service role held every privilege on all three, a superuser session could
 * rewrite them, a row could be moved onto another service's call-out or member
 * as long as its label moved with it, deleting an answer erased its revisions,
 * and a published call-out with nothing under it that RESTRICTs - no journey
 * yet, say - could simply be deleted, answers and all.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const RETENTION = 'supabase/migrations/202609250034_history_retention.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

const HISTORY = ['member_availability_history', 'intervention_journey_history', 'intervention_response_revisions'] as const;

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

type Label = 'owner' | 'dvdCommander' | 'dvdFirefighter' | 'dvdAvailableOnly' | 'szsCommander' | 'szsFirefighter';
interface Person {
  user: string;
  dvd?: string;
  szs?: string;
}
const people = {} as Record<Label, Person>;

/** Call-outs, by what happened to them. */
const callouts = {
  /** Published to one DVD firefighter, who answered twice and set out. */
  dvdAnswered: '',
  /** The same in SZS. */
  szsAnswered: '',
  /** Published, and nobody has answered: nothing under it RESTRICTs. */
  dvdSilent: '',
  /** Published, then closed. */
  dvdClosed: '',
  /** Published, then cancelled. */
  szsCancelled: '',
  /** A draft, never published. */
  dvdDraft: '',
  /** A draft discarded before anybody was sent it: CANCELLED, never published. */
  szsDiscarded: '',
};

/** As postgres, inside a savepoint: 'OK' or the refusal code / message. */
async function raw(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint raw');
  try {
    await db.query(statement, params);
    await db.query('release savepoint raw');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint raw');
    return refusal(error);
  }
}

/** As the service role - which bypasses row-level security - inside a savepoint. */
async function asService(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint svc');
  try {
    // Built, not written out: the secret scan rightly flags a literal service-role claim.
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    await db.query('set local role service_role');
    await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint svc');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint svc');
    await db.query('reset role');
    return refusal(error);
  }
}

/** As a signed-in account of the application, with row-level security, inside a savepoint. */
async function asClient(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint client');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
    await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint client');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint client');
    await db.query('reset role');
    return refusal(error);
  }
}

/** A refusal as one word: DENIED, a foreign key's name, or the exception's code. */
function refusal(error: unknown): string {
  const message = (error as Error).message;
  if (/permission denied/.test(message)) return 'DENIED';
  const foreignKey = /violates foreign key constraint "([^"]+)"/.exec(message);
  if (foreignKey) return `FK ${foreignKey[1]}`;
  if (/cannot truncate a table referenced in a foreign key constraint/.test(message)) return 'TRUNCATE_NEEDS_CASCADE';
  return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
}

/** Rows of one statement as `userId`, inside the caller's open transaction. */
async function rowsAs<T extends object>(userId: string, statement: string, params: unknown[] = []): Promise<T[]> {
  await db.query('savepoint rows_as');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
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

async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

async function account(label: string, grantRole: string): Promise<string> {
  const created = await createAccount(db, `${label.toLowerCase()}.retention@example.invalid`);
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

/** A call-out through the real commands, published to one member of its own service. */
async function publishedTo(inService: 'DVD' | 'SZS', who: Label, key: string): Promise<string> {
  const commander = people[inService === 'DVD' ? 'dvdCommander' : 'szsCommander'].user;
  const callout = await committed(
    commander,
    `select public.create_intervention_draft_in($1, 'POZAR', 'Poziv', 'Okupljanje.', 'Poligon', $2)`,
    [inService === 'DVD' ? DVD : SZS, key],
  );
  await committed(commander, 'select public.publish_intervention($1, $2)', [
    callout,
    [inService === 'DVD' ? people[who].dvd : people[who].szs],
  ]);
  return callout;
}

/** One history row, of one service. */
async function rowOf(table: (typeof HISTORY)[number], organization: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id::text from public.${table} where organization_id = $1 order by id limit 1`,
    [organization],
  );
  if (!rows.length) throw new Error(`no ${table} row in ${organization} - the fixture did not write it`);
  return rows[0]!.id;
}

/** How many rows each history table holds, per service - the thing that must never shrink. */
async function historyCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of HISTORY) {
    const { rows } = await db.query<{ organization_id: string; n: number }>(
      `select organization_id::text, count(*)::int as n from public.${table} group by 1 order by 1`,
    );
    for (const row of rows) out[`${table}|${row.organization_id === DVD ? 'DVD' : 'SZS'}`] = row.n;
  }
  return out;
}

/** An answer's id, by call-out. */
async function answerOn(callout: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`select id::text from public.intervention_responses where intervention_id = $1`, [callout]);
  return rows[0]!.id;
}

type Statement = [sql: string, params: unknown[]];
type PerTable = Record<(typeof HISTORY)[number], Statement>;

/**
 * A row nobody wrote, for each history table: either consistent with its
 * parent's service - which P2's rule accepts - or claiming the other service.
 */
async function forgeries(label: 'consistent' | 'contradicting'): Promise<PerTable> {
  const claim = (service: string) => (label === 'consistent' ? null : service === DVD ? SZS : DVD);
  return {
    // An SZS member's availability change nobody made.
    member_availability_history: [
      `insert into public.member_availability_history(member_id, previous_available, next_available, note, changed_by, organization_id)
       values ($1, true, false, 'Izmisljeno', $2, $3)`,
      [people.szsFirefighter.szs, people.szsFirefighter.user, claim(SZS)],
    ],
    // A DVD member arriving at an SZS call-out they were never sent: the label
    // follows the call-out, so for P2 this is consistent.
    intervention_journey_history: [
      `insert into public.intervention_journey_history(intervention_id, member_id, previous_progress, next_progress, changed_by, organization_id)
       values ($1, $2, 'KRECEM', 'NA_LICU_MJESTA', $3, $4)`,
      [callouts.szsAnswered, people.dvdFirefighter.dvd, people.dvdFirefighter.user, claim(SZS)],
    ],
    // An answer the SZS member never gave.
    intervention_response_revisions: [
      `insert into public.intervention_response_revisions(response_id, revision, answer, eta_minutes, direct_to_location, organization_id)
       values ($1, 99, 'DOLAZIM', null, false, $2)`,
      [await answerOn(callouts.szsAnswered), claim(SZS)],
    ],
  };
}

/** One DVD row of each table relabelled SZS, and nothing else changed. */
async function relabels(): Promise<PerTable> {
  const relabel = async (table: (typeof HISTORY)[number]): Promise<Statement> => [
    `update public.${table} set organization_id = $2 where id = $1`,
    [await rowOf(table, DVD), SZS],
  ];
  return {
    member_availability_history: await relabel('member_availability_history'),
    intervention_journey_history: await relabel('intervention_journey_history'),
    intervention_response_revisions: await relabel('intervention_response_revisions'),
  };
}

/** One DVD row of each table moved onto an SZS parent, its label moved with it. */
async function moves(): Promise<PerTable> {
  // The DVD answer's second revision: the SZS answer has only a first, so the
  // move breaks no uniqueness of its own.
  const { rows } = await db.query<{ id: string }>(
    `select id::text from public.intervention_response_revisions where response_id = $1 and revision = 2`,
    [await answerOn(callouts.dvdAnswered)],
  );
  return {
    member_availability_history: [
      `update public.member_availability_history set member_id = $2, organization_id = $3 where id = $1`,
      [await rowOf('member_availability_history', DVD), people.szsFirefighter.szs, SZS],
    ],
    intervention_journey_history: [
      `update public.intervention_journey_history set intervention_id = $2, member_id = $3, organization_id = $4 where id = $1`,
      [await rowOf('intervention_journey_history', DVD), callouts.szsAnswered, people.szsFirefighter.szs, SZS],
    ],
    intervention_response_revisions: [
      `update public.intervention_response_revisions set response_id = $2, organization_id = $3 where id = $1`,
      [rows[0]!.id, await answerOn(callouts.szsAnswered), SZS],
    ],
  };
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
  // Everything before the retention rule. Until the migration exists this is
  // every migration there is, and the second half of this file fails - which
  // is the point.
  const index = MIGRATIONS.indexOf(RETENTION);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  // The installation owner holds no membership and no member record.
  people.owner = { user: await account('Vlasnik', 'OWNER') };
  for (const [label, role] of [['dvdCommander', 'COMMANDER'], ['dvdFirefighter', 'FIREFIGHTER'], ['dvdAvailableOnly', 'FIREFIGHTER']] as const) {
    const user = await account(label, role);
    people[label] = { user, dvd: await memberIn(DVD, `${label} Clan`, user) };
  }
  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership.
  for (const [label, role] of [['szsCommander', 'COMMANDER'], ['szsFirefighter', 'FIREFIGHTER']] as const) {
    const user = await account(label, 'CITIZEN');
    await membership(user, SZS, role);
    people[label] = { user, szs: await memberIn(SZS, `${label} Clan`, user) };
  }

  // Availability history, through its command, in each service. The third
  // member has nothing but this: no call-out names them.
  await committed(people.dvdFirefighter.user, `select public.set_own_availability(true, 'Dostupan')`);
  await committed(people.dvdAvailableOnly.user, `select public.set_own_availability(true, 'Samo dostupnost')`);
  await committed(people.szsFirefighter.user, `select public.set_own_availability_in($1, true, 'Dostupan SZS')`, [SZS]);

  // Answered call-outs: two answers and two journey steps in DVD, one of each in SZS.
  callouts.dvdAnswered = await publishedTo('DVD', 'dvdFirefighter', 'retention-dvd-answered');
  await committed(people.dvdFirefighter.user, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.dvdAnswered]);
  await committed(people.dvdFirefighter.user, `select public.submit_response($1, 'NE_MOGU', null, false)`, [callouts.dvdAnswered]);
  await committed(people.dvdFirefighter.user, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.dvdAnswered]);
  await committed(people.dvdFirefighter.user, `select public.set_journey_progress($1, 'ODUSTAJEM')`, [callouts.dvdAnswered]);
  callouts.szsAnswered = await publishedTo('SZS', 'szsFirefighter', 'retention-szs-answered');
  await committed(people.szsFirefighter.user, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.szsAnswered]);
  await committed(people.szsFirefighter.user, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.szsAnswered]);

  // Published, with nothing under it that any foreign key would keep.
  callouts.dvdSilent = await publishedTo('DVD', 'dvdFirefighter', 'retention-dvd-silent');
  callouts.dvdClosed = await publishedTo('DVD', 'dvdFirefighter', 'retention-dvd-closed');
  await committed(people.dvdCommander.user, `select public.close_intervention($1, 'CLOSED', 'Zavrseno')`, [callouts.dvdClosed]);
  callouts.szsCancelled = await publishedTo('SZS', 'szsFirefighter', 'retention-szs-cancelled');
  await committed(people.szsCommander.user, `select public.close_intervention($1, 'CANCELLED', 'Otkazano')`, [callouts.szsCancelled]);

  // Never published.
  callouts.dvdDraft = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'Nacrt', 'Upute.', 'Mjesto', 'retention-dvd-draft')`,
  );
  callouts.szsDiscarded = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'POZAR', 'Odbaceni nacrt', 'Upute.', 'Mjesto', 'retention-szs-discarded')`,
    [SZS],
  );
  await committed(people.szsCommander.user, `select public.discard_intervention_draft($1, 'Nepotrebno')`, [callouts.szsDiscarded]);
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before 202609250034: history is kept by the absence of a writer, and a published call-out can be deleted', () => {
  it('writes the three histories through their commands, each under its own service', async () => {
    expect(await historyCounts()).toEqual({
      'member_availability_history|DVD': 2,
      'member_availability_history|SZS': 1,
      'intervention_journey_history|DVD': 2,
      'intervention_journey_history|SZS': 1,
      'intervention_response_revisions|DVD': 2,
      'intervention_response_revisions|SZS': 1,
    });
  });

  it('lets a superuser session and the service role rewrite, delete, truncate and forge them', async () => {
    await isolated(async () => {
      // Rows nobody wrote. Only a label contradicting the parent stops the
      // service role, and on journey history a DVD member can be recorded
      // arriving at an SZS call-out, because the label follows the call-out.
      const consistent = await forgeries('consistent');
      const contradicting = await forgeries('contradicting');
      for (const table of HISTORY) {
        expect(await asService(...consistent[table]), `forge ${table}`).toBe('OK');
        expect(await asService(...contradicting[table]), `mislabel ${table}`).toBe('ORGANIZATION_MISMATCH');
      }
      expect(await raw(`update public.member_availability_history set note = 'Prepravljeno' where id = $1`, [await rowOf('member_availability_history', DVD)])).toBe('OK');
      expect(await asService(`update public.intervention_journey_history set changed_at = changed_at - interval '1 hour' where id = $1`, [await rowOf('intervention_journey_history', SZS)])).toBe('OK');
      expect(await asService(`update public.intervention_response_revisions set answer = 'DOLAZIM' where id = $1`, [await rowOf('intervention_response_revisions', DVD)])).toBe('OK');
      expect(await asService(`delete from public.intervention_response_revisions where id = $1`, [await rowOf('intervention_response_revisions', SZS)])).toBe('OK');
      for (const table of HISTORY) expect(await asService(`truncate public.${table}`), table).toBe('OK');
    });
  });

  it('lets a row move to another service\'s call-out, member or answer, when its label moves with it', async () => {
    await isolated(async () => {
      // P2's rule checks that the label matches the parent, not that the row
      // stays where it was written.
      const moved = await moves();
      for (const table of HISTORY) expect(await raw(...moved[table]), table).toBe('OK');
    });
  });

  it('lets deleting an answer erase its revisions, and a published call-out be deleted', async () => {
    await isolated(async () => {
      const answer = await answerOn(callouts.dvdAnswered);
      expect(await raw(`delete from public.intervention_responses where id = $1`, [answer])).toBe('OK');
      const { rows } = await db.query(`select 1 from public.intervention_response_revisions where response_id = $1`, [answer]);
      expect(rows, 'both revisions went with it').toHaveLength(0);
      // Nothing under it RESTRICTs: gone, with its recipient list and its alerts.
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdSilent])).toBe('OK');
      expect(await asService(`delete from public.interventions where id = $1`, [callouts.dvdClosed])).toBe('OK');
    });
  });
});

describe('after 202609250034: history is written once, and a published call-out is never deleted', () => {
  beforeAll(async () => {
    if (MIGRATIONS.includes(RETENTION)) await db.query(sql(RETENTION));
  }, 60_000);

  // --- the three histories --------------------------------------------------

  it('refuses rewriting, deleting or truncating any of them, to a client and even in a superuser session', async () => {
    await isolated(async () => {
      for (const [table, rewrite] of [
        ['member_availability_history', `set note = 'Prepravljeno'`],
        ['intervention_journey_history', `set changed_at = changed_at - interval '1 hour'`],
        ['intervention_response_revisions', `set answer = 'DOLAZIM'`],
      ] as const) {
        for (const [service, commander] of [[DVD, people.dvdCommander.user], [SZS, people.szsCommander.user]] as const) {
          const id = await rowOf(table, service);
          expect(await raw(`update public.${table} ${rewrite} where id = $1`, [id]), `update ${table}`).toBe('AUDIT_APPEND_ONLY');
          expect(await raw(`delete from public.${table} where id = $1`, [id]), `delete ${table}`).toBe('AUDIT_APPEND_ONLY');
          // A client never held more than SELECT; still so.
          expect(await asClient(commander, `update public.${table} ${rewrite} where id = $1`, [id]), `client update ${table}`).toBe('DENIED');
          expect(await asClient(commander, `delete from public.${table} where id = $1`, [id]), `client delete ${table}`).toBe('DENIED');
          expect(await asClient(commander, `truncate public.${table}`), `client truncate ${table}`).toBe('DENIED');
        }
        expect(await raw(`truncate public.${table}`), `truncate ${table}`).toBe('AUDIT_APPEND_ONLY');
      }
    });
  });

  it('keeps the organisation rule exactly as strict on all three: a relabel or a contradicting row is refused by it, a row moved with its label by the new rule', async () => {
    await isolated(async () => {
      // P2's trigger still answers a contradicting label first, on update and on insert.
      const relabelled = await relabels();
      const contradicting = await forgeries('contradicting');
      const moved = await moves();
      for (const table of HISTORY) {
        expect(await raw(...relabelled[table]), `relabel ${table}`).toBe('ORGANIZATION_MISMATCH');
        expect(await raw(...contradicting[table]), `mislabelled insert ${table}`).toBe('ORGANIZATION_MISMATCH');
        // Consistent for P2, refused now because it is a rewrite.
        expect(await raw(...moved[table]), `move ${table}`).toBe('AUDIT_APPEND_ONLY');
      }
    });
  });

  it('withdraws every write from the service role, forged history included, and keeps its reads', async () => {
    await isolated(async () => {
      const consistent = await forgeries('consistent');
      const contradicting = await forgeries('contradicting');
      for (const table of HISTORY) {
        // A row nobody wrote, with its parent's service or claiming the other.
        expect(await asService(...consistent[table]), `forge ${table}`).toBe('DENIED');
        expect(await asService(...contradicting[table]), `mislabel ${table}`).toBe('DENIED');
        expect(await asService(`update public.${table} set organization_id = organization_id`), `update ${table}`).toBe('DENIED');
        expect(await asService(`delete from public.${table}`), `delete ${table}`).toBe('DENIED');
        expect(await asService(`truncate public.${table}`), `truncate ${table}`).toBe('DENIED');
        expect(await asService(`select count(*) from public.${table}`), `read ${table}`).toBe('OK');
      }
    });
  });

  it('still writes all three through their commands, under the right service, attributed to whoever acted', async () => {
    await isolated(async () => {
      const before = await historyCounts();
      await rowsAs(people.dvdFirefighter.user, `select public.set_own_availability(false, 'Na poslu')`);
      await rowsAs(people.szsFirefighter.user, `select public.set_own_availability_in($1, false, 'Na poslu')`, [SZS]);
      await rowsAs(people.dvdFirefighter.user, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.dvdAnswered]);
      await rowsAs(people.szsFirefighter.user, `select public.set_journey_progress($1, 'U_PUTU')`, [callouts.szsAnswered]);
      await rowsAs(people.dvdFirefighter.user, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.dvdAnswered]);
      await rowsAs(people.szsFirefighter.user, `select public.submit_response($1, 'NE_MOGU', null, false)`, [callouts.szsAnswered]);
      const after = await historyCounts();
      expect(Object.fromEntries(Object.entries(after).map(([key, n]) => [key, n - (before[key] ?? 0)]))).toEqual(
        Object.fromEntries(Object.keys(before).map((key) => [key, 1])),
      );
      // Each new row names whoever acted, in the service it belongs to.
      const { rows } = await db.query<{ changed_by: string; organization_id: string }>(
        `select changed_by::text, organization_id::text from public.intervention_journey_history
          where intervention_id = $1 order by changed_at desc, id limit 1`,
        [callouts.szsAnswered],
      );
      expect(rows[0]).toEqual({ changed_by: people.szsFirefighter.user, organization_id: SZS });
      const { rows: availability } = await db.query<{ changed_by: string; organization_id: string; next_available: boolean }>(
        `select changed_by::text, organization_id::text, next_available from public.member_availability_history
          where member_id = $1 order by changed_at desc, id limit 1`,
        [people.szsFirefighter.szs],
      );
      expect(availability[0]).toEqual({ changed_by: people.szsFirefighter.user, organization_id: SZS, next_available: false });
      const { rows: revision } = await db.query<{ answer: string; revision: number; organization_id: string }>(
        `select answer, revision, organization_id::text from public.intervention_response_revisions
          where response_id = $1 order by revision desc limit 1`,
        [await answerOn(callouts.szsAnswered)],
      );
      expect(revision[0]).toEqual({ answer: 'NE_MOGU', revision: 2, organization_id: SZS });
      // The answer itself is the current answer, not history: it still changes.
      const { rows: answer } = await db.query<{ answer: string; revision: number }>(
        `select answer, revision from public.intervention_responses where intervention_id = $1`,
        [callouts.dvdAnswered],
      );
      expect(answer[0]).toEqual({ answer: 'DOLAZIM', revision: 3 });
    });
  });

  // --- what history hangs from ----------------------------------------------

  it('refuses deleting an answer that has revisions, whoever asks, and keeps every revision', async () => {
    await isolated(async () => {
      const before = await historyCounts();
      const answer = await answerOn(callouts.dvdAnswered);
      expect(await raw(`delete from public.intervention_responses where id = $1`, [answer])).toBe(
        'FK intervention_response_revisions_response_id_fkey',
      );
      expect(await asService(`delete from public.intervention_responses where id = $1`, [answer])).toBe(
        'FK intervention_response_revisions_response_id_fkey',
      );
      expect(await raw(`truncate public.intervention_responses`)).toBe('TRUNCATE_NEEDS_CASCADE');
      expect(await raw(`truncate public.intervention_responses cascade`)).toBe('AUDIT_APPEND_ONLY');
      expect(await historyCounts()).toEqual(before);
    });
  });

  it('refuses hard-deleting any call-out that was ever published - answered, silent, closed or cancelled', async () => {
    await isolated(async () => {
      for (const name of ['dvdAnswered', 'szsAnswered', 'dvdSilent', 'dvdClosed', 'szsCancelled'] as const) {
        expect(await raw(`delete from public.interventions where id = $1`, [callouts[name]]), name).toBe('PUBLISHED_INTERVENTION_RETAINED');
        expect(await asService(`delete from public.interventions where id = $1`, [callouts[name]]), `${name} as the service role`).toBe(
          'PUBLISHED_INTERVENTION_RETAINED',
        );
      }
      // Not the table either. Without CASCADE PostgreSQL refuses before any
      // trigger runs, because other tables reference it; with CASCADE the rule
      // on the table itself answers first.
      expect(await raw(`truncate public.interventions`)).toBe('TRUNCATE_NEEDS_CASCADE');
      expect(await raw(`truncate public.interventions cascade`)).toBe('PUBLISHED_INTERVENTION_RETAINED');
      const { rows } = await db.query(`select 1 from public.interventions where id = any($1::uuid[])`, [
        [callouts.dvdAnswered, callouts.szsAnswered, callouts.dvdSilent, callouts.dvdClosed, callouts.szsCancelled],
      ]);
      expect(rows).toHaveLength(5);
    });
  });

  it('knows a call-out was published without its publisher, and the service role cannot talk it back into a draft', async () => {
    await isolated(async () => {
      // 202609150008's publish_intervention never recorded the publisher; two of
      // production's five call-outs were published by it.
      expect(await raw(`update public.interventions set published_by = null where id = any($1::uuid[])`, [[callouts.dvdSilent, callouts.szsCancelled]])).toBe('OK');
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdSilent])).toBe('PUBLISHED_INTERVENTION_RETAINED');
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.szsCancelled])).toBe('PUBLISHED_INTERVENTION_RETAINED');

      // Everything the service role can undo, it undoes: the status, the
      // publisher, the recipient list. What makes the row look like a
      // discarded draft is all there - except the audit's record of the
      // publication, which it cannot touch, and which alone keeps the call-out.
      expect(
        await asService(
          `update public.interventions
              set status = 'CANCELLED', closed_at = now(), close_reason = 'Uklanjanje', published_by = null
            where id = $1`,
          [callouts.dvdSilent],
        ),
      ).toBe('OK');
      expect(await asService(`delete from public.intervention_recipients where intervention_id = $1`, [callouts.dvdSilent])).toBe('OK');
      expect(await asService(`delete from public.operational_audit where intervention_id = $1`, [callouts.dvdSilent])).toBe('DENIED');
      expect(await asService(`delete from public.interventions where id = $1`, [callouts.dvdSilent])).toBe('PUBLISHED_INTERVENTION_RETAINED');
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdSilent])).toBe('PUBLISHED_INTERVENTION_RETAINED');
    });
  });

  it('keeps a call-out on any one trace of its publication, each tested alone', async () => {
    await isolated(async () => {
      // Only a superuser with every trigger switched off can remove the audit's
      // record of a publication: the first step of a deliberate purge, never
      // something the application does. Each remaining trace must still hold.
      const withoutAuditRecord = async (callout: string) => {
        await db.query('set local session_replication_role = replica');
        await db.query(`delete from public.operational_audit where intervention_id = $1 and event_type = 'INTERVENTION_PUBLISHED'`, [callout]);
        await db.query('set local session_replication_role = origin');
      };
      const withoutRecipients = (callout: string) =>
        raw(`delete from public.intervention_recipients where intervention_id = $1`, [callout]);
      const cancelled = (callout: string, publisher: 'kept' | 'cleared') =>
        raw(
          `update public.interventions
              set status = 'CANCELLED', closed_at = coalesce(closed_at, now()), close_reason = coalesce(close_reason, 'Uklanjanje'),
                  published_by = case when $2 then published_by end
            where id = $1`,
          [callout, publisher === 'kept'],
        );

      // The recipient list alone: cancelled, no publisher, no audit record.
      expect(await cancelled(callouts.szsCancelled, 'cleared')).toBe('OK');
      await withoutAuditRecord(callouts.szsCancelled);
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.szsCancelled]), 'recipients').toBe('PUBLISHED_INTERVENTION_RETAINED');

      // The publisher alone: cancelled, no recipients, no audit record.
      expect(await cancelled(callouts.dvdSilent, 'kept')).toBe('OK');
      expect(await withoutRecipients(callouts.dvdSilent)).toBe('OK');
      await withoutAuditRecord(callouts.dvdSilent);
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdSilent]), 'publisher').toBe('PUBLISHED_INTERVENTION_RETAINED');

      // The status alone: closed, no publisher, no recipients, no audit record.
      expect(await raw(`update public.interventions set published_by = null where id = $1`, [callouts.dvdClosed])).toBe('OK');
      expect(await withoutRecipients(callouts.dvdClosed)).toBe('OK');
      await withoutAuditRecord(callouts.dvdClosed);
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdClosed]), 'status').toBe('PUBLISHED_INTERVENTION_RETAINED');
    });
  });

  it('still deletes a draft nobody was ever sent, and one discarded before it was', async () => {
    await isolated(async () => {
      const drafts = [callouts.dvdDraft, callouts.szsDiscarded];
      const { rows: before } = await db.query<{ id: string; event_type: string; organization_id: string }>(
        `select id::text, event_type, organization_id::text from public.operational_audit
          where intervention_id = any($1::uuid[]) order by id`,
        [drafts],
      );
      expect(before.map((row) => row.event_type).sort()).toEqual([
        'INTERVENTION_DRAFTED',
        'INTERVENTION_DRAFTED',
        'INTERVENTION_DRAFT_DISCARDED',
      ]);
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdDraft])).toBe('OK');
      expect(await asService(`delete from public.interventions where id = $1`, [callouts.szsDiscarded])).toBe('OK');
      const { rows } = await db.query(`select 1 from public.interventions where id = any($1::uuid[])`, [drafts]);
      expect(rows).toHaveLength(0);
      // Their audit rows stay, each detached by the foreign key's SET NULL
      // (P4f's one exception) and otherwise untouched. Now that no published
      // call-out can be deleted, this is the only way that exception is reached
      // through a call-out.
      const { rows: after } = await db.query<{ id: string; event_type: string; organization_id: string; intervention_id: string | null }>(
        `select id::text, event_type, organization_id::text, intervention_id::text from public.operational_audit
          where id = any($1::uuid[]) order by id`,
        [before.map((row) => row.id)],
      );
      expect(after).toEqual(before.map((row) => ({ ...row, intervention_id: null })));
    });
  });

  it('still refuses removing a member, or an account, that history names', async () => {
    await isolated(async () => {
      // The member named by availability history and nothing else of theirs is
      // referenced by a call-out.
      expect(await raw(`delete from public.member_availability where member_id = $1`, [people.dvdAvailableOnly.dvd])).toBe('OK');
      expect(await raw(`delete from public.members where id = $1`, [people.dvdAvailableOnly.dvd])).toBe('FK member_availability_history_member_id_fkey');
      expect(await raw(`delete from auth.users where id = $1`, [people.dvdAvailableOnly.user])).toMatch(/^FK /);
    });
  });

  // --- asked of the catalogue -------------------------------------------------

  it('makes all three append-only by rule, keeps P2\'s trigger on each, and no parent\'s deletion reaches them', async () => {
    const { rows } = await db.query<{ table: string; row_rule: boolean; truncate_rule: boolean; organisation_rule: boolean }>(
      `select c.relname::text as table,
              exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                        and pg_get_triggerdef(t.oid) ~ 'BEFORE (DELETE OR UPDATE|UPDATE OR DELETE)') as row_rule,
              exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                        and pg_get_triggerdef(t.oid) ~ 'BEFORE TRUNCATE') as truncate_rule,
              exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'enforce_organization') as organisation_rule
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relname = any($1)
        order by 1`,
      [[...HISTORY]],
    );
    expect(rows).toEqual([...HISTORY].sort().map((table) => ({ table, row_rule: true, truncate_rule: true, organisation_rule: true })));
    // Every parent, by name, and what deleting it does to the history: refused,
    // never cascaded or cleared. Only the answer's action is new here.
    const { rows: parents } = await db.query<{ key: string }>(
      `select conrelid::regclass::text || '.' || conname || ' -> ' || confrelid::regclass::text || ' ' ||
              case confdeltype when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' when 'c' then 'CASCADE'
                               when 'n' then 'SET NULL' else 'SET DEFAULT' end as key
         from pg_constraint where contype = 'f' and conrelid::regclass::text = any($1)`,
      [[...HISTORY]],
    );
    expect(parents.map((row) => row.key).sort()).toEqual([
      'intervention_journey_history.intervention_journey_history_changed_by_fkey -> auth.users RESTRICT',
      'intervention_journey_history.intervention_journey_history_intervention_id_fkey -> interventions RESTRICT',
      'intervention_journey_history.intervention_journey_history_member_id_fkey -> members RESTRICT',
      'intervention_journey_history.intervention_journey_history_organization_id_fkey -> organizations NO ACTION',
      'intervention_response_revisions.intervention_response_revisions_organization_id_fkey -> organizations NO ACTION',
      'intervention_response_revisions.intervention_response_revisions_response_id_fkey -> intervention_responses RESTRICT',
      'member_availability_history.member_availability_history_changed_by_fkey -> auth.users RESTRICT',
      'member_availability_history.member_availability_history_member_id_fkey -> members RESTRICT',
      'member_availability_history.member_availability_history_organization_id_fkey -> organizations NO ACTION',
    ]);
    const { rows: acl } = await db.query<{ table: string; acl: string }>(
      `select relname::text as table, array_to_string(relacl, ' ') as acl from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
      [[...HISTORY]],
    );
    // The service role keeps SELECT (and REFERENCES and TRIGGER, which write
    // nothing), as P4f left it on the audit tables; clients are unchanged.
    for (const row of acl) {
      expect(row.acl, row.table).toBe('postgres=arwdDxt/postgres service_role=rxt/postgres authenticated=r/postgres');
    }
  });

  it('guards every call-out against deletion, and no command deletes a call-out, an answer or any history', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_triggerdef(t.oid) as def from pg_trigger t
        where t.tgrelid = 'public.interventions'::regclass and not t.tgisinternal and t.tgname like 'retain%'
        order by 1`,
    );
    expect(rows.map((row) => row.def.replace(/^CREATE TRIGGER /, ''))).toEqual([
      'retain_published BEFORE DELETE ON public.interventions FOR EACH ROW EXECUTE FUNCTION refuse_published_intervention_delete()',
      'retain_published_truncate BEFORE TRUNCATE ON public.interventions FOR EACH STATEMENT EXECUTE FUNCTION refuse_published_intervention_delete()',
    ]);
    // A purge is a deliberate act outside the application, never a command.
    const { rows: purgers } = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.prosrc ~* 'delete\\s+from\\s+(public\\.)?(interventions|intervention_responses|member_availability_history|intervention_journey_history|intervention_response_revisions)\\M'
        order by 1`,
    );
    expect(purgers).toEqual([]);
    const { rows: callers } = await db.query<{ client: boolean }>(
      `select has_function_privilege('authenticated', 'public.refuse_published_intervention_delete()'::regprocedure, 'execute')
           or has_function_privilege('anon', 'public.refuse_published_intervention_delete()'::regprocedure, 'execute') as client`,
    );
    expect(callers[0]!.client).toBe(false);
  });

  it('is a no-op to apply twice', async () => {
    const shape = async () =>
      (await db.query<{ h: string }>(
        `select md5(coalesce((select string_agg(x, '|' order by x) from (
                                select tgname || pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal) t), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select proname || md5(prosrc) || coalesce(array_to_string(proacl, ' '), '') as x from pg_proc
                                   where pronamespace = 'public'::regnamespace) f), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select conname || pg_get_constraintdef(oid) as x from pg_constraint
                                   where connamespace = 'public'::regnamespace) c), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select relname || coalesce(array_to_string(relacl, ' '), '') as x from pg_class
                                   where relnamespace = 'public'::regnamespace and relkind = 'r') g), '')) as h`,
      )).rows[0]!.h;
    const before = await shape();
    await isolated(async () => {
      await db.query(sql(RETENTION));
      expect(await shape()).toBe(before);
    });
  });
});
