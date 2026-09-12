/**
 * Attendance truth: provenance, confirmation, and the two write paths that were
 * missing entirely.
 *
 * The rule this file exists to prove: **a member saying they were somewhere is
 * not a record that they were.** Before `202609130006` it was, because
 * `attendance_totals()` summed every closed interval and `verified` was set as
 * a side effect of a commander correcting the times. A firefighter could check
 * themselves in, a commander could tidy up the clock, and self-declared
 * presence became participation with nobody deciding anything.
 *
 * Also covered here: opening a call-out (which was unrecordable - the table had
 * no write path) and vehicle movements (same).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
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
  const account = await createAccount(db, 'cmd-truth@example.invalid');
  await completeProfile(db, account.userId, 'Ime Komandir');
  await grantRole(db, account.userId, 'COMMANDER');
  commander = account.userId;
  commanderMember = await createMember(db, 'Ime Komandir', account.userId);
}, 60_000);

afterAll(async () => {
  await db?.end();
});

/** A fresh firefighter per test: overlap is enforced per member across all interventions. */
async function freshFirefighter(): Promise<{ userId: string; memberId: string }> {
  seq += 1;
  const account = await createAccount(db, `truth-${seq}-${Date.now()}@example.invalid`);
  await completeProfile(db, account.userId, `Ime Vatrogasac ${seq}`);
  await grantRole(db, account.userId, 'FIREFIGHTER');
  const memberId = await createMember(db, `Ime Vatrogasac ${seq}`, account.userId);
  return { userId: account.userId, memberId };
}

async function publishedTo(members: string[]): Promise<string> {
  const id = await createDraft(db, commander, { key: `truth-${(seq += 1)}-${Date.now()}` });
  await asUserCommitted(db, commander, (client) =>
    client.query('select public.publish_intervention($1, $2)', [id, members]),
  );
  return id;
}

const checkIn = (userId: string, intervention: string, forMember?: string) =>
  asUserCommitted(db, userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select public.attendance_check_in($1, $2) as id',
      [intervention, forMember ?? null],
    );
    return rows[0]!.id;
  });

const stateOf = async (intervalId: string) => {
  const { rows } = await db.query<{
    source: string;
    verified: boolean;
    verified_by: string | null;
    verified_at: Date | null;
    rejected_at: Date | null;
    rejected_by: string | null;
    rejection_reason: string | null;
  }>('select * from public.attendance_intervals where id = $1', [intervalId]);
  return rows[0]!;
};

const auditOf = async (interventionId: string, eventType: string) => {
  const { rows } = await db.query<{ detail: Record<string, unknown>; actor_user_id: string }>(
    `select detail, actor_user_id from public.operational_audit
      where intervention_id = $1 and event_type = $2 order by occurred_at`,
    [interventionId, eventType],
  );
  return rows;
};

describe('where an attendance interval came from', () => {
  it('labels a member checking themselves in as SELF_DECLARED', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    expect((await stateOf(interval)).source).toBe('SELF_DECLARED');
  });

  it('labels a commander recording somebody else as COMMAND_RECORDED', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(commander, id, ff.memberId);
    expect((await stateOf(interval)).source).toBe('COMMAND_RECORDED');
  });

  it('cannot be forged by naming your own member id explicitly', async () => {
    // Provenance is decided inside the command from `auth.uid()`, and there is
    // deliberately no parameter for it: passing your own id must not let you
    // label your own claim as though command had recorded it.
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id, ff.memberId);
    expect((await stateOf(interval)).source).toBe('SELF_DECLARED');
  });

  it('arrives unconfirmed whoever recorded it', async () => {
    // Including a commander's own entry. "I wrote it down" is not "I stand
    // behind it", and collapsing the two is what went wrong before.
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    for (const interval of [
      await checkIn(ff.userId, id),
      await checkIn(commander, id, commanderMember),
    ]) {
      const state = await stateOf(interval);
      expect({ verified: state.verified, rejected_at: state.rejected_at }).toEqual({
        verified: false,
        rejected_at: null,
      });
    }
  });
});

describe('a self-declared claim never counts as participation', () => {
  /** The whole point of the slice, stated as one test. */
  it('stays out of confirmed_seconds until a commander confirms it', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_out($1)', [id]),
    );

    const totals = async () => {
      const { rows } = await db.query<Record<string, string>>(
        'select * from public.attendance_totals() where member_id = $1',
        [ff.memberId],
      );
      return rows[0]!;
    };

    const before = await totals();
    expect(Number(before.confirmed_intervals)).toBe(0);
    expect(Number(before.confirmed_seconds)).toBe(0);
    expect(Number(before.unverified_intervals)).toBe(1);
    expect(Number(before.unverified_seconds)).toBeGreaterThan(0);

    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_confirm($1)', [interval]),
    );

    const after = await totals();
    expect(Number(after.confirmed_intervals)).toBe(1);
    expect(Number(after.confirmed_seconds)).toBeGreaterThan(0);
    expect(Number(after.unverified_intervals)).toBe(0);
    expect(Number(after.unverified_seconds)).toBe(0);
  });

  it('contributes no time at all once rejected', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_out($1)', [id]),
    );
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_reject($1, $2)', [
        interval,
        'Nije bio na intervenciji (vjezba).',
      ]),
    );

    const { rows } = await db.query<Record<string, string>>(
      'select * from public.attendance_totals() where member_id = $1',
      [ff.memberId],
    );
    expect(Number(rows[0]!.confirmed_seconds)).toBe(0);
    expect(Number(rows[0]!.unverified_seconds)).toBe(0);
    expect(Number(rows[0]!.rejected_intervals)).toBe(1);
  });
});

describe('who may confirm, reject or withdraw', () => {
  const COMMANDS: ReadonlyArray<readonly [string, string, unknown[]]> = [
    ['attendance_confirm', 'select public.attendance_confirm($1)', []],
    ['attendance_reject', 'select public.attendance_reject($1, $2)', ['razlog']],
    ['attendance_unconfirm', 'select public.attendance_unconfirm($1, $2)', ['razlog']],
  ];

  it('refuses the firefighter whose own record it is', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);

    for (const [name, sql, extra] of COMMANDS) {
      const message = await expectRefused(db, ff.userId, (client) =>
        client.query(sql, [interval, ...extra]),
      );
      expect(`${name}: ${message.includes('COMMAND_REQUIRED')}`).toBe(`${name}: true`);
    }
  });

  it('refuses an anonymous caller at the privilege layer', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);

    for (const [name, sql, extra] of COMMANDS) {
      const message = await expectRefused(db, null, (client) =>
        client.query(sql, [interval, ...extra]),
      );
      expect(`${name}: ${/permission denied/i.test(message)}`).toBe(`${name}: true`);
    }
  });

  it('requires a reason to reject, but not to confirm', async () => {
    // Rejecting overrides what a member said about their own presence and has
    // to be explainable. Confirmation is the expected outcome, and demanding
    // boilerplate for thirty of them after an incident would produce thirty
    // meaningless strings.
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);

    const noReason = await expectRefused(db, commander, (client) =>
      client.query('select public.attendance_reject($1, $2)', [interval, ' ']),
    );
    expect(noReason).toContain('REASON_REQUIRED');

    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_confirm($1)', [interval]),
    );
    expect((await stateOf(interval)).verified).toBe(true);
  });
});

describe('confirmation is recorded, reversible and cannot contradict itself', () => {
  it('records who confirmed it and when, in the immutable audit', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_confirm($1, $2)', [interval, 'Vidio sam ga.']),
    );

    const state = await stateOf(interval);
    expect(state.verified).toBe(true);
    expect(state.verified_by).toBe(commander);
    expect(state.verified_at).not.toBeNull();

    const audit = await auditOf(id, 'ATTENDANCE_CONFIRMED');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_user_id).toBe(commander);
    expect(audit[0]!.detail).toMatchObject({ source: 'SELF_DECLARED', note: 'Vidio sam ga.' });
  });

  it('treats a repeated confirmation as a retry, not a second decision', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    for (let i = 0; i < 2; i += 1) {
      await asUserCommitted(db, commander, (client) =>
        client.query('select public.attendance_confirm($1)', [interval]),
      );
    }
    expect(await auditOf(id, 'ATTENDANCE_CONFIRMED')).toHaveLength(1);
  });

  it('refuses to reject what has been confirmed, and to confirm what was rejected', async () => {
    const one = await freshFirefighter();
    const idOne = await publishedTo([one.memberId]);
    const confirmed = await checkIn(one.userId, idOne);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_confirm($1)', [confirmed]),
    );
    const rejectConfirmed = await expectRefused(db, commander, (client) =>
      client.query('select public.attendance_reject($1, $2)', [confirmed, 'Promjena misljenja.']),
    );
    expect(rejectConfirmed).toContain('INTERVAL_CONFIRMED');

    const two = await freshFirefighter();
    const idTwo = await publishedTo([two.memberId]);
    const rejected = await checkIn(two.userId, idTwo);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_reject($1, $2)', [rejected, 'Nije bio prisutan.']),
    );
    const confirmRejected = await expectRefused(db, commander, (client) =>
      client.query('select public.attendance_confirm($1)', [rejected]),
    );
    expect(confirmRejected).toContain('INTERVAL_REJECTED');
  });

  it('cannot be both confirmed and rejected, even bypassing the commands', async () => {
    // The constraint is the backstop behind the two refusals above.
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    await expect(
      db.query(
        `update public.attendance_intervals
         set verified = true, verified_at = now(), verified_by = $2,
             rejected_at = now(), rejected_by = $2, rejection_reason = 'oboje'
         where id = $1`,
        [interval, commander],
      ),
    ).rejects.toThrow(/attendance_not_both_states/);
  });

  it('withdraws a confirmation back to pending, not to rejected', async () => {
    // Unsaying "I stand behind this" is not saying "this did not happen".
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const interval = await checkIn(ff.userId, id);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_confirm($1)', [interval]),
    );
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_unconfirm($1, $2)', [
        interval,
        'Pogresno potvrdjeno (vjezba).',
      ]),
    );

    const state = await stateOf(interval);
    expect(state).toMatchObject({ verified: false, verified_by: null, rejected_at: null });
    expect(await auditOf(id, 'ATTENDANCE_UNCONFIRMED')).toHaveLength(1);
  });
});

describe('opening a call-out is not answering it', () => {
  it('records the first opening and never moves the timestamp', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);

    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [id]),
    );
    const first = await db.query<{ opened_at: Date }>(
      'select opened_at from public.intervention_acknowledgements where intervention_id = $1',
      [id],
    );

    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [id]),
    );
    const second = await db.query<{ opened_at: Date; n: string }>(
      `select opened_at, count(*) over () as n
         from public.intervention_acknowledgements where intervention_id = $1`,
      [id],
    );

    // "When did they first see it" must stay answerable.
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]!.opened_at.getTime()).toBe(first.rows[0]!.opened_at.getTime());
  });

  it('creates no response and no attendance', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [id]),
    );

    for (const table of ['intervention_responses', 'attendance_intervals']) {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where intervention_id = $1`,
        [id],
      );
      expect(`${table}: ${rows[0]!.n}`).toBe(`${table}: 0`);
    }
  });

  it('refuses somebody who was not called', async () => {
    const called = await freshFirefighter();
    const outsider = await freshFirefighter();
    const id = await publishedTo([called.memberId]);
    const message = await expectRefused(db, outsider.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [id]),
    );
    expect(message).toContain('NOT_A_RECIPIENT');
  });

  it('refuses an account with no linked member record', async () => {
    const account = await createAccount(db, `noveza-${Date.now()}@example.invalid`);
    await completeProfile(db, account.userId, 'Clan Bez Veze');
    await grantRole(db, account.userId, 'FIREFIGHTER');
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);

    const message = await expectRefused(db, account.userId, (client) =>
      client.query('select public.acknowledge_intervention($1)', [id]),
    );
    expect(message).toContain('MEMBER_RECORD_REQUIRED');
  });
});

describe('vehicle movements, which had no write path at all', () => {
  let vehicleSeq = 0;
  const freshVehicle = async (active = true): Promise<string> => {
    vehicleSeq += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind, active)
       values ($1, 'Izmisljeno vozilo', 'navalno', $2) returning id`,
      [`TV-${vehicleSeq}-${Date.now()}`, active],
    );
    return rows[0]!.id;
  };

  const depart = (userId: string, vehicle: string, intervention?: string) =>
    asUserCommitted(db, userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.record_vehicle_departure($1, $2) as id',
        [vehicle, intervention ?? null],
      );
      return rows[0]!.id;
    });

  it('records a departure and a return with server timestamps', async () => {
    const vehicle = await freshVehicle();
    const movement = await depart(commander, vehicle);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.record_vehicle_return($1)', [movement]),
    );

    const { rows } = await db.query<{ departed_at: Date; returned_at: Date; returned_by: string }>(
      'select departed_at, returned_at, returned_by from public.vehicle_movements where id = $1',
      [movement],
    );
    expect(rows[0]!.returned_at.getTime()).toBeGreaterThanOrEqual(rows[0]!.departed_at.getTime());
    expect(rows[0]!.returned_by).toBe(commander);
  });

  it('refuses sending a vehicle out twice', async () => {
    const vehicle = await freshVehicle();
    await depart(commander, vehicle);
    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.record_vehicle_departure($1, null)', [vehicle]),
    );
    expect(message).toContain('VEHICLE_ALREADY_OUT');
  });

  it('refuses returning a vehicle twice, and an unknown movement', async () => {
    const vehicle = await freshVehicle();
    const movement = await depart(commander, vehicle);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.record_vehicle_return($1)', [movement]),
    );

    const twice = await expectRefused(db, commander, (client) =>
      client.query('select public.record_vehicle_return($1)', [movement]),
    );
    expect(twice).toContain('VEHICLE_ALREADY_RETURNED');

    const unknown = await expectRefused(db, commander, (client) =>
      client.query('select public.record_vehicle_return($1)', [
        '00000000-0000-0000-0000-000000000000',
      ]),
    );
    expect(unknown).toContain('MOVEMENT_NOT_FOUND');
  });

  it('refuses a vehicle that is out of service', async () => {
    const vehicle = await freshVehicle(false);
    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.record_vehicle_departure($1, null)', [vehicle]),
    );
    expect(message).toContain('VEHICLE_NOT_IN_SERVICE');
  });

  it('creates no attendance, for anybody', async () => {
    // One of the separate facts: a vehicle leaving says nothing about who is in it.
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const vehicle = await freshVehicle();
    await depart(commander, vehicle, id);

    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.attendance_intervals where intervention_id = $1',
      [id],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses an unapproved account and an anonymous caller', async () => {
    const vehicle = await freshVehicle();
    const pending = await createAccount(db, `cekanje-${Date.now()}@example.invalid`);
    await completeProfile(db, pending.userId, 'Ime Na Cekanju');

    const unapproved = await expectRefused(db, pending.userId, (client) =>
      client.query('select public.record_vehicle_departure($1, null)', [vehicle]),
    );
    expect(unapproved).toContain('STAFF_REQUIRED');

    const anonymous = await expectRefused(db, null, (client) =>
      client.query('select public.record_vehicle_departure($1, null)', [vehicle]),
    );
    expect(anonymous).toMatch(/permission denied/i);
  });
});

describe('the new commands change nothing else', () => {
  it('leaves no function in public executable by anon', async () => {
    const { rows } = await db.query<{ fn: string }>(
      `select p.proname as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where not exists (
          select 1 from pg_depend d
           where d.objid = p.oid and d.deptype = 'e'
        )
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by p.proname`,
    );
    expect(rows.map((row) => row.fn)).toEqual([]);
  });
});
