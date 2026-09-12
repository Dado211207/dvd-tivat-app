/**
 * Verified attendance records - the primary new capability.
 *
 * The questions this has to answer reliably: who actually attended, at which
 * intervention, when they arrived, when they left, how long each interval
 * lasted, and who corrected the record and why. Duration is never stored and
 * never derived from anything a person can retype; it is the sum of closed
 * intervals over trusted server timestamps.
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
  const account = await createAccount(db, 'cmd-att@example.invalid');
  await completeProfile(db, account.userId, 'Ime Komandir');
  await grantRole(db, account.userId, 'COMMANDER');
  commander = account.userId;
  commanderMember = await createMember(db, 'Ime Komandir', account.userId);
}, 60_000);

afterAll(async () => {
  await db?.end();
});

/**
 * A fresh firefighter per test. Overlap is enforced per member across all
 * interventions, so tests must not share one.
 */
async function freshFirefighter(): Promise<{ userId: string; memberId: string }> {
  seq += 1;
  const account = await createAccount(db, `ff-${seq}-${Date.now()}@example.invalid`);
  await completeProfile(db, account.userId, `Ime Vatrogasac ${seq}`);
  await grantRole(db, account.userId, 'FIREFIGHTER');
  const memberId = await createMember(db, `Ime Vatrogasac ${seq}`, account.userId);
  return { userId: account.userId, memberId };
}

async function publishedTo(members: string[]): Promise<string> {
  const id = await createDraft(db, commander, { key: `att-${(seq += 1)}-${Date.now()}` });
  await asUserCommitted(db, commander, (client) =>
    client.query('select public.publish_intervention($1, $2)', [id, members]),
  );
  return id;
}

const intervalsOf = async (interventionId: string, memberId: string) => {
  const { rows } = await db.query(
    `select id, started_at, ended_at from public.attendance_intervals
     where intervention_id = $1 and member_id = $2 order by started_at`,
    [interventionId, memberId],
  );
  return rows;
};

describe('check in and out', () => {
  it('records an open interval on check-in and closes it on check-out', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);

    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );
    let rows = await intervalsOf(id, ff.memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ended_at).toBeNull();

    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_out($1)', [id]),
    );
    rows = await intervalsOf(id, ff.memberId);
    expect(rows[0]!.ended_at).not.toBeNull();
    expect(new Date(rows[0]!.ended_at).getTime()).toBeGreaterThan(
      new Date(rows[0]!.started_at).getTime(),
    );
  });

  it('allows several intervals when somebody leaves and comes back', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);

    for (let round = 0; round < 3; round += 1) {
      await asUserCommitted(db, ff.userId, (client) =>
        client.query('select public.attendance_check_in($1)', [id]),
      );
      await asUserCommitted(db, ff.userId, (client) =>
        client.query('select public.attendance_check_out($1)', [id]),
      );
    }

    const rows = await intervalsOf(id, ff.memberId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.ended_at !== null)).toBe(true);
  });

  it('refuses a second check-in while one is still open', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );
    const message = await expectRefused(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );
    expect(message).toContain('ALREADY_CHECKED_IN');
  });

  it('refuses overlapping attendance at two different interventions', async () => {
    // A person cannot be in two places at once. The rule is enforced per member
    // ACROSS interventions, so participation hours cannot be double-counted.
    const ff = await freshFirefighter();
    const first = await publishedTo([ff.memberId]);
    const second = await publishedTo([ff.memberId]);

    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [first]),
    );
    const message = await expectRefused(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [second]),
    );
    expect(message).toContain('ALREADY_CHECKED_IN');
  });

  it('refuses a check-out without a check-in', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const message = await expectRefused(db, ff.userId, (client) =>
      client.query('select public.attendance_check_out($1)', [id]),
    );
    expect(message).toContain('NOT_CHECKED_IN');
  });

  it('refuses attendance on a draft or a closed intervention', async () => {
    const ff = await freshFirefighter();
    const draft = await createDraft(db, commander, { key: `draft-${Date.now()}` });
    expect(
      await expectRefused(db, ff.userId, (client) =>
        client.query('select public.attendance_check_in($1)', [draft]),
      ),
    ).toContain('INTERVENTION_NOT_OPEN');

    const closed = await publishedTo([ff.memberId]);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [closed, 'CLOSED', 'Kraj.']),
    );
    expect(
      await expectRefused(db, ff.userId, (client) =>
        client.query('select public.attendance_check_in($1)', [closed]),
      ),
    ).toContain('INTERVENTION_NOT_OPEN');
  });

  it('refuses an interval that ends before it starts, at the constraint level', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await expect(
      db.query(
        `insert into public.attendance_intervals(
           intervention_id, member_id, started_at, ended_at, recorded_by)
         values ($1, $2, now(), now() - interval '1 hour', $3)`,
        [id, ff.memberId, commander],
      ),
    ).rejects.toThrow(/attendance_interval_order/);
  });
});

describe('command acting for somebody else', () => {
  it('lets command check a member in when self-service is impractical', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_check_in($1, $2, $3, $4, null)', [
        id,
        ff.memberId,
        'Ekipa 1',
        'Nosilac IDA',
      ]),
    );
    const rows = await intervalsOf(id, ff.memberId);
    expect(rows).toHaveLength(1);
    const { rows: detail } = await db.query(
      'select crew, task_role, recorded_by from public.attendance_intervals where id = $1',
      [rows[0]!.id],
    );
    expect(detail[0]).toMatchObject({
      crew: 'Ekipa 1',
      task_role: 'Nosilac IDA',
      recorded_by: commander,
    });
  });

  it('refuses a firefighter checking somebody else in', async () => {
    const actor = await freshFirefighter();
    const victim = await freshFirefighter();
    const id = await publishedTo([actor.memberId, victim.memberId]);
    const message = await expectRefused(db, actor.userId, (client) =>
      client.query('select public.attendance_check_in($1, $2)', [id, victim.memberId]),
    );
    expect(message).toContain('COMMAND_REQUIRED');
  });

  it('refuses a firefighter checking somebody else out', async () => {
    const actor = await freshFirefighter();
    const victim = await freshFirefighter();
    const id = await publishedTo([actor.memberId, victim.memberId]);
    await asUserCommitted(db, victim.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );
    const message = await expectRefused(db, actor.userId, (client) =>
      client.query('select public.attendance_check_out($1, $2)', [id, victim.memberId]),
    );
    expect(message).toContain('COMMAND_REQUIRED');
  });
});

describe('duration', () => {
  it('is the sum of closed intervals and reports open ones separately', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);

    // Two closed intervals of known length, written through the correction
    // path so the arithmetic is checkable, plus one still open.
    const first = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });
    await asUserCommitted(db, commander, (client) =>
      client.query(
        `select public.attendance_correct($1, now() - interval '3 hours', now() - interval '1 hour', $2)`,
        [first, 'Unos poslije intervencije.'],
      ),
    );

    const second = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });
    await asUserCommitted(db, commander, (client) =>
      client.query(
        `select public.attendance_correct($1, now() - interval '50 minutes', now() - interval '20 minutes', $2)`,
        [second, 'Unos poslije intervencije.'],
      ),
    );

    // A third, still open.
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );

    const totals = async () => {
      const { rows } = await db.query<{
        confirmed_intervals: string;
        confirmed_seconds: string;
        unverified_intervals: string;
        unverified_seconds: string;
        open_intervals: string;
      }>(`select * from public.attendance_totals() where member_id = $1`, [ff.memberId]);
      return rows[0]!;
    };

    // Corrected, but NOT confirmed by anybody. Two closed intervals of 2h and
    // 30m, and one still open.
    const beforeConfirmation = await totals();
    expect(Number(beforeConfirmation.unverified_intervals)).toBe(2);
    expect(Number(beforeConfirmation.unverified_seconds)).toBeCloseTo(2 * 3600 + 30 * 60, 0);
    // The point of this slice: a corrected self-declared claim is still not
    // participation. Nothing may read it as confirmed time.
    expect(Number(beforeConfirmation.confirmed_intervals)).toBe(0);
    expect(Number(beforeConfirmation.confirmed_seconds)).toBe(0);
    // The open interval is visible as open and contributes nothing.
    expect(Number(beforeConfirmation.open_intervals)).toBe(1);

    // A commander stands behind one of them. Only then does it count.
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.attendance_confirm($1)', [first]),
    );
    const afterConfirmation = await totals();
    expect(Number(afterConfirmation.confirmed_intervals)).toBe(1);
    expect(Number(afterConfirmation.confirmed_seconds)).toBeCloseTo(2 * 3600, 0);
    expect(Number(afterConfirmation.unverified_intervals)).toBe(1);
    expect(Number(afterConfirmation.unverified_seconds)).toBeCloseTo(30 * 60, 0);
  });

  it('counts nothing for a member who only responded', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    const { rows } = await db.query(
      'select count(*)::int as n from public.attendance_totals() where member_id = $1',
      [ff.memberId],
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe('corrections', () => {
  it('requires a reason and preserves before and after immutably', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const intervalId = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });

    expect(
      await expectRefused(db, commander, (client) =>
        client.query('select public.attendance_correct($1, null, now(), $2)', [intervalId, ' ']),
      ),
    ).toContain('REASON_REQUIRED');

    const before = await db.query('select started_at from public.attendance_intervals where id = $1', [
      intervalId,
    ]);

    await asUserCommitted(db, commander, (client) =>
      client.query(
        `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', $2)`,
        [intervalId, 'Clan je zaboravio da se odjavi.'],
      ),
    );

    const { rows } = await db.query(
      `select before_value, after_value, reason, corrected_by
       from public.attendance_corrections where interval_id = $1`,
      [intervalId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('Clan je zaboravio da se odjavi.');
    expect(rows[0]!.corrected_by).toBe(commander);
    // Compare instants, not renderings: PostgreSQL keeps microseconds and
    // writes "+00:00", JavaScript keeps milliseconds and writes "Z".
    expect(new Date(rows[0]!.before_value.started_at).getTime()).toBe(
      (before.rows[0]!.started_at as Date).getTime(),
    );
    expect(rows[0]!.after_value.ended_at).not.toBeNull();

    // A correction is NOT a confirmation. The previous version of this
    // assertion expected `verified: true` here, which pinned the defect this
    // slice removes: `attendance_correct` used to confirm as a side effect, so
    // fixing a forgotten checkout time silently turned a self-declared claim
    // into participation. Correcting the record and standing behind it are two
    // different acts by the same commander, and each is now its own command.
    const state = await db.query(
      'select verified, verified_by, rejected_at from public.attendance_intervals where id = $1',
      [intervalId],
    );
    expect(state.rows[0]).toMatchObject({
      verified: false,
      verified_by: null,
      rejected_at: null,
    });
  });

  it('refuses a firefighter correcting a record', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const intervalId = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });
    const message = await expectRefused(db, ff.userId, (client) =>
      client.query('select public.attendance_correct($1, null, now(), $2)', [
        intervalId,
        'Hocu da izmijenim.',
      ]),
    );
    expect(message).toContain('COMMAND_REQUIRED');
  });

  it('refuses a correction that would create an impossible interval', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const intervalId = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });
    const message = await expectRefused(db, commander, (client) =>
      client.query(
        `select public.attendance_correct($1, now(), now() - interval '1 hour', $2)`,
        [intervalId, 'Neispravno.'],
      ),
    );
    expect(message).toContain('INVALID_INTERVAL');
  });

  it('refuses a correction that would overlap another interval', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);

    const first = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });
    await asUserCommitted(db, commander, (client) =>
      client.query(
        `select public.attendance_correct($1, now() - interval '5 hours', now() - interval '4 hours', $2)`,
        [first, 'Prvi interval.'],
      ),
    );
    const second = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });

    // Stretching the second interval back over the first must be refused.
    const message = await expectRefused(db, commander, (client) =>
      client.query(
        `select public.attendance_correct($1, now() - interval '6 hours', now(), $2)`,
        [second, 'Preklapanje.'],
      ),
    );
    expect(message).toContain('CORRECTION_WOULD_OVERLAP');
  });

  it('lets a firefighter request a correction of their own record only', async () => {
    const ff = await freshFirefighter();
    const other = await freshFirefighter();
    const id = await publishedTo([ff.memberId, other.memberId]);

    const own = await asUserCommitted(db, ff.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });
    const foreign = await asUserCommitted(db, other.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.attendance_check_in($1) as id',
        [id],
      );
      return rows[0]!.id;
    });

    await asUserCommitted(db, ff.userId, (client) =>
      client.query(
        `insert into public.attendance_correction_requests(interval_id, requested_by, message)
         values ($1, $2, $3)`,
        [own, ff.userId, 'Otisao sam ranije.'],
      ),
    );

    const message = await expectRefused(db, ff.userId, (client) =>
      client.query(
        `insert into public.attendance_correction_requests(interval_id, requested_by, message)
         values ($1, $2, $3)`,
        [foreign, ff.userId, 'Mijenjam tudje.'],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });
});

describe('closing with open attendance', () => {
  it('refuses a silent close and never invents a checkout time', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );

    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [id, 'CLOSED', 'Zavrseno.']),
    );
    expect(message).toContain('OPEN_ATTENDANCE_INTERVALS:1');

    // Still open, still honest.
    const rows = await intervalsOf(id, ff.memberId);
    expect(rows[0]!.ended_at).toBeNull();
  });

  it('closes when command explicitly acknowledges the open intervals', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );

    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3, true)', [
        id,
        'CLOSED',
        'Zavrseno, intervali ostaju otvoreni za ispravku.',
      ]),
    );

    const { rows } = await db.query('select status from public.interventions where id = $1', [id]);
    expect(rows[0]!.status).toBe('CLOSED');
    // The interval is left open rather than given a made-up end time.
    const intervals = await intervalsOf(id, ff.memberId);
    expect(intervals[0]!.ended_at).toBeNull();

    const audit = await db.query(
      `select detail from public.operational_audit
       where intervention_id = $1 and event_type = 'INTERVENTION_CLOSED'`,
      [id],
    );
    expect(audit.rows[0]!.detail.open_attendance).toBe(1);
  });
});

describe('vehicles stay independent of attendance', () => {
  it('a vehicle departure creates no attendance', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const { rows: vehicle } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind) values ($1, 'Navalno vozilo', 'Navalno')
       returning id`,
      [`NV-${(seq += 1)}`],
    );
    await db.query(
      `insert into public.vehicle_movements(vehicle_id, intervention_id, departed_by)
       values ($1, $2, $3)`,
      [vehicle[0]!.id, id, commander],
    );

    const { rows } = await db.query(
      'select count(*)::int as n from public.attendance_intervals where intervention_id = $1',
      [id],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses the same vehicle being out twice at once', async () => {
    const { rows: vehicle } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind) values ($1, 'Auto-cisterna', 'Cisterna')
       returning id`,
      [`AC-${(seq += 1)}`],
    );
    await db.query(
      `insert into public.vehicle_movements(vehicle_id, departed_by) values ($1, $2)`,
      [vehicle[0]!.id, commander],
    );
    await expect(
      db.query(`insert into public.vehicle_movements(vehicle_id, departed_by) values ($1, $2)`, [
        vehicle[0]!.id,
        commander,
      ]),
    ).rejects.toThrow(/vehicle_movement_no_overlap/);
  });

  it('allows a return after the intervention is closed', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    const { rows: vehicle } = await db.query<{ id: string }>(
      `insert into public.vehicles(callsign, name, kind) values ($1, 'Tehnicko vozilo', 'Tehnicko')
       returning id`,
      [`TV-${(seq += 1)}`],
    );
    const { rows: movement } = await db.query<{ id: string }>(
      `insert into public.vehicle_movements(vehicle_id, intervention_id, departed_by)
       values ($1, $2, $3) returning id`,
      [vehicle[0]!.id, id, commander],
    );
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [id, 'CLOSED', 'Kraj.']),
    );

    // A forgotten return has to remain closable, exactly as on a station board.
    await db.query(
      `update public.vehicle_movements set returned_at = now(), returned_by = $2 where id = $1`,
      [movement[0]!.id, commander],
    );
    const { rows } = await db.query(
      'select returned_at from public.vehicle_movements where id = $1',
      [movement[0]!.id],
    );
    expect(rows[0]!.returned_at).not.toBeNull();
  });
});

describe('reading attendance', () => {
  it('lets a called member see the intervention board but not an unrelated one', async () => {
    const mine = await freshFirefighter();
    const stranger = await freshFirefighter();
    const myIntervention = await publishedTo([mine.memberId]);
    const otherIntervention = await publishedTo([stranger.memberId]);

    await asUserCommitted(db, mine.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [myIntervention]),
    );
    await asUserCommitted(db, stranger.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [otherIntervention]),
    );

    const visible = await asUser(db, mine.userId, async (client) => {
      const { rows } = await client.query<{ intervention_id: string }>(
        'select distinct intervention_id from public.attendance_intervals',
      );
      return rows.map((r) => r.intervention_id);
    });
    expect(visible).toContain(myIntervention);
    expect(visible).not.toContain(otherIntervention);
  });

  it('hides attendance from an unapproved account', async () => {
    const ff = await freshFirefighter();
    const id = await publishedTo([ff.memberId]);
    await asUserCommitted(db, ff.userId, (client) =>
      client.query('select public.attendance_check_in($1)', [id]),
    );

    const pendingAccount = await createAccount(db, `pending-${Date.now()}@example.invalid`);
    await completeProfile(db, pendingAccount.userId, 'Ime Neodobren');

    const count = await asUser(db, pendingAccount.userId, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from public.attendance_intervals',
      );
      return Number(rows[0]!.n);
    });
    expect(count).toBe(0);
  });
});

// commanderMember exists so the commander has a member record for self-actions.
void commanderMember;
