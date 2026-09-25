/**
 * An answer to a call-out comes from the member the call-out was sent to.
 *
 * P4c of docs/MULTI_ORG_PLAN.md. P4b isolated call-outs by service and scoped
 * every READ of the four P4c tables - `intervention_responses`, their
 * revisions, `intervention_journey` and its history - and 028 made
 * `set_journey_progress` resolve its caller in the call-out's service. What
 * was left is the one command that writes answers.
 *
 * `submit_response()` resolves its caller with `current_member_id()`, the DVD
 * shim. For an SZS call-out that is the wrong question twice over:
 *
 *   an SZS-only recipient   has no DVD member record, so is refused
 *                           MEMBER_RECORD_REQUIRED on their own call-out
 *   a dual-service recipient resolves to their DVD record, which is not on the
 *                           SZS recipient list, so is refused NOT_A_RECIPIENT
 *
 * Both fail CLOSED - it writes nothing - which is why P4b could leave it. It
 * holds for one reason, recorded in 028: the recipient is looked up INLINE
 * against the member about to be written, so the member checked and the
 * member written are always the same one. P4c keeps exactly that shape and
 * changes only which member it is: the one the caller holds in the service
 * that ran the call-out, read from the stored intervention - never a
 * parameter, so there is nothing to forge.
 *
 * DVD is unchanged by construction: for a DVD call-out the member resolved in
 * the call-out's service IS what `current_member_id()` returns. An unknown id
 * is judged as DVD's, as every earlier version did, so the refusals for it are
 * unchanged too - `scripts/p4-equivalence-gate.mjs` measures that on a copy of
 * production, and this file measures the rest.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const RESPONSES = 'supabase/migrations/202609250030_response_service.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const UNKNOWN = '00000000-0000-4000-8fff-000000000001';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

interface Person {
  user: string;
  dvd?: string;
  szs?: string;
}
type Label =
  | 'owner'
  | 'dvdCommander'
  | 'dvdFirefighter'
  | 'dvdBystander'
  | 'szsCommander'
  | 'szsFirefighter'
  | 'szsBystander'
  | 'szsSuspended'
  | 'szsIncomplete'
  | 'dual'
  | 'dualSzsSuspended'
  | 'dualSzsWithdrawn'
  | 'citizen';
const people = {} as Record<Label, Person>;

let dvdCallout = '';
let szsCallout = '';
let szsDraft = '';
let szsClosed = '';

/**
 * Runs one statement as `userId` INSIDE the caller's open transaction, and
 * answers 'OK' or the refusal code. Savepoints, for the reason P4a's file
 * records: a refusal aborts the transaction, and every later step would report
 * that instead of its own answer.
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
    return (error as Error).message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** `work` in a transaction that is always rolled back, so no test leaks into the next. */
async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

const answer = (who: Label, callout: string, value: string, eta: number | null = null, direct = false) =>
  act(people[who].user, 'select public.submit_response($1, $2, $3, $4)', [callout, value, eta, direct]);

/** Every answer on a call-out, as postgres: whose member, in which service, at which revision. */
async function answersOn(callout: string) {
  const { rows } = await db.query<{
    member_id: string;
    organization: string;
    answer: string;
    eta_minutes: number | null;
    direct_to_location: boolean;
    revision: number;
    revisions: string;
  }>(
    `select r.member_id, o.code as organization, r.answer, r.eta_minutes, r.direct_to_location, r.revision,
            (select string_agg(v.revision || ':' || v.answer || ':' || coalesce(v.eta_minutes::text, '-')
                               || ':' || vo.code, ',' order by v.revision)
               from public.intervention_response_revisions v
               join public.organizations vo on vo.id = v.organization_id
              where v.response_id = r.id) as revisions
       from public.intervention_responses r
       join public.organizations o on o.id = r.organization_id
      where r.intervention_id = $1
      order by r.member_id`,
    [callout],
  );
  return rows;
}

/** Row counts of every public table, so a test can say exactly which ones a command wrote. */
async function tableCounts(): Promise<Record<string, number>> {
  const { rows: tables } = await db.query<{ relname: string }>(
    `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`,
  );
  const counts: Record<string, number> = {};
  for (const { relname } of tables) {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${relname}`);
    counts[relname] = rows[0]!.n;
  }
  return counts;
}

function changedTables(before: Record<string, number>, after: Record<string, number>): string[] {
  return Object.keys(after).filter((table) => before[table] !== after[table]).sort();
}

/** An account that can act: profile complete, grant role set, grant active. */
async function account(label: string, grantRole: string): Promise<string> {
  const created = await createAccount(db, `${label.toLowerCase()}.p4c@example.invalid`);
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

/** Runs one command as `user` and COMMITS it: fixture building, through the real commands. */
async function committed(user: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(user)]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(statement, params);
    await db.query('commit');
    return String(Object.values(rows[0] as object)[0] ?? '');
  } catch (error) {
    await db.query('rollback');
    throw error;
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
  // Everything before P4c. Until the migration exists this is every migration
  // there is, and the second half of this file fails - which is the point.
  const index = MIGRATIONS.indexOf(RESPONSES);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  // The installation owner holds no membership and no member record.
  people.owner = { user: await account('Vlasnik', 'OWNER') };

  // DVD: a commander, the firefighter sent the call-out, and one who was not.
  people.dvdCommander = { user: await account('KomandirDVD', 'COMMANDER') };
  people.dvdCommander.dvd = await memberIn(DVD, 'Komandir DVD', people.dvdCommander.user);
  people.dvdFirefighter = { user: await account('VatrogasacDVD', 'FIREFIGHTER') };
  people.dvdFirefighter.dvd = await memberIn(DVD, 'Vatrogasac DVD', people.dvdFirefighter.user);
  people.dvdBystander = { user: await account('PosmatracDVD', 'FIREFIGHTER') };
  people.dvdBystander.dvd = await memberIn(DVD, 'Posmatrac DVD', people.dvdBystander.user);

  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership and make them DVD staff as well.
  for (const [label, role] of [
    ['szsCommander', 'COMMANDER'],
    ['szsFirefighter', 'FIREFIGHTER'],
    ['szsBystander', 'FIREFIGHTER'],
    ['szsSuspended', 'FIREFIGHTER'],
    ['szsIncomplete', 'FIREFIGHTER'],
  ] as const) {
    const user = await account(label, 'CITIZEN');
    await membership(user, SZS, role);
    people[label] = { user, szs: await memberIn(SZS, `${label} Clan`, user) };
  }

  // Three people who serve in both, each with a member record in each service:
  // DVD through the mirrored grant, SZS through a membership.
  for (const label of ['dual', 'dualSzsSuspended', 'dualSzsWithdrawn'] as const) {
    const user = await account(label, 'FIREFIGHTER');
    await membership(user, SZS, 'FIREFIGHTER');
    people[label] = {
      user,
      dvd: await memberIn(DVD, `${label} DVD`, user),
      szs: await memberIn(SZS, `${label} SZS`, user),
    };
  }

  people.citizen = { user: await account('Gradjanin', 'CITIZEN') };

  // The call-outs, through the real commands, each published to its own
  // service's members only - mixing the two in one list is refused (E3).
  dvdCallout = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'DVD poziv', 'Okupljanje u bazi.', 'Poligon DVD', 'p4c-dvd')`,
  );
  await committed(people.dvdCommander.user, 'select public.publish_intervention($1, $2)', [
    dvdCallout,
    (['dvdFirefighter', 'dual', 'dualSzsSuspended', 'dualSzsWithdrawn'] as const).map((who) => people[who].dvd),
  ]);

  szsCallout = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'POZAR', 'SZS poziv', 'Okupljanje kod doma.', 'Poligon SZS', 'p4c-szs')`,
    [SZS],
  );
  await committed(people.szsCommander.user, 'select public.publish_intervention($1, $2)', [
    szsCallout,
    (['szsFirefighter', 'dual', 'dualSzsSuspended', 'dualSzsWithdrawn', 'szsSuspended', 'szsIncomplete'] as const).map(
      (who) => people[who].szs,
    ),
  ]);
  szsDraft = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'VJEZBA', 'SZS nacrt', 'Upute.', 'Poligon SZS', 'p4c-szs-draft')`,
    [SZS],
  );
  szsClosed = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'VJEZBA', 'SZS zatvoren', 'Upute.', 'Poligon SZS', 'p4c-szs-closed')`,
    [SZS],
  );
  await committed(people.szsCommander.user, 'select public.publish_intervention($1, $2)', [szsClosed, [people.szsFirefighter.szs]]);
  await committed(people.szsCommander.user, `select public.close_intervention($1, 'CLOSED', 'Vjezba gotova', true)`, [szsClosed]);

  // Only now, after publication, does each of these lose standing - in SZS
  // alone, or entirely - so the recipient row stays and only who may answer
  // it changes.
  await db.query(`update public.access_grants set active = false where user_id = $1`, [people.szsSuspended.user]);
  await db.query(`update public.profiles set profile_complete = false where user_id = $1`, [people.szsIncomplete.user]);
  await db.query(`update public.organization_memberships set active = false where user_id = $1 and organization_id = $2`, [
    people.dualSzsSuspended.user,
    SZS,
  ]);
  await db.query(`update public.members set active = false where id = $1`, [people.dualSzsWithdrawn.szs]);
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before P4c: submit_response asks the DVD shim who is answering', () => {
  it('refuses an SZS recipient their own call-out, and a dual-service recipient too', async () => {
    await isolated(async () => {
      expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
      // Their DVD record is not on the SZS list; their SZS record is.
      expect(await answer('dual', szsCallout, 'DOLAZIM')).toBe('NOT_A_RECIPIENT');
      expect(await answersOn(szsCallout)).toEqual([]);
    });
  });

  it('works for DVD, which is the part that must not change', async () => {
    await isolated(async () => {
      expect(await answer('dvdFirefighter', dvdCallout, 'DOLAZIM')).toBe('OK');
      expect(await answer('dual', dvdCallout, 'NE_MOGU')).toBe('OK');
    });
  });

  it('tells somebody holding only a DVD record whether an SZS call-out exists, AND whether it is open', async () => {
    // The baseline for the existence question asked of P4c: through the shim,
    // an SZS id reached the status and recipient checks, so the refusal said
    // which state a call-out the caller cannot read was in.
    await isolated(async () => {
      expect(await answer('dvdFirefighter', szsCallout, 'DOLAZIM')).toBe('NOT_A_RECIPIENT');
      expect(await answer('dvdFirefighter', szsClosed, 'DOLAZIM')).toBe('INTERVENTION_NOT_OPEN');
      expect(await answer('dvdFirefighter', szsDraft, 'DOLAZIM')).toBe('INTERVENTION_NOT_OPEN');
      expect(await answer('dvdFirefighter', UNKNOWN, 'DOLAZIM')).toBe('INTERVENTION_NOT_FOUND');
    });
  });
});

describe('after P4c: an answer comes from the member the call-out was sent to', () => {
  beforeAll(async () => {
    // P4c and everything that sorts after it, so a later migration that
    // reopens any of this fails here rather than in production.
    const index = MIGRATIONS.indexOf(RESPONSES);
    if (index > -1) {
      for (const file of MIGRATIONS.slice(index)) await db.query(sql(file));
    }
  }, 120_000);

  describe('an SZS recipient', () => {
    it('answers their own call-out, written against their SZS member record', async () => {
      await isolated(async () => {
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM', null, true)).toBe('OK');
        const rows = await answersOn(szsCallout);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          member_id: people.szsFirefighter.szs,
          organization: 'SZS',
          answer: 'DOLAZIM',
          eta_minutes: null,
          direct_to_location: true,
          revision: 1,
          revisions: '1:DOLAZIM:-:SZS',
        });
      });
    });

    it('repeats an unchanged answer without a new revision, and revises a changed one', async () => {
      await isolated(async () => {
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM_KASNIJE', 30)).toBe('OK');
        const { rows: first } = await db.query<{ updated_at: string }>(
          `select updated_at::text from public.intervention_responses where intervention_id = $1`,
          [szsCallout],
        );
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM_KASNIJE', 30)).toBe('OK');
        const { rows: again } = await db.query<{ updated_at: string }>(
          `select updated_at::text from public.intervention_responses where intervention_id = $1`,
          [szsCallout],
        );
        expect(again[0]!.updated_at, 'an unchanged answer is not a change').toBe(first[0]!.updated_at);
        expect((await answersOn(szsCallout))[0]).toMatchObject({ revision: 1, revisions: '1:DOLAZIM_KASNIJE:30:SZS' });

        // NE_MOGU is never "direct to the scene", whatever the client sends.
        expect(await answer('szsFirefighter', szsCallout, 'NE_MOGU', null, true)).toBe('OK');
        expect((await answersOn(szsCallout))[0]).toMatchObject({
          member_id: people.szsFirefighter.szs,
          answer: 'NE_MOGU',
          direct_to_location: false,
          revision: 2,
          revisions: '1:DOLAZIM_KASNIJE:30:SZS,2:NE_MOGU:-:SZS',
        });
      });
    });

    it('is held to the same validation, in the same order, as a DVD recipient', async () => {
      await isolated(async () => {
        expect(await answer('szsFirefighter', szsCallout, 'MOZDA')).toBe('INVALID_ANSWER');
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM_KASNIJE', null)).toBe('ETA_REQUIRED');
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM_KASNIJE', 7)).toBe('ETA_REQUIRED');
        expect(await answer('szsFirefighter', szsDraft, 'DOLAZIM')).toBe('INTERVENTION_NOT_OPEN');
        expect(await answer('szsFirefighter', szsClosed, 'DOLAZIM')).toBe('INTERVENTION_NOT_OPEN');
        // An unknown id is judged as DVD's, as it always was: somebody with no
        // DVD record learns nothing about whether it exists.
        expect(await answer('szsFirefighter', UNKNOWN, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('dvdFirefighter', UNKNOWN, 'DOLAZIM')).toBe('INTERVENTION_NOT_FOUND');
        expect(await answersOn(szsCallout)).toEqual([]);
      });
    });
  });

  describe('somebody serving in both services', () => {
    it('answers each call-out as the member that call-out was sent to - two records, never crossed', async () => {
      await isolated(async () => {
        expect(await answer('dual', szsCallout, 'DOLAZIM_KASNIJE', 15)).toBe('OK');
        expect(await answer('dual', dvdCallout, 'NE_MOGU')).toBe('OK');
        const szs = await answersOn(szsCallout);
        const dvd = await answersOn(dvdCallout);
        expect(szs).toHaveLength(1);
        expect(szs[0]).toMatchObject({ member_id: people.dual.szs, organization: 'SZS', answer: 'DOLAZIM_KASNIJE', revisions: '1:DOLAZIM_KASNIJE:15:SZS' });
        expect(dvd).toHaveLength(1);
        expect(dvd[0]).toMatchObject({ member_id: people.dual.dvd, organization: 'DVD', answer: 'NE_MOGU', revisions: '1:NE_MOGU:-:DVD' });
        expect(people.dual.szs).not.toBe(people.dual.dvd);
      });
    });

    it('is one member on one call-out: the answer, the journey and its history and audit all name the same record', async () => {
      // 028 already writes the journey against the call-out's service; until
      // now the answer could not be written at all. The four P4c tables must
      // agree on who this person is on this call-out.
      await isolated(async () => {
        expect(await answer('dual', szsCallout, 'DOLAZIM')).toBe('OK');
        expect(await act(people.dual.user, `select public.set_journey_progress($1, 'KRECEM')`, [szsCallout])).toBe('OK');
        const { rows } = await db.query<{ source: string; member_id: string; organization: string }>(
          `select 'response' as source, r.member_id::text, o.code as organization
             from public.intervention_responses r join public.organizations o on o.id = r.organization_id
            where r.intervention_id = $1
           union all
           select 'journey', j.member_id::text, o.code
             from public.intervention_journey j join public.organizations o on o.id = j.organization_id
            where j.intervention_id = $1
           union all
           select 'journey history', h.member_id::text, o.code
             from public.intervention_journey_history h join public.organizations o on o.id = h.organization_id
            where h.intervention_id = $1
           union all
           select 'audit', a.detail->>'member_id', o.code
             from public.operational_audit a join public.organizations o on o.id = a.organization_id
            where a.intervention_id = $1 and a.event_type = 'JOURNEY_PROGRESS_SET'
           order by 1`,
          [szsCallout],
        );
        expect(rows).toEqual(
          ['audit', 'journey', 'journey history', 'response'].map((source) => ({
            source,
            member_id: people.dual.szs,
            organization: 'SZS',
          })),
        );
      });
    });

    it('cannot answer in a service whose membership was withdrawn, however active the other one is', async () => {
      await isolated(async () => {
        expect(await answer('dualSzsSuspended', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('dualSzsSuspended', dvdCallout, 'DOLAZIM')).toBe('OK');
        expect(await answersOn(szsCallout)).toEqual([]);
        expect((await answersOn(dvdCallout)).map((row) => row.member_id)).toEqual([people.dualSzsSuspended.dvd]);
      });
    });

    it('cannot answer in a service whose member record was withdrawn, however active the other one is', async () => {
      await isolated(async () => {
        expect(await answer('dualSzsWithdrawn', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('dualSzsWithdrawn', dvdCallout, 'DOLAZIM')).toBe('OK');
        expect(await answersOn(szsCallout)).toEqual([]);
      });
    });
  });

  describe('everybody else is refused, and nothing is written', () => {
    it('a role or record in one service never answers a call-out of the other', async () => {
      await isolated(async () => {
        expect(await answer('dvdFirefighter', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('dvdCommander', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('szsFirefighter', dvdCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('szsCommander', dvdCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answersOn(szsCallout)).toEqual([]);
        expect(await answersOn(dvdCallout)).toEqual([]);
      });
    });

    it('a member of the right service who was not sent it', async () => {
      await isolated(async () => {
        expect(await answer('szsBystander', szsCallout, 'DOLAZIM')).toBe('NOT_A_RECIPIENT');
        expect(await answer('szsCommander', szsCallout, 'DOLAZIM')).toBe('NOT_A_RECIPIENT');
        expect(await answer('dvdBystander', dvdCallout, 'DOLAZIM')).toBe('NOT_A_RECIPIENT');
        expect(await answersOn(szsCallout)).toEqual([]);
      });
    });

    it('a suspended or half-registered recipient, a citizen, and the owner who holds no record', async () => {
      await isolated(async () => {
        expect(await answer('szsSuspended', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('szsIncomplete', szsCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        for (const callout of [szsCallout, dvdCallout]) {
          expect(await answer('citizen', callout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
          expect(await answer('owner', callout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        }
        expect(await answersOn(szsCallout)).toEqual([]);
      });
    });
  });

  /*
   * What a call-out id tells somebody who cannot read the call-out.
   *
   * Asked of this phase in review: `submit_response` reads the stored call-out's
   * service before resolving the member, so somebody holding a DVD record gets
   * MEMBER_RECORD_REQUIRED for an SZS call-out and INTERVENTION_NOT_FOUND for
   * an id that matches nothing. That IS a distinguishable answer: one bit,
   * "a call-out of another service has this id".
   *
   * Pinned here rather than changed, for three measured reasons:
   *
   *   - it is the convention P4a documented and P4b follows: a caller with no
   *     standing learns nothing, a caller with standing may learn that an id
   *     belongs to another service (ORGANIZATION_MISMATCH, STAFF_REQUIRED);
   *   - the same bit reaches the same caller through five P4b commands, so
   *     hiding it here alone would buy nothing;
   *   - P4c NARROWED it: before, the refusal also said whether the other
   *     service's call-out was open, closed or a draft (asserted above).
   *
   * Making another service's call-out indistinguishable from no call-out is a
   * decision about every command at once, recorded as an open item in
   * docs/MULTI_ORG_PLAN.md rather than half-made in one function.
   */
  describe('what a call-out id tells somebody who cannot read the call-out', () => {
    it('a DVD record learns that an SZS call-out exists - and nothing about its state', async () => {
      await isolated(async () => {
        for (const callout of [szsCallout, szsClosed, szsDraft]) {
          expect(await answer('dvdFirefighter', callout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        }
        expect(await answer('dvdFirefighter', UNKNOWN, 'DOLAZIM')).toBe('INTERVENTION_NOT_FOUND');
      });
    });

    it('which is the same bit P4b\'s commands already give that caller', async () => {
      await isolated(async () => {
        const dvdFirefighter = people.dvdFirefighter.user;
        for (const callout of [szsCallout, szsClosed, szsDraft]) {
          expect(await act(dvdFirefighter, `select public.set_journey_progress($1, 'KRECEM')`, [callout])).toBe('STAFF_REQUIRED');
          expect(await act(dvdFirefighter, 'select public.acknowledge_intervention($1)', [callout])).toBe('STAFF_REQUIRED');
          expect(await act(dvdFirefighter, 'select public.attendance_check_in($1)', [callout])).toBe('STAFF_REQUIRED');
        }
        expect(await act(dvdFirefighter, `select public.set_journey_progress($1, 'KRECEM')`, [UNKNOWN])).toBe('INTERVENTION_NOT_FOUND');
        expect(await act(dvdFirefighter, 'select public.acknowledge_intervention($1)', [UNKNOWN])).toBe('NOT_A_RECIPIENT');
        expect(await act(dvdFirefighter, 'select public.attendance_check_in($1)', [UNKNOWN])).toBe('INTERVENTION_NOT_FOUND');
      });
    });

    it('an SZS-only record learns nothing about a DVD call-out from this command', async () => {
      await isolated(async () => {
        expect(await answer('szsFirefighter', dvdCallout, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
        expect(await answer('szsFirefighter', UNKNOWN, 'DOLAZIM')).toBe('MEMBER_RECORD_REQUIRED');
      });
    });

    it('somebody serving in both is told about SZS call-outs only what an SZS member is', async () => {
      await isolated(async () => {
        // Within the service they serve in, as a DVD firefighter always was
        // about DVD call-outs not sent to them.
        expect(await answer('dual', szsClosed, 'DOLAZIM')).toBe('INTERVENTION_NOT_OPEN');
        expect(await answer('dual', szsDraft, 'DOLAZIM')).toBe('INTERVENTION_NOT_OPEN');
        expect(await answer('dual', UNKNOWN, 'DOLAZIM')).toBe('INTERVENTION_NOT_FOUND');
      });
    });

    it('nobody without a member record learns anything at all', async () => {
      await isolated(async () => {
        for (const who of ['owner', 'citizen', 'szsSuspended'] as const) {
          for (const callout of [szsCallout, szsClosed, dvdCallout, UNKNOWN]) {
            expect(await answer(who, callout, 'DOLAZIM'), `${who}`).toBe('MEMBER_RECORD_REQUIRED');
          }
        }
      });
    });
  });

  describe('DVD, unchanged', () => {
    it('answers, repeats and revises exactly as before', async () => {
      await isolated(async () => {
        expect(await answer('dvdFirefighter', dvdCallout, 'DOLAZIM', null, true)).toBe('OK');
        expect(await answer('dvdFirefighter', dvdCallout, 'DOLAZIM', null, true)).toBe('OK');
        expect(await answer('dvdFirefighter', dvdCallout, 'DOLAZIM_KASNIJE', 60)).toBe('OK');
        expect(await answersOn(dvdCallout)).toEqual([
          expect.objectContaining({
            member_id: people.dvdFirefighter.dvd,
            organization: 'DVD',
            answer: 'DOLAZIM_KASNIJE',
            eta_minutes: 60,
            direct_to_location: false,
            revision: 2,
            revisions: '1:DOLAZIM:-:DVD,2:DOLAZIM_KASNIJE:60:DVD',
          }),
        ]);
      });
    });
  });

  describe('what an answer reaches', () => {
    it('writes the answer and its revision, and nothing else - no audit, queue or delivery row', async () => {
      await isolated(async () => {
        const before = await tableCounts();
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM')).toBe('OK');
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM_KASNIJE', 15)).toBe('OK');
        expect(changedTables(before, await tableCounts())).toEqual([
          'intervention_response_revisions',
          'intervention_responses',
        ]);
      });
    });

    it('is read by the SZS commander and the call-out\'s recipients, and by nobody in DVD', async () => {
      await isolated(async () => {
        expect(await answer('szsFirefighter', szsCallout, 'DOLAZIM')).toBe('OK');
        expect(await answer('dual', szsCallout, 'NE_MOGU')).toBe('OK');
        expect(await answer('dual', dvdCallout, 'DOLAZIM')).toBe('OK');

        const seen = async (who: Label, table: string) => {
          await db.query('savepoint look');
          await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(people[who].user)]);
          await db.query('set local role authenticated');
          const { rows } = await db.query<{ services: string | null }>(
            `select string_agg(o.code || ':' || n, ',' order by o.code) as services
               from (select organization_id, count(*) as n from public.${table} group by 1) x
               join public.organizations o on o.id = x.organization_id`,
          );
          await db.query('reset role');
          await db.query('release savepoint look');
          return rows[0]!.services ?? '';
        };

        // Answers: command in the service, or a recipient of the call-out.
        expect(await seen('szsCommander', 'intervention_responses')).toBe('SZS:2');
        expect(await seen('szsFirefighter', 'intervention_responses')).toBe('SZS:2');
        expect(await seen('dual', 'intervention_responses')).toBe('DVD:1,SZS:2');
        expect(await seen('dvdCommander', 'intervention_responses')).toBe('DVD:1');
        expect(await seen('dvdFirefighter', 'intervention_responses')).toBe('DVD:1');
        expect(await seen('szsBystander', 'intervention_responses')).toBe('');
        expect(await seen('owner', 'intervention_responses')).toBe('DVD:1,SZS:2');
        // Revisions: command only.
        expect(await seen('szsCommander', 'intervention_response_revisions')).toBe('SZS:2');
        expect(await seen('dvdCommander', 'intervention_response_revisions')).toBe('DVD:1');
        expect(await seen('szsFirefighter', 'intervention_response_revisions')).toBe('');
        expect(await seen('dual', 'intervention_response_revisions')).toBe('');
      });
    });
  });

  describe('the command itself', () => {
    it('keeps its one signature, its grants and its search path', async () => {
      const { rows } = await db.query<{ signature: string; result: string; definer: boolean; config: string; anon: boolean; authenticated: boolean; public_role: boolean }>(
        `select p.oid::regprocedure::text as signature, pg_get_function_result(p.oid) as result, p.prosecdef as definer,
                array_to_string(p.proconfig, ',') as config,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                -- A null ACL is the default one, which lets PUBLIC execute.
                p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_role
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_response'`,
      );
      expect(rows).toEqual([
        {
          signature: 'submit_response(uuid,text,integer,boolean)',
          result: 'void',
          definer: true,
          config: 'search_path=public, pg_temp',
          anon: false,
          authenticated: true,
          public_role: false,
        },
      ]);
    });

    it('asks the call-out\'s own service, and no longer the DVD shim', async () => {
      const { rows } = await db.query<{ body: string }>(
        `select prosrc as body from pg_proc where pronamespace = 'public'::regnamespace and proname = 'submit_response'`,
      );
      expect(rows[0]!.body).toMatch(/current_member_id_in\(/);
      expect(rows[0]!.body).not.toMatch(/current_member_id\(\)/);
    });

    it('is re-created by no other migration, so no replay can put the DVD-only text back', () => {
      const definers = MIGRATIONS.filter((file) =>
        /create\s+(or\s+replace\s+)?function\s+public\.submit_response\s*\(/i.test(sql(file)),
      );
      expect(definers).toEqual(['supabase/migrations/202609090002_internal_operations.sql', RESPONSES]);
    });

    it('is a no-op to apply twice', async () => {
      const body = async () =>
        (await db.query<{ h: string }>(
          `select md5(pg_get_functiondef('public.submit_response(uuid,text,integer,boolean)'::regprocedure)
                      || coalesce(array_to_string(p.proacl, ' '), '')) as h
             from pg_proc p where p.oid = 'public.submit_response(uuid,text,integer,boolean)'::regprocedure`,
        )).rows[0]!.h;
      const before = await body();
      await isolated(async () => {
        await db.query(sql(RESPONSES));
        expect(await body()).toBe(before);
      });
    });
  });
});
