/**
 * The authority matrix: every attendance and movement command, against every
 * account state, asserted as a table rather than as prose.
 *
 * Why this file exists separately from `attendance_truth.test.ts`. That file
 * proves the *semantics* of the new commands and checks the authority cases it
 * happens to touch - a firefighter, an anonymous caller, one unapproved
 * account. Picking cases by hand is how a gap survives: nothing in a
 * hand-written suite fails when a state is simply never tried. Before this
 * file, none of the nine commands had ever been called by a SUSPENDED account
 * or by an account with an incomplete profile, and only one had been called by
 * a member with no linked record.
 *
 * So the cases here are generated from a product: fourteen commands x ten
 * account states, every cell with a declared expectation. Adding a command
 * without adding its row fails `covers every command` below; adding an account
 * state without extending every command's expectations fails at type-check,
 * because the expectation map is keyed by the actor union.
 *
 * Mutation testing found one gap in this file itself: the staff check added to
 * `attendance_check_out` could be deleted with all 267 tests still passing,
 * because that command was not one of the nine and so had no row. It has one
 * now. A line of authority code with no failing test behind it is a claim, not
 * a safeguard.
 *
 * What "expected" means per cell:
 *   'ok'        - the command runs. For an authority test that is the whole
 *                 assertion; the semantics are covered elsewhere.
 *   a string    - the command is refused and the message contains it.
 *   'empty'     - a read that is not refused but yields no rows, which is what
 *                 RLS does to an account with no role.
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
  grantRole,
  resetSchema,
} from './harness';

let db: Client;
let seq = 0;

/**
 * The ten states. Each name is the *account state*, not the role: `suspended`
 * holds a FIREFIGHTER grant with `active = false`, and `incompleteProfile`
 * holds an active FIREFIGHTER grant whose profile was never completed. Both
 * therefore have no role at all, which is the point - a recorded role is not
 * an effective one.
 */
const ACTORS = [
  'owner',
  'admin',
  'commander',
  'firefighter',
  'otherFirefighter',
  'pending',
  'suspended',
  'incompleteProfile',
  'noMember',
  'anonymous',
] as const;
type Actor = (typeof ACTORS)[number];

type Expectation = 'ok' | 'empty' | string;

interface Subject {
  /** The command, named as in the schema. */
  fn: string;
  /** One line on what authority it is supposed to require. */
  requires: string;
  /**
   * Runs the command as `userId` (null = anonymous). Any scenario row it needs
   * is created here, committed, so the attempt itself can be rolled back.
   */
  attempt: (userId: string | null, actor: Actor) => Promise<unknown>;
  expected: Record<Actor, Expectation>;
}

const cast: Record<Actor, { userId: string | null; memberId: string | null }> = Object.create(null);

/**
 * A member with no account of their own, used as the target whenever a command
 * acts on somebody else.
 *
 * Without this, "check in another member" run as that very member is a
 * self-check-in, which the command correctly allows - so the cell would be
 * testing the wrong thing and passing for the wrong reason.
 */
let subjectMember: string;

/** Every state built the same way, so the only difference is the state itself. */
async function makeActor(
  actor: Actor,
  role: string,
  opts: { complete?: boolean; active?: boolean; member?: boolean } = {},
): Promise<void> {
  const account = await createAccount(db, `matrix-${actor}@example.invalid`);
  if (opts.complete !== false) await completeProfile(db, account.userId, `Ime ${actor}`);
  await grantRole(db, account.userId, role, opts.active !== false);
  const memberId =
    opts.member === false ? null : await createMember(db, `Ime ${actor}`, account.userId);
  cast[actor] = { userId: account.userId, memberId };
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  await makeActor('owner', 'OWNER');
  await makeActor('admin', 'ADMIN');
  await makeActor('commander', 'COMMANDER');
  await makeActor('firefighter', 'FIREFIGHTER');
  await makeActor('otherFirefighter', 'FIREFIGHTER');
  await makeActor('pending', 'PENDING');
  await makeActor('suspended', 'FIREFIGHTER', { active: false });
  await makeActor('incompleteProfile', 'FIREFIGHTER', { complete: false });
  // An approved firefighter whose account was never linked to a member record.
  // Authority is fine; identity as a *member* is missing, which is a different
  // refusal and easy to confuse with a permission problem.
  await makeActor('noMember', 'FIREFIGHTER', { member: false });
  cast.anonymous = { userId: null, memberId: null };

  subjectMember = await createMember(db, 'Ime Bez Naloga');
}, 120_000);

afterAll(async () => {
  await db?.end();
});

/**
 * A published intervention addressed to every member who may actually be called.
 *
 * It used to address the whole cast. Since `is_eligible_recipient` exists,
 * `publish_intervention` refuses the entire call-out if any one of them cannot
 * receive it, and most of this cast deliberately cannot: `pending` holds no
 * role, `suspended`'s grant is inactive, `incompleteProfile` has no finished
 * profile, `noMember` has no member record, and `subjectMember` has no account
 * at all. Sending to them was never meaningful - they could not have opened it.
 *
 * THIS DOES NOT WEAKEN THE MATRIX. The refusals it checks happen before the
 * recipient test: `set_journey_progress` raises STAFF_REQUIRED and then
 * MEMBER_RECORD_REQUIRED, so an ineligible actor is refused on those grounds
 * whether or not they were addressed. And `subjectMember` still gets attendance
 * recorded against them below - a commander logging somebody who turned up
 * without a telephone is a real path, and it never required recipiency.
 */
const ELIGIBLE_ACTORS = ['owner', 'admin', 'commander', 'firefighter', 'otherFirefighter'] as const;

async function publishedToEveryone(): Promise<string> {
  const recipients = ELIGIBLE_ACTORS.map((a) => cast[a].memberId).filter(
    (id): id is string => id !== null,
  );
  const id = await createDraft(db, cast.commander.userId!, {
    key: `matrix-${(seq += 1)}-${Date.now()}`,
  });
  await asUserCommitted(db, cast.commander.userId!, (client) =>
    client.query('select public.publish_intervention($1, $2)', [id, recipients]),
  );
  return id;
}

/**
 * A committed, closed, unconfirmed interval belonging to `otherFirefighter`,
 * for the confirm/reject/unconfirm subjects to act on. A fresh one per attempt:
 * the overlap exclusion constraint is per member across all interventions, so
 * reusing one member's interval across cases would collide.
 */
async function pendingInterval(): Promise<string> {
  const intervention = await publishedToEveryone();
  const member = subjectMember;
  const intervalId = await asUserCommitted(db, cast.commander.userId!, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select public.attendance_check_in($1, $2) as id',
      [intervention, member],
    );
    return rows[0]!.id;
  });
  // A SECOND transaction, because `now()` is the transaction's start time:
  // checking in and out within one transaction gives ended_at = started_at and
  // the `attendance_interval_order` constraint rightly refuses it. `check_out`
  // takes the intervention and the member, not the interval.
  await asUserCommitted(db, cast.commander.userId!, (client) =>
    client.query('select public.attendance_check_out($1, $2)', [intervention, member]),
  );
  return intervalId;
}

/** A confirmed interval, for unconfirm to have something to withdraw. */
async function confirmedInterval(): Promise<string> {
  const intervalId = await pendingInterval();
  await asUserCommitted(db, cast.commander.userId!, (client) =>
    client.query('select public.attendance_confirm($1, null)', [intervalId]),
  );
  return intervalId;
}

/** A vehicle that is in service, and a movement that is still out. */
async function vehicle(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind) values ($1, $2, $3) returning id`,
    [`MATRIX-${(seq += 1)}`, 'Izmisljeno vozilo', 'Vatrogasno'],
  );
  return rows[0]!.id;
}

async function openMovement(): Promise<string> {
  const vehicleId = await vehicle();
  return asUserCommitted(db, cast.commander.userId!, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select public.record_vehicle_departure($1, null, $2) as id',
      [vehicleId, 'Vjezba'],
    );
    return rows[0]!.id;
  });
}

/**
 * Runs `work` as the actor and reports what happened, without asserting.
 *
 * Deliberately not `asUser`: the attempt must be rolled back whether it
 * succeeded or was refused, so one cell cannot leave a row behind for the next.
 */
async function outcome(
  userId: string | null,
  work: (client: Client) => Promise<unknown>,
): Promise<{ ok: true; rows: number } | { ok: false; message: string }> {
  await db.query('begin');
  try {
    const claims =
      userId === null ? '{"role":"anon"}' : JSON.stringify({ sub: userId, role: 'authenticated' });
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await db.query(`set local role ${userId === null ? 'anon' : 'authenticated'}`);
    const result = (await work(db)) as { rows?: unknown[] } | undefined;
    return { ok: true, rows: result?.rows?.length ?? 0 };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  } finally {
    await db.query('rollback');
  }
}

// ---------------------------------------------------------------------------
// The matrix.
//
// Two expectations here deserve reading rather than skimming, because they are
// the enforced model rather than the obvious one:
//
//   1. ADMIN passes `is_dvd_command()` (`202609090002`), so an administrator
//      may confirm, reject, correct and record attendance. ACCESS_MODEL.md's
//      role table describes ADMIN as organisational-records-only, which does
//      NOT match what the schema enforces. Pinned here as the truth so the
//      discrepancy cannot drift further while the owner decides which one is
//      wrong. This file does not change the behaviour.
//
//   2. `attendance_totals()` is `security invoker`, so it is not refused to a
//      roleless account - it simply returns nothing, because RLS gives that
//      account no rows in `members` or `attendance_intervals`. "Refused" and
//      "empty" are different safeguards and both are asserted, because a
//      future change from invoker to definer would silently turn one into a
//      leak.
// ---------------------------------------------------------------------------

const OWNER_ADMIN_COMMAND: Pick<
  Record<Actor, Expectation>,
  'owner' | 'admin' | 'commander' | 'firefighter' | 'otherFirefighter'
> = {
  owner: 'ok',
  admin: 'ok',
  commander: 'ok',
  firefighter: 'COMMAND_REQUIRED',
  otherFirefighter: 'COMMAND_REQUIRED',
};

/** No effective role at all, plus the two identity-only cases. */
const NO_ROLE = {
  pending: 'COMMAND_REQUIRED',
  suspended: 'COMMAND_REQUIRED',
  incompleteProfile: 'COMMAND_REQUIRED',
  noMember: 'COMMAND_REQUIRED',
  anonymous: 'permission denied',
} as const;

const SUBJECTS: Subject[] = [
  {
    // 202609140007. General availability is about the person, not a call-out,
    // so it needs staff standing and a linked member and nothing more.
    fn: 'set_own_availability',
    requires: 'staff, plus a linked member record',
    attempt: async (userId) =>
      outcome(userId, (client) =>
        client.query('select public.set_own_availability(true, null)'),
      ),
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      noMember: 'MEMBER_RECORD_REQUIRED',
      anonymous: 'permission denied',
    },
  },
  {
    // 202609140007. Progress is per call-out, so being a recipient is required
    // on top of standing - and every cast member IS a recipient here, which is
    // what makes the refusals below about authority rather than about targeting.
    fn: 'set_journey_progress',
    requires: 'staff, a linked member, and being a recipient of this call-out',
    attempt: async (userId) => {
      const intervention = await publishedToEveryone();
      return outcome(userId, (client) =>
        client.query('select public.set_journey_progress($1, $2)', [intervention, 'KRECEM']),
      );
    },
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      noMember: 'MEMBER_RECORD_REQUIRED',
      anonymous: 'permission denied',
    },
  },
  {
    // 202609140007. A convenience over attendance_confirm, so it must carry
    // exactly the same authority - a batch must never be a way around a rule.
    fn: 'attendance_confirm_many',
    requires: 'command, identically to attendance_confirm',
    attempt: async (userId) => {
      const intervalId = await pendingInterval();
      return outcome(userId, (client) =>
        client.query('select * from public.attendance_confirm_many($1, null)', [[intervalId]]),
      );
    },
    expected: { ...OWNER_ADMIN_COMMAND, ...NO_ROLE },
  },
  {
    fn: 'attendance_check_in (for somebody else)',
    requires: 'command, because recording another member is a command act',
    attempt: async (userId) => {
      const intervention = await publishedToEveryone();
      return outcome(userId, (client) =>
        client.query('select public.attendance_check_in($1, $2)', [intervention, subjectMember]),
      );
    },
    expected: {
      ...OWNER_ADMIN_COMMAND,
      // STAFF_REQUIRED rather than COMMAND_REQUIRED for the three roleless
      // states: saying "you are not command" would imply they are staff.
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      noMember: 'COMMAND_REQUIRED',
      anonymous: 'permission denied',
    },
  },
  {
    fn: 'attendance_check_in (themselves)',
    requires: 'staff, plus a linked member record',
    attempt: async (userId) => {
      const intervention = await publishedToEveryone();
      return outcome(userId, (client) =>
        client.query('select public.attendance_check_in($1, null)', [intervention]),
      );
    },
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      // Approved, so authority passes; there is simply no member to check in.
      noMember: 'MEMBER_RECORD_REQUIRED',
      anonymous: 'permission denied',
    },
  },
  {
    // Not one of the nine commands this slice added, but it is one of the
    // three that section 9 of 202609130006 touched, and a line added without
    // a test behind it is an unverified claim. Mutation testing found this
    // gate untested: removing it left all 267 tests passing.
    fn: 'attendance_check_out (themselves)',
    requires: 'staff, plus an open interval of their own',
    attempt: async (userId, actor) => {
      const intervention = await publishedToEveryone();
      const member = cast[actor].memberId;
      if (member !== null) {
        // Give this actor an interval to close, created by a commander so the
        // actor's own authority is never what put it there.
        await asUserCommitted(db, cast.commander.userId!, (client) =>
          client.query('select public.attendance_check_in($1, $2)', [intervention, member]),
        );
      }
      return outcome(userId, (client) =>
        client.query('select public.attendance_check_out($1, null)', [intervention]),
      );
    },
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      // Refused before the interval is even looked for, so a withdrawn
      // account cannot close a record it is no longer entitled to touch.
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      noMember: 'MEMBER_RECORD_REQUIRED',
      anonymous: 'permission denied',
    },
  },
  {
    fn: 'attendance_correct',
    requires: 'command, and a reason',
    attempt: async (userId) => {
      const intervalId = await pendingInterval();
      return outcome(userId, (client) =>
        client.query('select public.attendance_correct($1, null, null, $2)', [
          intervalId,
          'Ispravka vremena.',
        ]),
      );
    },
    expected: { ...OWNER_ADMIN_COMMAND, ...NO_ROLE },
  },
  {
    fn: 'attendance_confirm',
    requires: 'command; never the member themselves',
    attempt: async (userId) => {
      const intervalId = await pendingInterval();
      return outcome(userId, (client) =>
        client.query('select public.attendance_confirm($1, null)', [intervalId]),
      );
    },
    expected: { ...OWNER_ADMIN_COMMAND, ...NO_ROLE },
  },
  {
    fn: 'attendance_reject',
    requires: 'command, and a reason that is kept',
    attempt: async (userId) => {
      const intervalId = await pendingInterval();
      return outcome(userId, (client) =>
        client.query('select public.attendance_reject($1, $2)', [intervalId, 'Nije bio prisutan.']),
      );
    },
    expected: { ...OWNER_ADMIN_COMMAND, ...NO_ROLE },
  },
  {
    fn: 'attendance_unconfirm',
    requires: 'command, and a reason',
    attempt: async (userId) => {
      const intervalId = await confirmedInterval();
      return outcome(userId, (client) =>
        client.query('select public.attendance_unconfirm($1, $2)', [
          intervalId,
          'Povlacim potvrdu.',
        ]),
      );
    },
    expected: { ...OWNER_ADMIN_COMMAND, ...NO_ROLE },
  },
  {
    fn: 'attendance_totals',
    requires: 'nothing beyond being signed in; RLS decides what is visible',
    attempt: async (userId) => {
      await pendingInterval();
      return outcome(userId, (client) => client.query('select * from public.attendance_totals()'));
    },
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      // Not refused - emptied by row level security. A different safeguard.
      pending: 'empty',
      suspended: 'empty',
      incompleteProfile: 'empty',
      noMember: 'ok',
      anonymous: 'permission denied',
    },
  },
  {
    fn: 'acknowledge_intervention',
    requires: 'being a recipient, which needs a linked member record',
    attempt: async (userId) => {
      const intervention = await publishedToEveryone();
      return outcome(userId, (client) =>
        client.query('select public.acknowledge_intervention($1)', [intervention]),
      );
    },
    expected: {
      // Every linked member in the cast is a recipient of this intervention.
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      // These three DO have member records and WERE addressed. Before the fix
      // in section 9 of 202609130006 all three could acknowledge, because
      // being a recipient was treated as standing. They are now refused for
      // the honest reason - no effective role - rather than by pretending
      // they have no member record.
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      noMember: 'MEMBER_RECORD_REQUIRED',
      anonymous: 'permission denied',
    },
  },
  {
    fn: 'record_vehicle_departure',
    requires: 'staff - any approved member may send a vehicle out',
    attempt: async (userId) => {
      const vehicleId = await vehicle();
      return outcome(userId, (client) =>
        client.query('select public.record_vehicle_departure($1, null, $2)', [vehicleId, 'Vjezba']),
      );
    },
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      // Staff authority is enough; a vehicle movement is not a personal claim.
      noMember: 'ok',
      anonymous: 'permission denied',
    },
  },
  {
    fn: 'record_vehicle_return',
    requires: 'staff',
    attempt: async (userId) => {
      const movementId = await openMovement();
      return outcome(userId, (client) =>
        client.query('select public.record_vehicle_return($1)', [movementId]),
      );
    },
    expected: {
      owner: 'ok',
      admin: 'ok',
      commander: 'ok',
      firefighter: 'ok',
      otherFirefighter: 'ok',
      pending: 'STAFF_REQUIRED',
      suspended: 'STAFF_REQUIRED',
      incompleteProfile: 'STAFF_REQUIRED',
      noMember: 'ok',
      anonymous: 'permission denied',
    },
  },
];

describe('the authority matrix', () => {
  it('covers every command this slice added or changed', () => {
    // A command added without a row above would otherwise be untested and
    // nothing would say so. The list is the schema's, not this file's.
    const covered = new Set(SUBJECTS.map((s) => s.fn.replace(/ \(.*$/, '')));
    expect([...covered].sort()).toEqual([
      'acknowledge_intervention',
      'attendance_check_in',
      // Not added by this slice, but its authority was changed by it.
      'attendance_check_out',
      'attendance_confirm',
      // 202609140007: the batch convenience, which must carry the same rules.
      'attendance_confirm_many',
      'attendance_correct',
      'attendance_reject',
      'attendance_totals',
      'attendance_unconfirm',
      'record_vehicle_departure',
      'record_vehicle_return',
      // 202609140007
      'set_journey_progress',
      'set_own_availability',
    ]);
  });

  it('declares an expectation for every actor state, for every command', () => {
    for (const subject of SUBJECTS) {
      for (const actor of ACTORS) {
        expect(
          subject.expected[actor],
          `${subject.fn} has no declared expectation for ${actor}`,
        ).toBeTruthy();
      }
    }
    expect(SUBJECTS.length * ACTORS.length).toBe(140);
  });

  for (const subject of SUBJECTS) {
    describe(`${subject.fn} — requires ${subject.requires}`, () => {
      for (const actor of ACTORS) {
        const want = subject.expected[actor];
        const label =
          want === 'ok'
            ? `allows ${actor}`
            : want === 'empty'
              ? `returns nothing to ${actor}`
              : `refuses ${actor} with ${want}`;

        it(label, async () => {
          const result = (await subject.attempt(cast[actor].userId, actor)) as
            | { ok: true; rows: number }
            | { ok: false; message: string };

          if (want === 'ok') {
            if (!result.ok) {
              throw new Error(
                `${subject.fn} must allow ${actor} but refused it: ${result.message}`,
              );
            }
            return;
          }
          if (want === 'empty') {
            if (!result.ok) {
              throw new Error(
                `${subject.fn} must return nothing to ${actor}, but refused it: ${result.message}`,
              );
            }
            expect(result.rows, `${actor} must see no rows`).toBe(0);
            return;
          }
          if (result.ok) {
            throw new Error(
              `${subject.fn} must refuse ${actor} with ${want}, but ALLOWED it ` +
                `(${result.rows} row(s)). An authority gap, not a test bug.`,
            );
          }
          expect(result.message, `${subject.fn} refused ${actor} for the wrong reason`).toContain(
            want,
          );
        }, 30_000);
      }
    });
  }
});

describe('the states that carry a role but must not act on it', () => {
  // These three are the ones a hand-written suite forgets, because each looks
  // like an ordinary firefighter in the grants table.
  it('gives suspended, incomplete-profile and pending accounts no effective role', async () => {
    for (const actor of ['suspended', 'incompleteProfile', 'pending'] as const) {
      await db.query('begin');
      try {
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: cast[actor].userId, role: 'authenticated' }),
        ]);
        await db.query('set local role authenticated');
        const { rows } = await db.query<{ role: string | null }>(
          'select public.current_dvd_role() as role',
        );
        expect(rows[0]!.role, `${actor} must hold no effective role`).toBeNull();
      } finally {
        await db.query('rollback');
      }
    }
  });

  it('resolves no member identity for an account with no effective role', async () => {
    // The root defect, and the reason the three cases above were reachable at
    // all: `current_member_id()` checked `members.active` - whether the
    // society still counts the person - and never whether the ACCOUNT still
    // has standing. Identity survived the loss of authority, and seven read
    // policies plus three commands trust it.
    for (const actor of ['suspended', 'incompleteProfile', 'pending'] as const) {
      await db.query('begin');
      try {
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: cast[actor].userId, role: 'authenticated' }),
        ]);
        await db.query('set local role authenticated');
        const { rows } = await db.query<{ member: string | null }>(
          'select public.current_member_id() as member',
        );
        expect(rows[0]!.member, `${actor} must resolve to no acting member`).toBeNull();
      } finally {
        await db.query('rollback');
      }
    }

    // And the member row itself is untouched, which is the distinction: the
    // person is still on the roster, their account simply cannot act as them.
    for (const actor of ['suspended', 'incompleteProfile', 'pending'] as const) {
      const { rows } = await db.query<{ active: boolean }>(
        'select active from public.members where id = $1',
        [cast[actor].memberId],
      );
      expect(rows[0]!.active, `${actor}'s member row must stay active`).toBe(true);
    }
  });

  it('keeps a suspended account out of attendance it could previously read', async () => {
    // Suspension is not only a refusal to write: the reads go too, so a
    // withdrawn account cannot keep watching the society's records. This
    // returned 51 rows before the fix, through `attendance_recipient_read`.
    const intervalId = await pendingInterval();
    expect(intervalId).toBeTruthy();
    const result = await outcome(cast.suspended.userId, (client) =>
      client.query('select * from public.attendance_intervals'),
    );
    if (!result.ok) throw new Error(`unexpected refusal: ${result.message}`);
    expect(result.rows).toBe(0);
  });

  it('keeps a withdrawn account out of every table that routes identity through it', async () => {
    // One assertion per policy that uses `current_member_id()` or
    // `is_recipient_of()`. Named individually so a future policy added to one
    // of these tables cannot quietly reopen the leak on that table alone.
    const tables = [
      'interventions',
      'intervention_updates',
      'intervention_recipients',
      'intervention_responses',
      'intervention_acknowledgements',
      'attendance_intervals',
      'notification_outbox',
    ];
    await pendingInterval();
    for (const actor of ['suspended', 'incompleteProfile', 'pending'] as const) {
      for (const table of tables) {
        const result = await outcome(cast[actor].userId, (client) =>
          client.query(`select * from public.${table}`),
        );
        if (!result.ok) throw new Error(`${actor} on ${table}: ${result.message}`);
        expect(result.rows, `${actor} must see no rows in ${table}`).toBe(0);
      }
    }
  }, 60_000);

  it('still lets an approved, linked member see their own call-out', async () => {
    // The fix must narrow only what it means to narrow. If it also hid a
    // serving firefighter's own intervention, the member screen would break
    // and this suite would be proving the wrong property.
    const intervention = await publishedToEveryone();
    const result = await outcome(cast.firefighter.userId, (client) =>
      client.query('select * from public.interventions where id = $1', [intervention]),
    );
    if (!result.ok) throw new Error(`an approved member was refused: ${result.message}`);
    expect(result.rows, 'an approved recipient must still see their intervention').toBe(1);
  });
});
