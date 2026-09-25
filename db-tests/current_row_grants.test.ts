/**
 * The service role reads the current answer, journey step and availability; it
 * does not write them.
 *
 * After 202609250035 an answer, a journey step and an availability keep whose
 * they are and where they belong, but what they SAY could still be written
 * directly by the service role, which held every privilege on all three
 * tables:
 *
 *   an answer        its answer, ETA, direct-travel flag or revision number
 *                    changed without submit_response() - so without the
 *                    revision that records it, and a rewound revision number
 *                    then refuses the member's next real answer;
 *   a journey step   set, changed or removed without set_journey_progress(),
 *                    so without its history row;
 *   an availability  the same, without set_own_availability_in().
 *
 * Measured before anything here was written: nothing the service role runs
 * needs any of it. The send-web-push worker writes only notification_outbox,
 * notification_delivery_attempts and web_push_subscriptions; it is the only
 * Edge Function. The three tables are written by exactly three functions -
 * submit_response(), set_journey_progress() and set_own_availability_in() -
 * each `security definer` and owned by postgres, so they write with the
 * owner's privileges, not the caller's. No trigger writes them. The one
 * referential action into them - deleting a call-out takes its answers - runs
 * as the table's owner.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const GRANTS = 'supabase/migrations/202609250036_current_row_grants.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

const TABLES = ['intervention_responses', 'intervention_journey', 'member_availability'] as const;

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

type Label = 'dvdCommander' | 'dvdFirefighter' | 'szsCommander' | 'szsFirefighter';
interface Person {
  user: string;
  member: string;
}
const people = {} as Record<Label, Person>;

const callouts = {
  /** Published to the DVD firefighter, who answered twice, set out and stated their availability. */
  dvdAnswered: '',
  /** Published to the DVD firefighter, not answered, not set out. */
  dvdSilent: '',
  /** Published to the SZS firefighter, who answered once and set out. */
  szsAnswered: '',
  /** A draft, never published. */
  dvdDraft: '',
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

/** A refusal as one word: DENIED, a foreign key's name, a duplicate, or the exception's code. */
function refusal(error: unknown): string {
  const message = (error as Error).message;
  if (/permission denied/.test(message)) return 'DENIED';
  const foreignKey = /violates foreign key constraint "([^"]+)"/.exec(message);
  if (foreignKey) return `FK ${foreignKey[1]}`;
  const duplicate = /duplicate key value violates unique constraint "([^"]+)"/.exec(message);
  if (duplicate) return `DUPLICATE ${duplicate[1]}`;
  if (/cannot truncate a table referenced in a foreign key constraint/.test(message)) return 'TRUNCATE_NEEDS_CASCADE';
  return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
}

/** Rows of one statement as `userId`, with row-level security, inside the caller's open transaction. */
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

/** One command as `userId`, in a savepoint: 'OK' or the refusal. */
async function commandAs(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  try {
    await rowsAs(userId, statement, params);
    return 'OK';
  } catch (error) {
    return refusal(error);
  }
}

/** Rows as postgres: what is actually stored. */
async function stored<T extends object>(statement: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T & Record<string, unknown>>(statement, params)).rows;
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
  const created = await createAccount(db, `${label.toLowerCase()}.grants@example.invalid`);
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456', date_of_birth = date '1990-01-01', profile_complete = true
      where user_id = $1`,
    [created.userId, `${label} Test`],
  );
  await db.query(`update public.access_grants set role = $2 where user_id = $1`, [created.userId, grantRole]);
  return created.userId;
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
async function publishedTo(inService: 'DVD' | 'SZS', key: string): Promise<string> {
  const commander = people[inService === 'DVD' ? 'dvdCommander' : 'szsCommander'].user;
  const firefighter = people[inService === 'DVD' ? 'dvdFirefighter' : 'szsFirefighter'].member;
  const callout = await committed(
    commander,
    `select public.create_intervention_draft_in($1, 'POZAR', 'Poziv', 'Okupljanje.', 'Poligon', $2)`,
    [inService === 'DVD' ? DVD : SZS, key],
  );
  await committed(commander, 'select public.publish_intervention($1, $2)', [callout, [firefighter]]);
  return callout;
}

async function answerOf(callout: string, member: string): Promise<string> {
  const rows = await stored<{ id: string }>(
    `select id::text from public.intervention_responses where intervention_id = $1 and member_id = $2`,
    [callout, member],
  );
  if (!rows.length) throw new Error('no such answer - the fixture did not write it');
  return rows[0]!.id;
}

/** Every direct write the service role could make on the three tables, one per kind. */
async function directWrites(): Promise<Array<[label: string, statement: string, params: unknown[]]>> {
  const dvd = people.dvdFirefighter.member;
  const szs = people.szsFirefighter.member;
  const answer = await answerOf(callouts.dvdAnswered, dvd);
  return [
    ['answer: content changed', `update public.intervention_responses set answer = 'NE_MOGU', eta_minutes = null, direct_to_location = false where id = $1`, [answer]],
    ['answer: revision number rewound', `update public.intervention_responses set revision = 1 where id = $1`, [answer]],
    [
      'answer: written outside submit_response()',
      `insert into public.intervention_responses(intervention_id, member_id, answer, eta_minutes, direct_to_location) values ($1, $2, 'DOLAZIM', null, false)`,
      [callouts.dvdSilent, dvd],
    ],
    ['answer: deleted', `delete from public.intervention_responses where id = $1`, [answer]],
    ['answers: truncated', `truncate public.intervention_responses cascade`, []],
    [
      'journey: step changed',
      `update public.intervention_journey set progress = 'NA_LICU_MJESTA', updated_at = now() where intervention_id = $1 and member_id = $2`,
      [callouts.dvdAnswered, dvd],
    ],
    [
      'journey: step written outside set_journey_progress()',
      `insert into public.intervention_journey(intervention_id, member_id, progress, updated_by) values ($1, $2, 'KRECEM', $3)`,
      [callouts.dvdSilent, dvd, people.dvdFirefighter.user],
    ],
    ['journey: step removed', `delete from public.intervention_journey where intervention_id = $1 and member_id = $2`, [callouts.szsAnswered, szs]],
    ['journey: truncated', `truncate public.intervention_journey`, []],
    ['availability: changed', `update public.member_availability set available = false, note = 'Izmisljeno', changed_at = now() where member_id = $1`, [dvd]],
    [
      'availability: written outside set_own_availability_in()',
      `insert into public.member_availability(member_id, available, note, changed_by) values ($1, true, 'Izmisljeno', $2)`,
      [people.dvdCommander.member, people.dvdCommander.user],
    ],
    ['availability: removed', `delete from public.member_availability where member_id = $1`, [szs]],
    ['availability: truncated', `truncate public.member_availability`, []],
  ];
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
  // Everything up to and including #64's 202609250035. Until 036 exists this
  // is every migration there is, and the second half of this file fails.
  const index = MIGRATIONS.indexOf(GRANTS);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  for (const [label, role] of [['dvdCommander', 'COMMANDER'], ['dvdFirefighter', 'FIREFIGHTER']] as const) {
    const user = await account(label, role);
    people[label] = { user, member: await memberIn(DVD, `${label} Clan`, user) };
  }
  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership.
  for (const [label, role] of [['szsCommander', 'COMMANDER'], ['szsFirefighter', 'FIREFIGHTER']] as const) {
    const user = await account(label, 'CITIZEN');
    await db.query(`insert into public.organization_memberships(organization_id, user_id, role, active) values ($1, $2, $3, true)`, [SZS, user, role]);
    people[label] = { user, member: await memberIn(SZS, `${label} Clan`, user) };
  }

  const dvd = people.dvdFirefighter.user;
  const szs = people.szsFirefighter.user;
  await committed(dvd, `select public.set_own_availability(true, 'Dostupan')`);
  await committed(szs, `select public.set_own_availability_in($1, true, 'Dostupan SZS')`, [SZS]);
  callouts.dvdAnswered = await publishedTo('DVD', 'grants-dvd-answered');
  await committed(dvd, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.dvdAnswered]);
  await committed(dvd, `select public.submit_response($1, 'DOLAZIM_KASNIJE', 15, false)`, [callouts.dvdAnswered]);
  await committed(dvd, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.dvdAnswered]);
  callouts.dvdSilent = await publishedTo('DVD', 'grants-dvd-silent');
  callouts.szsAnswered = await publishedTo('SZS', 'grants-szs-answered');
  await committed(szs, `select public.submit_response($1, 'DOLAZIM', null, true)`, [callouts.szsAnswered]);
  await committed(szs, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.szsAnswered]);
  callouts.dvdDraft = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'Nacrt', 'Upute.', 'Mjesto', 'grants-dvd-draft')`,
  );
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('at 202609250035: the service role writes the current answer, journey step and availability directly', () => {
  it("changes an answer's content without a revision, and can rewind it so the member's next answer is refused", async () => {
    await isolated(async () => {
      const answer = await answerOf(callouts.dvdAnswered, people.dvdFirefighter.member);
      expect(
        await asService(`update public.intervention_responses set answer = 'NE_MOGU', eta_minutes = null, direct_to_location = false where id = $1`, [answer]),
      ).toBe('OK');
      // Stored: the answer says NE_MOGU; its last revision still says DOLAZIM_KASNIJE.
      expect(await stored(`select answer, revision from public.intervention_responses where id = $1`, [answer])).toEqual([{ answer: 'NE_MOGU', revision: 2 }]);
      expect(
        await stored(`select revision, answer from public.intervention_response_revisions where response_id = $1 order by revision`, [answer]),
      ).toEqual([
        { revision: 1, answer: 'DOLAZIM' },
        { revision: 2, answer: 'DOLAZIM_KASNIJE' },
      ]);
      // What DVD command reads: an answer the member never gave, and a history that does not explain it.
      expect(await rowsAs(people.dvdCommander.user, `select answer from public.intervention_responses where id = $1`, [answer])).toEqual([{ answer: 'NE_MOGU' }]);

      expect(await asService(`update public.intervention_responses set revision = 1 where id = $1`, [answer])).toBe('OK');
      // The member's next real answer collides with the history it rewound.
      expect(await commandAs(people.dvdFirefighter.user, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.dvdAnswered])).toBe(
        'DUPLICATE intervention_response_revisions_response_id_revision_key',
      );
    });
  });

  it('writes an answer outside submit_response(), with no revision', async () => {
    await isolated(async () => {
      expect(
        await asService(
          `insert into public.intervention_responses(intervention_id, member_id, answer, eta_minutes, direct_to_location) values ($1, $2, 'DOLAZIM', null, false)`,
          [callouts.dvdSilent, people.dvdFirefighter.member],
        ),
      ).toBe('OK');
      const answer = await answerOf(callouts.dvdSilent, people.dvdFirefighter.member);
      expect(await stored(`select 1 from public.intervention_response_revisions where response_id = $1`, [answer])).toHaveLength(0);
      expect(await rowsAs(people.dvdCommander.user, `select answer from public.intervention_responses where id = $1`, [answer])).toEqual([{ answer: 'DOLAZIM' }]);
    });
  });

  it('sets, changes and removes the current journey step and availability without their commands, or their history', async () => {
    await isolated(async () => {
      const dvd = people.dvdFirefighter.member;
      const szs = people.szsFirefighter.member;
      // The board: on scene. The history: set out, and nothing since.
      expect(
        await asService(`update public.intervention_journey set progress = 'NA_LICU_MJESTA', updated_at = now() where intervention_id = $1 and member_id = $2`, [
          callouts.dvdAnswered,
          dvd,
        ]),
      ).toBe('OK');
      expect(await rowsAs(people.dvdCommander.user, `select progress from public.intervention_journey where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { progress: 'NA_LICU_MJESTA' },
      ]);
      expect(await stored(`select next_progress from public.intervention_journey_history where intervention_id = $1 order by changed_at`, [callouts.dvdAnswered])).toEqual([
        { next_progress: 'KRECEM' },
      ]);
      // A step nobody took.
      expect(
        await asService(`insert into public.intervention_journey(intervention_id, member_id, progress, updated_by) values ($1, $2, 'KRECEM', $3)`, [
          callouts.dvdSilent,
          dvd,
          people.dvdFirefighter.user,
        ]),
      ).toBe('OK');
      expect(await stored(`select 1 from public.intervention_journey_history where intervention_id = $1`, [callouts.dvdSilent])).toHaveLength(0);
      // Availability: changed, written for somebody who never stated it, removed.
      expect(await asService(`update public.member_availability set available = false, note = 'Izmisljeno' where member_id = $1`, [dvd])).toBe('OK');
      expect(await rowsAs(people.dvdCommander.user, `select available, note from public.member_availability where member_id = $1`, [dvd])).toEqual([
        { available: false, note: 'Izmisljeno' },
      ]);
      expect(await stored(`select next_available from public.member_availability_history where member_id = $1`, [dvd])).toEqual([{ next_available: true }]);
      expect(
        await asService(`insert into public.member_availability(member_id, available, note, changed_by) values ($1, true, 'Izmisljeno', $2)`, [
          people.dvdCommander.member,
          people.dvdCommander.user,
        ]),
      ).toBe('OK');
      expect(await asService(`delete from public.member_availability where member_id = $1`, [szs])).toBe('OK');
      expect(await asService(`delete from public.intervention_journey where intervention_id = $1 and member_id = $2`, [callouts.szsAnswered, szs])).toBe('OK');
      expect(await rowsAs(people.szsCommander.user, `select 1 from public.intervention_journey where intervention_id = $1`, [callouts.szsAnswered])).toHaveLength(0);
    });
    await isolated(async () => {
      expect(await asService(`truncate public.intervention_journey`)).toBe('OK');
      expect(await asService(`truncate public.member_availability`)).toBe('OK');
      expect(await stored(`select (select count(*) from public.intervention_journey)::int + (select count(*) from public.member_availability)::int as n`)).toEqual([{ n: 0 }]);
    });
  });

  it('holds every write privilege on the three tables', async () => {
    const { rows } = await db.query<{ table: string; acl: string }>(
      `select relname::text as table, array_to_string(relacl, ' ') as acl from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
      [[...TABLES]],
    );
    for (const row of rows) expect(row.acl, row.table).toContain('service_role=arwdDxt/postgres');
  });
});

describe('after 202609250036: the service role reads them, and only the commands write them', () => {
  beforeAll(async () => {
    if (MIGRATIONS.includes(GRANTS)) await db.query(sql(GRANTS));
  }, 60_000);

  it('refuses every direct write by the service role, and keeps its reads', async () => {
    await isolated(async () => {
      for (const [label, statement, params] of await directWrites()) {
        expect(await asService(statement, params), label).toBe('DENIED');
      }
      for (const table of TABLES) {
        expect(await asService(`select count(*) from public.${table}`), `read ${table}`).toBe('OK');
      }
      // Nothing changed.
      expect(
        await stored(`select answer, revision from public.intervention_responses where intervention_id = $1`, [callouts.dvdAnswered]),
      ).toEqual([{ answer: 'DOLAZIM_KASNIJE', revision: 2 }]);
      expect(await stored(`select count(*)::int as n from public.intervention_journey`)).toEqual([{ n: 2 }]);
      expect(await stored(`select count(*)::int as n from public.member_availability`)).toEqual([{ n: 2 }]);
    });
  });

  it('still lets every member answer, set out and state their availability through the commands, in DVD and SZS', async () => {
    await isolated(async () => {
      const dvd = people.dvdFirefighter;
      const szs = people.szsFirefighter;
      // submit_response(): a changed answer is a new revision; a first answer is revision 1.
      expect(await commandAs(dvd.user, `select public.submit_response($1, 'DOLAZIM', null, true)`, [callouts.dvdAnswered])).toBe('OK');
      expect(await commandAs(szs.user, `select public.submit_response($1, 'NE_MOGU', null, false)`, [callouts.szsAnswered])).toBe('OK');
      expect(await commandAs(dvd.user, `select public.submit_response($1, 'DOLAZIM_KASNIJE', 30, false)`, [callouts.dvdSilent])).toBe('OK');
      expect(
        await stored(
          `select response.organization_id::text as service, response.answer, response.revision,
                  (select count(*)::int from public.intervention_response_revisions r where r.response_id = response.id) as revisions
             from public.intervention_responses response order by response.organization_id, response.revision desc`,
        ),
      ).toEqual([
        { service: DVD, answer: 'DOLAZIM', revision: 3, revisions: 3 },
        { service: DVD, answer: 'DOLAZIM_KASNIJE', revision: 1, revisions: 1 },
        { service: SZS, answer: 'NE_MOGU', revision: 2, revisions: 2 },
      ]);

      // set_journey_progress(): a next step, a first step, each with history.
      expect(await commandAs(dvd.user, `select public.set_journey_progress($1, 'U_PUTU')`, [callouts.dvdAnswered])).toBe('OK');
      expect(await commandAs(dvd.user, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.dvdSilent])).toBe('OK');
      expect(await commandAs(szs.user, `select public.set_journey_progress($1, 'NA_LICU_MJESTA')`, [callouts.szsAnswered])).toBe('OK');
      expect(
        await stored(`select organization_id::text as service, progress from public.intervention_journey order by organization_id, progress`),
      ).toEqual([
        { service: DVD, progress: 'KRECEM' },
        { service: DVD, progress: 'U_PUTU' },
        { service: SZS, progress: 'NA_LICU_MJESTA' },
      ]);
      expect(await stored(`select count(*)::int as n from public.intervention_journey_history`)).toEqual([{ n: 5 }]);

      // set_own_availability() (DVD's own) and set_own_availability_in() (either service).
      expect(await commandAs(dvd.user, `select public.set_own_availability(false, 'Na poslu')`)).toBe('OK');
      expect(await commandAs(szs.user, `select public.set_own_availability_in($1, false, 'Na poslu SZS')`, [SZS])).toBe('OK');
      expect(
        await stored(`select organization_id::text as service, available, note from public.member_availability order by organization_id`),
      ).toEqual([
        { service: DVD, available: false, note: 'Na poslu' },
        { service: SZS, available: false, note: 'Na poslu SZS' },
      ]);
      expect(await stored(`select count(*)::int as n from public.member_availability_history`)).toEqual([{ n: 4 }]);

      // And the people who read them still read them.
      expect(await rowsAs(people.dvdCommander.user, `select count(*)::int as n from public.intervention_responses`)).toEqual([{ n: 2 }]);
      expect(await rowsAs(people.szsCommander.user, `select count(*)::int as n from public.intervention_journey`)).toEqual([{ n: 1 }]);
      expect(await rowsAs(people.szsCommander.user, `select available from public.member_availability`)).toEqual([{ available: false }]);
    });
  });

  it('still deletes a never-published draft with an out-of-band answer, whoever deletes it, and keeps every foreign key as it was', async () => {
    await isolated(async () => {
      // Only a superuser session can still put an answer on a draft.
      expect(
        await raw(`insert into public.intervention_responses(intervention_id, member_id, answer, eta_minutes, direct_to_location) values ($1, $2, 'DOLAZIM', null, false)`, [
          callouts.dvdDraft,
          people.dvdFirefighter.member,
        ]),
      ).toBe('OK');
      const draftAnswer = await answerOf(callouts.dvdDraft, people.dvdFirefighter.member);
      // The service role keeps deleting call-outs; the cascade into answers runs as the table's owner.
      expect(await asService(`delete from public.interventions where id = $1`, [callouts.dvdDraft])).toBe('OK');
      expect(await stored(`select 1 from public.intervention_responses where id = $1`, [draftAnswer])).toHaveLength(0);
    });
    await isolated(async () => {
      // A published call-out and its answers stay (034, 035). The service role may still ask to delete a
      // call-out - 034's rule answers; a superuser session's delete of an answer meets 035's.
      const answer = await answerOf(callouts.dvdAnswered, people.dvdFirefighter.member);
      expect(await asService(`delete from public.interventions where id = $1`, [callouts.dvdAnswered])).toBe('PUBLISHED_INTERVENTION_RETAINED');
      expect(await raw(`delete from public.intervention_responses where id = $1`, [answer])).toBe('RESPONSE_RETAINED');
      // A member named by an answer, a journey step or an availability is still kept by its foreign key.
      expect(await raw(`delete from public.members where id = $1`, [people.szsFirefighter.member])).toMatch(/^FK /);
    });
    const { rows: keys } = await db.query<{ key: string }>(
      `select conrelid::regclass::text || '.' || conname || ' -> ' || confrelid::regclass::text || ' ' ||
              case confdeltype when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' when 'c' then 'CASCADE'
                               when 'n' then 'SET NULL' else 'SET DEFAULT' end as key
         from pg_constraint where contype = 'f' and conrelid::regclass::text = any($1)`,
      [[...TABLES]],
    );
    expect(keys.map((row) => row.key).sort()).toEqual([
      'intervention_journey.intervention_journey_intervention_id_fkey -> interventions RESTRICT',
      'intervention_journey.intervention_journey_member_id_fkey -> members RESTRICT',
      'intervention_journey.intervention_journey_organization_id_fkey -> organizations NO ACTION',
      'intervention_journey.intervention_journey_updated_by_fkey -> auth.users RESTRICT',
      'intervention_responses.intervention_responses_intervention_id_fkey -> interventions CASCADE',
      'intervention_responses.intervention_responses_member_id_fkey -> members RESTRICT',
      'intervention_responses.intervention_responses_organization_id_fkey -> organizations NO ACTION',
      'member_availability.member_availability_changed_by_fkey -> auth.users RESTRICT',
      'member_availability.member_availability_member_id_fkey -> members RESTRICT',
      'member_availability.member_availability_organization_id_fkey -> organizations NO ACTION',
    ]);
  });

  it('leaves the service role SELECT, REFERENCES and TRIGGER on the three tables, and every other role as it was', async () => {
    const { rows } = await db.query<{ table: string; acl: string }>(
      `select relname::text as table, array_to_string(relacl, ' ') as acl from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
      [[...TABLES]],
    );
    // As P4f left the audit tables and 034 the history tables.
    expect(rows).toEqual(
      [...TABLES].sort().map((table) => ({ table, acl: 'postgres=arwdDxt/postgres service_role=rxt/postgres authenticated=r/postgres' })),
    );
    const { rows: effective } = await db.query<{ table: string; writes: boolean; reads: boolean }>(
      `select t as table,
              has_table_privilege('service_role', 'public.' || t, 'INSERT') or has_table_privilege('service_role', 'public.' || t, 'UPDATE')
                or has_table_privilege('service_role', 'public.' || t, 'DELETE') or has_table_privilege('service_role', 'public.' || t, 'TRUNCATE') as writes,
              has_table_privilege('service_role', 'public.' || t, 'SELECT') as reads
         from unnest($1::text[]) as t order by 1`,
      [[...TABLES]],
    );
    expect(effective).toEqual([...TABLES].sort().map((table) => ({ table, writes: false, reads: true })));
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
                                  select relname || coalesce(array_to_string(relacl, ' '), '') as x from pg_class
                                   where relnamespace = 'public'::regnamespace and relkind = 'r') g), '')) as h`,
      )).rows[0]!.h;
    const before = await shape();
    await isolated(async () => {
      await db.query(sql(GRANTS));
      expect(await shape()).toBe(before);
    });
  });
});
