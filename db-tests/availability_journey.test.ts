/**
 * General availability, journey progress, and batch confirmation.
 *
 * The property every test here defends is the one the whole schema exists for:
 * **each of these is its own fact.** Availability is not a response. A response
 * is not journey progress. Journey progress is not attendance. Attendance is
 * not confirmation. Any one of them writing another would recreate the defect
 * `202609130006` was built to remove, so the negative assertions below ("and
 * created nothing else") matter more than the positive ones.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createDraft,
  createMember,
  expectRefused,
  grantRole,
  resetSchema,
} from './harness';

let db: Client;
let commander: string;
let commanderMember: string;
let seq = 0;

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
  const account = await createAccount(db, 'cmd-journey@example.invalid');
  await completeProfile(db, account.userId, 'Ime Komandir');
  await grantRole(db, account.userId, 'COMMANDER');
  commander = account.userId;
  commanderMember = await createMember(db, 'Ime Komandir', account.userId);
}, 60_000);

afterAll(async () => {
  await db?.end();
});

async function freshFirefighter(): Promise<{ userId: string; memberId: string }> {
  seq += 1;
  const account = await createAccount(db, `journey-${seq}-${Date.now()}@example.invalid`);
  await completeProfile(db, account.userId, `Ime Vatrogasac ${seq}`);
  await grantRole(db, account.userId, 'FIREFIGHTER');
  const memberId = await createMember(db, `Ime Vatrogasac ${seq}`, account.userId);
  return { userId: account.userId, memberId };
}

async function publishedTo(members: string[]): Promise<string> {
  const id = await createDraft(db, commander, { key: `journey-${(seq += 1)}-${Date.now()}` });
  await asUserCommitted(db, commander, (client) =>
    client.query('select public.publish_intervention($1, $2)', [id, members]),
  );
  return id;
}

describe('general availability is not a response to anything', () => {
  it('records a member as generally available, with the server time', async () => {
    const ff = await freshFirefighter();
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.set_own_availability(true, $1)', ['Na raspolaganju.']),
    );
    const { rows } = await db.query<{ available: boolean; note: string; changed_by: string }>(
      'select available, note, changed_by from public.member_availability where member_id = $1',
      [ff.memberId],
    );
    expect(rows[0]).toMatchObject({ available: true, note: 'Na raspolaganju.', changed_by: ff.userId });
  });

  it('exists without any intervention, which is the whole point', async () => {
    const ff = await freshFirefighter();
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.set_own_availability(false, $1)', ['Na godisnjem.']),
    );
    // No intervention exists for this member at all, and availability is still
    // a real, readable fact. A commander needs it BEFORE there is a call-out.
    const { rows } = await db.query(
      `select count(*)::int as n from public.intervention_recipients where member_id = $1`,
      [ff.memberId],
    );
    expect(rows[0]!.n).toBe(0);
    const state = await db.query<{ available: boolean }>(
      'select available from public.member_availability where member_id = $1',
      [ff.memberId],
    );
    expect(state.rows[0]!.available).toBe(false);
  });

  it('keeps every change in history, but a repeat is not a change', async () => {
    const ff = await freshFirefighter();
    const set = (available: boolean) =>
      asUserCommitted(db, ff.userId, (client) =>
        client.query('select public.set_own_availability($1, null)', [available]),
      );
    await set(true);
    await set(true); // a repeat: no second history row
    await set(false);
    const { rows } = await db.query<{ previous_available: boolean | null; next_available: boolean }>(
      `select previous_available, next_available from public.member_availability_history
        where member_id = $1 order by changed_at`,
      [ff.memberId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ previous_available: null, next_available: true });
    expect(rows[1]).toMatchObject({ previous_available: true, next_available: false });
  });

  it('cannot be set for somebody else, because there is no such command', async () => {
    // Deliberately not "a commander is refused": the command takes no member
    // parameter at all. Availability is a statement about your own life.
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'set_own_availability'`,
    );
    expect(rows[0]!.args).toBe('requested_available boolean, requested_note text');
  });

  it('refuses an account with no linked member, and an anonymous caller', async () => {
    const account = await createAccount(db, `noavail-${Date.now()}@example.invalid`);
    await completeProfile(db, account.userId, 'Ime Bez Clana');
    await grantRole(db, account.userId, 'FIREFIGHTER');
    const message = await expectRefused(db, account.userId, (client) =>
      client.query('select public.set_own_availability(true, null)'),
    );
    expect(message).toContain('MEMBER_RECORD_REQUIRED');

    const anon = await expectRefused(db, null, (client) =>
      client.query('select public.set_own_availability(true, null)'),
    );
    expect(anon).toMatch(/permission denied/i);
  });
});

describe('journey progress is not a response and never attendance', () => {
  it('records where a member is, and writes NO attendance interval', async () => {
    const ff = await freshFirefighter();
    const intervention = await publishedTo([ff.memberId]);

    for (const progress of ['KRECEM', 'U_PUTU', 'NA_LICU_MJESTA']) {
      await asUserCommitted(db, ff.userId, (client) =>
        client.query('select public.set_journey_progress($1, $2)', [intervention, progress]),
      );
    }

    const journey = await db.query<{ progress: string }>(
      'select progress from public.intervention_journey where intervention_id = $1 and member_id = $2',
      [intervention, ff.memberId],
    );
    expect(journey.rows[0]!.progress).toBe('NA_LICU_MJESTA');

    // THE ASSERTION THIS FILE EXISTS FOR. Saying "I am on scene" must not
    // create a record that the member attended - not even an unverified one.
    const attendance = await db.query(
      'select count(*)::int as n from public.attendance_intervals where member_id = $1',
      [ff.memberId],
    );
    expect(attendance.rows[0]!.n).toBe(0);

    // Nor a response. A position is not an answer.
    const response = await db.query(
      'select count(*)::int as n from public.intervention_responses where member_id = $1',
      [ff.memberId],
    );
    expect(response.rows[0]!.n).toBe(0);
  });

  it('keeps a response and a journey as two separate, both-true records', async () => {
    const ff = await freshFirefighter();
    const intervention = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.submit_response($1, $2, $3, $4)', [
        intervention, 'DOLAZIM_KASNIJE', 30, false,
      ]),
    );
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'U_PUTU']),
    );

    const { rows } = await db.query<{ answer: string; eta_minutes: number; progress: string }>(
      `select r.answer, r.eta_minutes, j.progress
       from public.intervention_responses r
       join public.intervention_journey j
         on j.intervention_id = r.intervention_id and j.member_id = r.member_id
       where r.intervention_id = $1 and r.member_id = $2`,
      [intervention, ff.memberId],
    );
    // "I will be 30 minutes late" and "I am on the way" are both true at once
    // and neither overwrote the other.
    expect(rows[0]).toMatchObject({ answer: 'DOLAZIM_KASNIJE', eta_minutes: 30, progress: 'U_PUTU' });
  });

  it('keeps ODUSTAJEM without rewriting the answer the member gave earlier', async () => {
    const ff = await freshFirefighter();
    const intervention = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.submit_response($1, $2, $3, $4)', [
        intervention, 'DOLAZIM', null, false,
      ]),
    );
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'ODUSTAJEM']),
    );
    const { rows } = await db.query<{ answer: string }>(
      'select answer from public.intervention_responses where intervention_id = $1 and member_id = $2',
      [intervention, ff.memberId],
    );
    // They did answer DOLAZIM, truthfully, at the time. Turning back later does
    // not make that answer a lie, so it stays on the record.
    expect(rows[0]!.answer).toBe('DOLAZIM');
  });

  it('refuses a member who was not called to this intervention', async () => {
    const called = await freshFirefighter();
    const other = await freshFirefighter();
    const intervention = await publishedTo([called.memberId]);
    const message = await expectRefused(db, other.userId, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'KRECEM']),
    );
    expect(message).toContain('NOT_A_RECIPIENT');
  });

  it('refuses an unknown progress value rather than storing it', async () => {
    const ff = await freshFirefighter();
    const intervention = await publishedTo([ff.memberId]);
    const message = await expectRefused(db, ff.userId, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'TELEPORTOVAN']),
    );
    expect(message).toContain('INVALID_PROGRESS');
  });

  it('refuses a withdrawn account and an anonymous caller', async () => {
    const ff = await freshFirefighter();
    const intervention = await publishedTo([ff.memberId]);
    await db.query('update public.access_grants set active = false where user_id = $1', [ff.userId]);
    const suspended = await expectRefused(db, ff.userId, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'KRECEM']),
    );
    expect(suspended).toContain('STAFF_REQUIRED');
    await db.query('update public.access_grants set active = true where user_id = $1', [ff.userId]);

    const anon = await expectRefused(db, null, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'KRECEM']),
    );
    expect(anon).toMatch(/permission denied/i);
  });

  it('records a progress change in the audit and in history, once per change', async () => {
    const ff = await freshFirefighter();
    const intervention = await publishedTo([ff.memberId]);
    const set = (p: string) =>
      asUserCommitted(db, ff.userId, (client) =>
        client.query('select public.set_journey_progress($1, $2)', [intervention, p]),
      );
    await set('KRECEM');
    await set('KRECEM'); // repeat: not a change
    await set('U_PUTU');

    const history = await db.query(
      `select count(*)::int as n from public.intervention_journey_history
        where intervention_id = $1 and member_id = $2`,
      [intervention, ff.memberId],
    );
    expect(history.rows[0]!.n).toBe(2);

    const audit = await db.query(
      `select count(*)::int as n from public.operational_audit
        where intervention_id = $1 and event_type = 'JOURNEY_PROGRESS_SET'`,
      [intervention],
    );
    expect(audit.rows[0]!.n).toBe(2);
  });

  it('lets a fellow recipient see the crew, which is how they coordinate', async () => {
    const a = await freshFirefighter();
    const b = await freshFirefighter();
    const intervention = await publishedTo([a.memberId, b.memberId]);
    await asUserCommitted(db, a.userId, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, 'U_PUTU']),
    );
    const seen = await asUser(db, b.userId, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from public.intervention_journey where intervention_id = $1',
        [intervention],
      );
      return Number(rows[0]!.n);
    });
    expect(seen).toBe(1);
  });
});

describe('batch confirmation: one action, many intervals, no meaningless notes', () => {
  it('confirms many pending intervals in a single call, with no note required', async () => {
    const members: string[] = [];
    const intervention = await publishedTo([commanderMember]);
    for (let i = 0; i < 4; i += 1) {
      const ff = await freshFirefighter();
      members.push(ff.memberId);
      await asUserCommitted(db, commander, (client) =>
        client.query('select public.attendance_check_in($1, $2)', [intervention, ff.memberId]),
      );
    }
    // A second transaction so ended_at > started_at.
    for (const memberId of members) {
      await asUserCommitted(db, commander, (client) =>
        client.query('select public.attendance_check_out($1, $2)', [intervention, memberId]),
      );
    }

    const ids = await db.query<{ id: string }>(
      'select id from public.attendance_intervals where member_id = any($1)',
      [members],
    );
    const intervalIds = ids.rows.map((r) => r.id);
    expect(intervalIds).toHaveLength(4);

    const result = await asUserCommitted(db, commander, async (client) => {
      const { rows } = await client.query<{ interval_id: string; outcome: string }>(
        'select * from public.attendance_confirm_many($1, null)',
        [intervalIds],
      );
      return rows;
    });
    expect(result).toHaveLength(4);
    expect(result.every((r) => r.outcome === 'CONFIRMED')).toBe(true);

    const confirmed = await db.query(
      'select count(*)::int as n from public.attendance_intervals where id = any($1) and verified',
      [intervalIds],
    );
    expect(confirmed.rows[0]!.n).toBe(4);
  }, 60_000);

  it('reports one unconfirmable interval without abandoning the rest', async () => {
    const intervention = await publishedTo([commanderMember]);
    const good = await freshFirefighter();
    const bad = await freshFirefighter();
    for (const m of [good.memberId, bad.memberId]) {
      await asUserCommitted(db, commander, (client) =>
        client.query('select public.attendance_check_in($1, $2)', [intervention, m]),
      );
    }
    for (const m of [good.memberId, bad.memberId]) {
      await asUserCommitted(db, commander, (client) =>
        client.query('select public.attendance_check_out($1, $2)', [intervention, m]),
      );
    }
    const badId = (
      await db.query<{ id: string }>(
        'select id from public.attendance_intervals where member_id = $1',
        [bad.memberId],
      )
    ).rows[0]!.id;
    const goodId = (
      await db.query<{ id: string }>(
        'select id from public.attendance_intervals where member_id = $1',
        [good.memberId],
      )
    ).rows[0]!.id;

    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_reject($1, $2)', [badId, 'Nije bio prisutan.']),
    );

    const result = await asUserCommitted(db, commander, async (client) => {
      const { rows } = await client.query<{ interval_id: string; outcome: string }>(
        'select * from public.attendance_confirm_many($1, null)',
        [[goodId, badId]],
      );
      return rows;
    });
    const byId = new Map(result.map((r) => [r.interval_id, r.outcome]));
    expect(byId.get(goodId)).toBe('CONFIRMED');
    expect(byId.get(badId)).toContain('INTERVAL_REJECTED');

    // The good one really was confirmed: the failure did not roll it back.
    const state = await db.query<{ verified: boolean }>(
      'select verified from public.attendance_intervals where id = $1',
      [goodId],
    );
    expect(state.rows[0]!.verified).toBe(true);
  }, 60_000);

  it('refuses a firefighter and an anonymous caller', async () => {
    const ff = await freshFirefighter();
    const message = await expectRefused(db, ff.userId, (client) =>
      client.query('select * from public.attendance_confirm_many($1, null)', [
        ['00000000-0000-4000-9000-000000000001'],
      ]),
    );
    expect(message).toContain('COMMAND_REQUIRED');

    const anon = await expectRefused(db, null, (client) =>
      client.query('select * from public.attendance_confirm_many($1, null)', [
        ['00000000-0000-4000-9000-000000000001'],
      ]),
    );
    expect(anon).toMatch(/permission denied/i);
  });

  it('refuses an empty batch and an oversized one rather than doing something odd', async () => {
    const empty = await expectRefused(db, commander, (client) =>
      client.query('select * from public.attendance_confirm_many($1, null)', [[]]),
    );
    expect(empty).toContain('NO_INTERVALS');

    const huge = Array.from({ length: 201 }, () => '00000000-0000-4000-9000-000000000001');
    const tooMany = await expectRefused(db, commander, (client) =>
      client.query('select * from public.attendance_confirm_many($1, null)', [huge]),
    );
    expect(tooMany).toContain('TOO_MANY_INTERVALS');
  });
});

describe('the new tables grant no client role a privilege with no policy behind it', () => {
  it('gives anon nothing and authenticated only SELECT on all four', async () => {
    const { rows } = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in ('member_availability','member_availability_history',
                            'intervention_journey','intervention_journey_history')
         and grantee in ('anon','authenticated')
       order by table_name, grantee, privilege_type`,
    );
    expect(rows.filter((r) => r.grantee === 'anon')).toHaveLength(0);
    expect(rows.every((r) => r.privilege_type === 'SELECT')).toBe(true);
    expect(rows).toHaveLength(4);
  });

  it('leaves no new function executable by anon', async () => {
    const { rows } = await db.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('set_own_availability','set_journey_progress','attendance_confirm_many')
         and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);
  });

  it('enables row level security on all four new tables', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace
         and relname in ('member_availability','member_availability_history',
                         'intervention_journey','intervention_journey_history')`,
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});
