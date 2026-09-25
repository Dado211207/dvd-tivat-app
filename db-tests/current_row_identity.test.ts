/**
 * An answer stays the answer of the member who gave it, on the call-out it was
 * given to, in that call-out's service - and it stays.
 *
 * Review of #64 at 202609250034 (the owner's retention rule). The revisions of
 * an answer are append-only; the answer they hang from was not.
 * `intervention_responses` is the current answer, which `submit_response()`
 * revises - its answer, ETA, direct-travel flag, timestamp and revision number.
 * Nothing stopped anything else about it changing:
 *
 *   its member   an answer, and with it every revision, re-attributed to
 *                somebody else in the same service - who need never have been
 *                sent the call-out;
 *   its service  moved onto the other service's call-out and member by
 *                changing its label along with them, which P2's trigger accepts
 *                as consistent - leaving its revisions labelled with the old
 *                service, so each service's command reads half of it;
 *   its being    every answer submit_response() writes has a revision, which
 *                RESTRICTs deleting it. That is the command's habit, not a
 *                database rule: an answer written any other way, with no
 *                revision, could simply be deleted from a published call-out.
 *
 * The current journey step and the current availability are the same kind of
 * row - state whose history is append-only - and could be re-attributed the
 * same way.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const IDENTITY = 'supabase/migrations/202609250035_current_row_identity.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

type Label = 'dvdCommander' | 'dvdFirefighter' | 'dvdOther' | 'szsCommander' | 'szsFirefighter';
interface Person {
  user: string;
  dvd?: string;
  szs?: string;
}
const people = {} as Record<Label, Person>;
/** The DVD firefighter, who answered, set out and stated their availability. */
const A = () => people.dvdFirefighter;
/** Another DVD member, never sent anything, with no availability stated. */
const B = () => people.dvdOther;

const callouts = {
  /** Published to A, who answered twice (two revisions) and set out. */
  dvdAnswered: '',
  /** Published to A, not answered. */
  dvdSilent: '',
  /** Published to the SZS firefighter, who has neither answered nor set out. */
  szsCallout: '',
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

/** A refusal as one word: DENIED, a foreign key's name, or the exception's code. */
function refusal(error: unknown): string {
  const message = (error as Error).message;
  if (/permission denied/.test(message)) return 'DENIED';
  const foreignKey = /violates foreign key constraint "([^"]+)"/.exec(message);
  if (foreignKey) return `FK ${foreignKey[1]}`;
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
  const created = await createAccount(db, `${label.toLowerCase()}.identity@example.invalid`);
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

/** The answer one member gave to one call-out. */
async function answerOf(callout: string, member: string): Promise<string> {
  const rows = await stored<{ id: string }>(
    `select id::text from public.intervention_responses where intervention_id = $1 and member_id = $2`,
    [callout, member],
  );
  if (!rows.length) throw new Error('no such answer - the fixture did not write it');
  return rows[0]!.id;
}

/** Answers whose revisions carry another service than they do, anywhere. */
async function divergentRevisions(): Promise<number> {
  const rows = await stored<{ n: number }>(
    `select count(*)::int as n from public.intervention_response_revisions revision
       join public.intervention_responses response on response.id = revision.response_id
      where revision.organization_id <> response.organization_id`,
  );
  return rows[0]!.n;
}

/** An answer written the way no command writes one: without a revision. */
const ANSWER_WITHOUT_REVISION = `insert into public.intervention_responses(intervention_id, member_id, answer, eta_minutes, direct_to_location)
                                 values ($1, $2, 'DOLAZIM', null, false)`;

beforeAll(async () => {
  db = await connect();
  await db.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  // Everything up to and including #64's 202609250034. Until 035 exists this
  // is every migration there is, and the second half of this file fails.
  const index = MIGRATIONS.indexOf(IDENTITY);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  for (const [label, role] of [['dvdCommander', 'COMMANDER'], ['dvdFirefighter', 'FIREFIGHTER'], ['dvdOther', 'FIREFIGHTER']] as const) {
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

  await committed(A().user, `select public.set_own_availability(true, 'Dostupan')`);
  callouts.dvdAnswered = await publishedTo('DVD', 'dvdFirefighter', 'identity-dvd-answered');
  await committed(A().user, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.dvdAnswered]);
  await committed(A().user, `select public.submit_response($1, 'DOLAZIM_KASNIJE', 15, false)`, [callouts.dvdAnswered]);
  await committed(A().user, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.dvdAnswered]);
  callouts.dvdSilent = await publishedTo('DVD', 'dvdFirefighter', 'identity-dvd-silent');
  callouts.szsCallout = await publishedTo('SZS', 'szsFirefighter', 'identity-szs');
  callouts.dvdDraft = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'Nacrt', 'Upute.', 'Mjesto', 'identity-dvd-draft')`,
  );
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('at 202609250034: an answer, a journey step and an availability can be re-attributed, and an answer without a revision deleted', () => {
  it('re-attributes an answer, and every revision of it, to another member of the same service', async () => {
    await isolated(async () => {
      const answer = await answerOf(callouts.dvdAnswered, A().dvd!);
      expect(await raw(`update public.intervention_responses set member_id = $2 where id = $1`, [answer, B().dvd])).toBe('OK');

      // Stored: the same answer, now B's, carrying A's two revisions.
      expect(await stored(`select member_id::text, organization_id::text, answer, revision from public.intervention_responses where id = $1`, [answer])).toEqual([
        { member_id: B().dvd, organization_id: DVD, answer: 'DOLAZIM_KASNIJE', revision: 2 },
      ]);
      expect(
        await stored(`select revision, answer, organization_id::text from public.intervention_response_revisions where response_id = $1 order by revision`, [answer]),
      ).toEqual([
        { revision: 1, answer: 'DOLAZIM', organization_id: DVD },
        { revision: 2, answer: 'DOLAZIM_KASNIJE', organization_id: DVD },
      ]);
      // B was never sent the call-out.
      expect(await stored(`select 1 from public.intervention_recipients where intervention_id = $1 and member_id = $2`, [callouts.dvdAnswered, B().dvd])).toHaveLength(0);

      // What people read: DVD command sees B coming, with A's history behind
      // it; A, still a recipient, sees B's answer and none of their own.
      expect(await rowsAs(people.dvdCommander.user, `select member_id::text from public.intervention_responses where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: B().dvd },
      ]);
      expect(await rowsAs(people.dvdCommander.user, `select count(*)::int as n from public.intervention_response_revisions where response_id = $1`, [answer])).toEqual([{ n: 2 }]);
      expect(await rowsAs(A().user, `select member_id::text from public.intervention_responses where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: B().dvd },
      ]);
    });
    // The service role can do the same.
    await isolated(async () => {
      expect(
        await asService(`update public.intervention_responses set member_id = $2 where id = $1`, [await answerOf(callouts.dvdAnswered, A().dvd!), B().dvd]),
      ).toBe('OK');
    });
  });

  it("moves an answer onto the other service's call-out and member with its label, leaving its revisions in the old service", async () => {
    await isolated(async () => {
      const answer = await answerOf(callouts.dvdAnswered, A().dvd!);
      expect(
        await asService(`update public.intervention_responses set intervention_id = $2, member_id = $3, organization_id = $4 where id = $1`, [
          answer,
          callouts.szsCallout,
          people.szsFirefighter.szs,
          SZS,
        ]),
      ).toBe('OK');

      // Stored: an SZS answer whose history is DVD's.
      expect(await stored(`select intervention_id::text, member_id::text, organization_id::text from public.intervention_responses where id = $1`, [answer])).toEqual([
        { intervention_id: callouts.szsCallout, member_id: people.szsFirefighter.szs, organization_id: SZS },
      ]);
      expect(await stored(`select organization_id::text from public.intervention_response_revisions where response_id = $1 order by revision`, [answer])).toEqual([
        { organization_id: DVD },
        { organization_id: DVD },
      ]);
      expect(await divergentRevisions()).toBe(2);

      // What people read: SZS command sees the answer and none of its history;
      // DVD command sees the history of an answer it cannot see; the SZS
      // recipient is shown an answer they never gave.
      const read = async (who: string) => ({
        answers: (await rowsAs<{ id: string }>(who, `select id::text from public.intervention_responses where id = $1`, [answer])).length,
        revisions: (await rowsAs<{ id: string }>(who, `select id::text from public.intervention_response_revisions where response_id = $1`, [answer])).length,
      });
      expect(await read(people.szsCommander.user), 'SZS command').toEqual({ answers: 1, revisions: 0 });
      expect(await read(people.dvdCommander.user), 'DVD command').toEqual({ answers: 0, revisions: 2 });
      expect(
        await rowsAs(people.szsFirefighter.user, `select member_id::text, answer from public.intervention_responses where intervention_id = $1`, [callouts.szsCallout]),
      ).toEqual([{ member_id: people.szsFirefighter.szs, answer: 'DOLAZIM_KASNIJE' }]);
      expect(await rowsAs(A().user, `select 1 from public.intervention_responses where intervention_id = $1`, [callouts.dvdAnswered])).toHaveLength(0);
    });
  });

  it('lets an answer with no revision be written outside submit_response() and deleted from a published call-out', async () => {
    await isolated(async () => {
      // Nothing requires a revision: the service role writes an answer without one.
      expect(await asService(ANSWER_WITHOUT_REVISION, [callouts.dvdSilent, A().dvd])).toBe('OK');
      const anomalous = await answerOf(callouts.dvdSilent, A().dvd!);
      expect(await stored(`select 1 from public.intervention_response_revisions where response_id = $1`, [anomalous])).toHaveLength(0);
      expect(await stored(`select status from public.interventions where id = $1`, [callouts.dvdSilent])).toEqual([{ status: 'PUBLISHED' }]);
      // A recipient of the call-out reads it like any other answer.
      expect(await rowsAs(A().user, `select answer from public.intervention_responses where id = $1`, [anomalous])).toEqual([{ answer: 'DOLAZIM' }]);

      expect(await asService(`delete from public.intervention_responses where id = $1`, [anomalous])).toBe('OK');
      expect(await stored(`select 1 from public.intervention_responses where id = $1`, [anomalous])).toHaveLength(0);

      // A superuser session, the same.
      expect(await raw(ANSWER_WITHOUT_REVISION, [callouts.dvdSilent, A().dvd])).toBe('OK');
      expect(await raw(`delete from public.intervention_responses where id = $1`, [await answerOf(callouts.dvdSilent, A().dvd!)])).toBe('OK');

      // An answer with revisions is already kept, by them (202609250034).
      expect(await raw(`delete from public.intervention_responses where id = $1`, [await answerOf(callouts.dvdAnswered, A().dvd!)])).toBe(
        'FK intervention_response_revisions_response_id_fkey',
      );
    });
  });

  it('re-attributes the current journey step and the current availability, detaching them from their history', async () => {
    await isolated(async () => {
      expect(
        await raw(`update public.intervention_journey set member_id = $3 where intervention_id = $1 and member_id = $2`, [callouts.dvdAnswered, A().dvd, B().dvd]),
      ).toBe('OK');
      expect(await stored(`select member_id::text, progress from public.intervention_journey where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: B().dvd, progress: 'KRECEM' },
      ]);
      // The history says A set out; the board says B is on the way.
      expect(await stored(`select member_id::text, next_progress from public.intervention_journey_history where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: A().dvd, next_progress: 'KRECEM' },
      ]);
      expect(await rowsAs(people.dvdCommander.user, `select member_id::text, progress from public.intervention_journey where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: B().dvd, progress: 'KRECEM' },
      ]);

      expect(await raw(`update public.member_availability set member_id = $2 where member_id = $1`, [A().dvd, B().dvd])).toBe('OK');
      expect(await stored(`select available, note, changed_by::text from public.member_availability where member_id = $1`, [B().dvd])).toEqual([
        { available: true, note: 'Dostupan', changed_by: A().user },
      ]);
      expect(await stored(`select 1 from public.member_availability_history where member_id = $1`, [B().dvd])).toHaveLength(0);
      expect(await rowsAs(people.dvdCommander.user, `select member_id::text, available from public.member_availability where member_id = $1`, [B().dvd])).toEqual([
        { member_id: B().dvd, available: true },
      ]);
    });

    await isolated(async () => {
      // Across services, the label moved along: consistent for P2.
      expect(
        await asService(
          `update public.intervention_journey set intervention_id = $3, member_id = $4, organization_id = $5 where intervention_id = $1 and member_id = $2`,
          [callouts.dvdAnswered, A().dvd, callouts.szsCallout, people.szsFirefighter.szs, SZS],
        ),
      ).toBe('OK');
      expect(await rowsAs(people.szsCommander.user, `select member_id::text, progress from public.intervention_journey where intervention_id = $1`, [callouts.szsCallout])).toEqual([
        { member_id: people.szsFirefighter.szs, progress: 'KRECEM' },
      ]);
      expect(await stored(`select 1 from public.intervention_journey_history where intervention_id = $1`, [callouts.szsCallout])).toHaveLength(0);

      expect(
        await asService(`update public.member_availability set member_id = $2, organization_id = $3 where member_id = $1`, [A().dvd, people.szsFirefighter.szs, SZS]),
      ).toBe('OK');
      expect(await rowsAs(people.szsCommander.user, `select member_id::text, available from public.member_availability`)).toEqual([
        { member_id: people.szsFirefighter.szs, available: true },
      ]);
      expect(await stored(`select 1 from public.member_availability_history where member_id = $1`, [people.szsFirefighter.szs])).toHaveLength(0);
    });
  });
});

describe('after 202609250035: an answer, a journey step and an availability stay whose they are, and a call-out keeps its answers', () => {
  beforeAll(async () => {
    if (MIGRATIONS.includes(IDENTITY)) await db.query(sql(IDENTITY));
  }, 60_000);

  // --- answers ---------------------------------------------------------------

  it('keeps an answer with the member who gave it, on its call-out, in its service - whoever asks', async () => {
    await isolated(async () => {
      const answer = await answerOf(callouts.dvdAnswered, A().dvd!);
      for (const [label, statement, params] of [
        ['another member, same service', `update public.intervention_responses set member_id = $2 where id = $1`, [answer, B().dvd]],
        [
          'the other service, label and all',
          `update public.intervention_responses set intervention_id = $2, member_id = $3, organization_id = $4 where id = $1`,
          [answer, callouts.szsCallout, people.szsFirefighter.szs, SZS],
        ],
        ['another call-out, same service', `update public.intervention_responses set intervention_id = $2 where id = $1`, [answer, callouts.dvdSilent]],
        ['when it was first given', `update public.intervention_responses set responded_at = responded_at - interval '1 hour' where id = $1`, [answer]],
        ['its id', `update public.intervention_responses set id = gen_random_uuid() where id = $1`, [answer]],
      ] as const) {
        expect(await raw(statement, [...params]), label).toBe('RESPONSE_IDENTITY_FIXED');
        expect(await asService(statement, [...params]), `${label}, as the service role`).toBe('RESPONSE_IDENTITY_FIXED');
      }
      // A label contradicting the call-out is still P2's to refuse, first.
      expect(await raw(`update public.intervention_responses set organization_id = $2 where id = $1`, [answer, SZS])).toBe('ORGANIZATION_MISMATCH');

      expect(await stored(`select intervention_id::text, member_id::text, organization_id::text, revision from public.intervention_responses where id = $1`, [answer])).toEqual([
        { intervention_id: callouts.dvdAnswered, member_id: A().dvd, organization_id: DVD, revision: 2 },
      ]);
      expect(await rowsAs(people.dvdCommander.user, `select count(*)::int as n from public.intervention_response_revisions where response_id = $1`, [answer])).toEqual([{ n: 2 }]);
      expect(await rowsAs(people.szsCommander.user, `select 1 from public.intervention_responses where id = $1`, [answer])).toHaveLength(0);
      // No answer anywhere carries another service than its revisions.
      expect(await divergentRevisions()).toBe(0);
    });
  });

  it('still lets submit_response() revise an answer: its answer, ETA, direct travel, time and revision number', async () => {
    await isolated(async () => {
      const answer = await answerOf(callouts.dvdAnswered, A().dvd!);
      const identity = `select id::text, intervention_id::text, member_id::text, organization_id::text, responded_at from public.intervention_responses where id = $1`;
      const revised = `select answer, eta_minutes, direct_to_location, revision from public.intervention_responses where id = $1`;
      const updatedAt = async () =>
        (await stored<{ updated_at: Date }>(`select updated_at from public.intervention_responses where id = $1`, [answer]))[0]!.updated_at.getTime();
      const identityBefore = await stored(identity, [answer]);
      const updatedBefore = await updatedAt();

      await rowsAs(A().user, `select public.submit_response($1, 'DOLAZIM', null, true)`, [callouts.dvdAnswered]);
      expect(await stored(revised, [answer])).toEqual([{ answer: 'DOLAZIM', eta_minutes: null, direct_to_location: true, revision: 3 }]);
      expect(await updatedAt()).toBeGreaterThan(updatedBefore);
      expect(await stored(identity, [answer])).toEqual(identityBefore);
      expect(
        await stored(`select revision, answer, direct_to_location, organization_id::text from public.intervention_response_revisions where response_id = $1 order by revision`, [answer]),
      ).toEqual([
        { revision: 1, answer: 'DOLAZIM', direct_to_location: false, organization_id: DVD },
        { revision: 2, answer: 'DOLAZIM_KASNIJE', direct_to_location: false, organization_id: DVD },
        { revision: 3, answer: 'DOLAZIM', direct_to_location: true, organization_id: DVD },
      ]);

      // The same answer again is still no change.
      await rowsAs(A().user, `select public.submit_response($1, 'DOLAZIM', null, true)`, [callouts.dvdAnswered]);
      expect(await stored(`select revision from public.intervention_responses where id = $1`, [answer])).toEqual([{ revision: 3 }]);

      // A first answer in the other service: written with its revision, in SZS.
      await rowsAs(people.szsFirefighter.user, `select public.submit_response($1, 'NE_MOGU', null, false)`, [callouts.szsCallout]);
      const szsAnswer = await answerOf(callouts.szsCallout, people.szsFirefighter.szs!);
      expect(await stored(`select organization_id::text, revision from public.intervention_responses where id = $1`, [szsAnswer])).toEqual([
        { organization_id: SZS, revision: 1 },
      ]);
      expect(await stored(`select organization_id::text, revision from public.intervention_response_revisions where response_id = $1`, [szsAnswer])).toEqual([
        { organization_id: SZS, revision: 1 },
      ]);
      expect(await divergentRevisions()).toBe(0);
    });
  });

  it('keeps every answer of a call-out that exists, with or without a revision, whoever asks', async () => {
    await isolated(async () => {
      expect(await asService(ANSWER_WITHOUT_REVISION, [callouts.dvdSilent, A().dvd])).toBe('OK');
      const anomalous = await answerOf(callouts.dvdSilent, A().dvd!);
      const answered = await answerOf(callouts.dvdAnswered, A().dvd!);
      expect(await asService(`delete from public.intervention_responses where id = $1`, [anomalous])).toBe('RESPONSE_RETAINED');
      expect(await raw(`delete from public.intervention_responses where id = $1`, [anomalous])).toBe('RESPONSE_RETAINED');
      // With revisions too: the rule answers before the foreign key is asked.
      expect(await raw(`delete from public.intervention_responses where id = $1`, [answered])).toBe('RESPONSE_RETAINED');
      expect(await asService(`delete from public.intervention_responses`)).toBe('RESPONSE_RETAINED');
      // Nor the table. Without CASCADE PostgreSQL refuses first, because the
      // revisions reference it; with CASCADE the rule on the answers answers.
      expect(await raw(`truncate public.intervention_responses`)).toBe('TRUNCATE_NEEDS_CASCADE');
      expect(await raw(`truncate public.intervention_responses cascade`)).toBe('RESPONSE_RETAINED');
      expect(await stored(`select 1 from public.intervention_responses where id = any($1::uuid[])`, [[anomalous, answered]])).toHaveLength(2);
    });
  });

  it('still deletes a draft that was never published, with an answer written to it outside the commands', async () => {
    await isolated(async () => {
      // submit_response() refuses a draft, so only a direct write puts one here.
      expect(await raw(ANSWER_WITHOUT_REVISION, [callouts.dvdDraft, A().dvd])).toBe('OK');
      const draftAnswer = await answerOf(callouts.dvdDraft, A().dvd!);
      // Not on its own - an answer goes only with its call-out...
      expect(await raw(`delete from public.intervention_responses where id = $1`, [draftAnswer])).toBe('RESPONSE_RETAINED');
      // ...and the draft, never published, may go (202609250034), taking it along.
      expect(await raw(`delete from public.interventions where id = $1`, [callouts.dvdDraft])).toBe('OK');
      expect(await stored(`select 1 from public.intervention_responses where id = $1`, [draftAnswer])).toHaveLength(0);
      expect(await stored(`select 1 from public.interventions where id = $1`, [callouts.dvdDraft])).toHaveLength(0);
    });
  });

  // --- the current journey step and availability ---------------------------

  it('keeps the current journey step and the current availability with their member and service - whoever asks', async () => {
    await isolated(async () => {
      for (const [label, statement, params] of [
        ['journey: another member', `update public.intervention_journey set member_id = $3 where intervention_id = $1 and member_id = $2`, [callouts.dvdAnswered, A().dvd, B().dvd]],
        [
          'journey: another call-out, same service',
          `update public.intervention_journey set intervention_id = $3 where intervention_id = $1 and member_id = $2`,
          [callouts.dvdAnswered, A().dvd, callouts.dvdSilent],
        ],
        [
          'journey: the other service, label and all',
          `update public.intervention_journey set intervention_id = $3, member_id = $4, organization_id = $5 where intervention_id = $1 and member_id = $2`,
          [callouts.dvdAnswered, A().dvd, callouts.szsCallout, people.szsFirefighter.szs, SZS],
        ],
      ] as const) {
        expect(await raw(statement, [...params]), label).toBe('JOURNEY_IDENTITY_FIXED');
        expect(await asService(statement, [...params]), `${label}, as the service role`).toBe('JOURNEY_IDENTITY_FIXED');
      }
      for (const [label, statement, params] of [
        ['availability: another member', `update public.member_availability set member_id = $2 where member_id = $1`, [A().dvd, B().dvd]],
        [
          'availability: the other service, label and all',
          `update public.member_availability set member_id = $2, organization_id = $3 where member_id = $1`,
          [A().dvd, people.szsFirefighter.szs, SZS],
        ],
      ] as const) {
        expect(await raw(statement, [...params]), label).toBe('AVAILABILITY_IDENTITY_FIXED');
        expect(await asService(statement, [...params]), `${label}, as the service role`).toBe('AVAILABILITY_IDENTITY_FIXED');
      }
      // A contradicting label is still P2's to refuse, first.
      expect(await raw(`update public.intervention_journey set organization_id = $2 where intervention_id = $1`, [callouts.dvdAnswered, SZS])).toBe(
        'ORGANIZATION_MISMATCH',
      );
      expect(await raw(`update public.member_availability set organization_id = $2 where member_id = $1`, [A().dvd, SZS])).toBe('ORGANIZATION_MISMATCH');

      expect(await stored(`select member_id::text, organization_id::text from public.intervention_journey where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: A().dvd, organization_id: DVD },
      ]);
      expect(await stored(`select member_id::text, organization_id::text from public.member_availability`)).toEqual([{ member_id: A().dvd, organization_id: DVD }]);
    });
  });

  it('still moves the journey and availability through their commands, in each service', async () => {
    await isolated(async () => {
      await rowsAs(A().user, `select public.set_journey_progress($1, 'U_PUTU')`, [callouts.dvdAnswered]);
      expect(await stored(`select member_id::text, progress, updated_by::text from public.intervention_journey where intervention_id = $1`, [callouts.dvdAnswered])).toEqual([
        { member_id: A().dvd, progress: 'U_PUTU', updated_by: A().user },
      ]);
      await rowsAs(A().user, `select public.set_own_availability(false, 'Na poslu')`);
      expect(await stored(`select available, note from public.member_availability where member_id = $1`, [A().dvd])).toEqual([
        { available: false, note: 'Na poslu' },
      ]);
      // First rows in SZS, written by the same commands.
      await rowsAs(people.szsFirefighter.user, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.szsCallout]);
      await rowsAs(people.szsFirefighter.user, `select public.set_own_availability_in($1, true, 'Dostupan')`, [SZS]);
      expect(await stored(`select organization_id::text from public.intervention_journey where intervention_id = $1`, [callouts.szsCallout])).toEqual([
        { organization_id: SZS },
      ]);
      expect(await stored(`select organization_id::text from public.member_availability where member_id = $1`, [people.szsFirefighter.szs])).toEqual([
        { organization_id: SZS },
      ]);
    });
  });

  // --- asked of the catalogue -------------------------------------------------

  it('declares each rule as a trigger after P2\'s, reachable by no client', async () => {
    const { rows } = await db.query<{ table: string; def: string }>(
      `select c.relname::text as table, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
          and c.relname in ('intervention_responses', 'intervention_journey', 'member_availability')
        order by c.relname::text collate "C", pg_get_triggerdef(t.oid) collate "C"`,
    );
    expect(rows.map((row) => row.def.replace(/^CREATE TRIGGER /, ''))).toEqual([
      "enforce_organization BEFORE INSERT OR UPDATE ON public.intervention_journey FOR EACH ROW EXECUTE FUNCTION enforce_organization_from_parent('interventions', 'intervention_id', 'id')",
      'refuse_rebinding BEFORE UPDATE ON public.intervention_journey FOR EACH ROW EXECUTE FUNCTION refuse_journey_rebinding()',
      "enforce_organization BEFORE INSERT OR UPDATE ON public.intervention_responses FOR EACH ROW EXECUTE FUNCTION enforce_organization_from_parent('interventions', 'intervention_id', 'id')",
      'refuse_rebinding BEFORE UPDATE ON public.intervention_responses FOR EACH ROW EXECUTE FUNCTION refuse_response_rebinding()',
      'retain_answers BEFORE DELETE ON public.intervention_responses FOR EACH ROW EXECUTE FUNCTION refuse_response_delete()',
      'retain_answers_truncate BEFORE TRUNCATE ON public.intervention_responses FOR EACH STATEMENT EXECUTE FUNCTION refuse_response_delete()',
      "enforce_organization BEFORE INSERT OR UPDATE ON public.member_availability FOR EACH ROW EXECUTE FUNCTION enforce_organization_from_parent('members', 'member_id', 'id')",
      'refuse_rebinding BEFORE UPDATE ON public.member_availability FOR EACH ROW EXECUTE FUNCTION refuse_availability_rebinding()',
    ]);
    const { rows: callable } = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('refuse_response_rebinding', 'refuse_response_delete', 'refuse_journey_rebinding', 'refuse_availability_rebinding')
          and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`,
    );
    expect(callable).toEqual([]);
    // Nothing but submit_response() updates an answer, and no command deletes one.
    const { rows: writers } = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.prosrc ~* '(update|delete\\s+from)\\s+(public\\.)?intervention_responses\\M' order by 1`,
    );
    expect(writers).toEqual([{ fn: 'submit_response' }]);
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
      await db.query(sql(IDENTITY));
      expect(await shape()).toBe(before);
    });
  });
});
