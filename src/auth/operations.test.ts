/**
 * The pure rules of the operational layer.
 *
 * These are the calculations a screen shows a commander, so a mistake here is a
 * mistake on a board somebody makes a decision from. The database enforces the
 * same rules server-side - `attendance_totals()` computes participation the same
 * way - and that duplication is deliberate: the client must be able to render a
 * correct board from rows it already has, without a round trip, and must never
 * render a *different* answer from the server's.
 */

import { describe, expect, it } from 'vitest';
import { formatDurationMs } from './duration';
import {
  attendanceState,
  explainRefusal,
  INTERVENTION_STATUSES,
  isOpenStatus,
  outstandingFor,
  participationMs,
  stateTimestamp,
  type AttendanceInterval,
  type Intervention,
  type RecipientFacts,
} from './operations';

const interval = (over: Partial<AttendanceInterval> = {}): AttendanceInterval => ({
  id: 'i1',
  memberId: 'm1',
  memberName: 'Ime Clan',
  startedAt: '2026-09-12T10:00:00.000Z',
  endedAt: '2026-09-12T11:30:00.000Z',
  source: 'SELF_DECLARED',
  verified: false,
  rejectedAt: null,
  rejectionReason: null,
  ...over,
});

describe('the three attendance states', () => {
  it('reads an unconfirmed, unrejected interval as pending', () => {
    expect(attendanceState(interval())).toBe('PENDING');
  });

  it('reads a confirmed interval as confirmed', () => {
    expect(attendanceState(interval({ verified: true }))).toBe('CONFIRMED');
  });

  it('reads a rejected interval as rejected, whatever else it says', () => {
    // `verified` and `rejected_at` cannot both be set - the database has a
    // constraint forbidding it - but if a row ever arrived that way, rejected
    // is the safe reading: it contributes nothing either way.
    expect(attendanceState(interval({ rejectedAt: '2026-09-12T12:00:00.000Z' }))).toBe('REJECTED');
    expect(
      attendanceState(interval({ verified: true, rejectedAt: '2026-09-12T12:00:00.000Z' })),
    ).toBe('REJECTED');
  });
});

describe('participation is confirmed, closed time and nothing else', () => {
  it('counts a confirmed closed interval', () => {
    expect(participationMs(interval({ verified: true }))).toBe(90 * 60_000);
  });

  it('counts NOTHING for a pending interval, however long it ran', () => {
    // The defect this whole project fought: a self-declared claim summed as
    // participation. A pending interval is a claim, not a record.
    expect(participationMs(interval())).toBe(0);
  });

  it('counts nothing for a rejected interval', () => {
    expect(
      participationMs(interval({ rejectedAt: '2026-09-12T12:00:00.000Z' })),
    ).toBe(0);
  });

  it('counts nothing for an interval that is still open', () => {
    // Confirming "this person is here" is allowed before they leave. It is the
    // DURATION that cannot be known yet, so it contributes no time.
    expect(participationMs(interval({ verified: true, endedAt: null }))).toBe(0);
  });

  it('measures a very short interval exactly, without inflating it', () => {
    // This assertion used to expect 1 SECOND for a 300 ms interval, because the
    // formatter could not say "seconds" and a 0 rendered as "0 min" - identical
    // to somebody who never attended. That workaround is what later turned a
    // ten-second interval into "1 min" on the hosted archive.
    //
    // The unit is milliseconds now and the formatter can say "0 s", so the
    // measurement is simply the measurement.
    expect(
      participationMs(
        interval({
          verified: true,
          startedAt: '2026-09-12T10:00:00.000Z',
          endedAt: '2026-09-12T10:00:00.300Z',
        }),
      ),
    ).toBe(300);
    // Still zero for an interval that is genuinely not participation, and the
    // two remain distinguishable on screen: "0 s" against "Nema zapisa".
    expect(participationMs(interval({ verified: true, endedAt: null }))).toBe(0);
  });

  it('never returns a negative duration from an out-of-order pair', () => {
    expect(
      participationMs(
        interval({ verified: true, startedAt: '2026-09-12T11:00:00.000Z', endedAt: '2026-09-12T10:00:00.000Z' }),
      ),
    ).toBe(0);
  });
});

describe('durations are written for a person', () => {
  // The full contract, including every boundary, lives in
  // `src/auth/duration.test.ts`. What is checked here is only that this
  // module's own output feeds it correctly - a participation figure measured
  // in milliseconds and formatted once.
  it.each([
    [0, '0 s'],
    [30_000, '30 s'],
    [60_000, '1 min'],
    [90 * 60_000, '1 h 30 min'],
    [60 * 60_000, '1 h'],
    [125 * 60_000, '2 h 5 min'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatDurationMs(ms)).toBe(expected);
  });

  it('reports forty seconds of participation as forty seconds', () => {
    // This assertion used to demand "1 min" for forty seconds, to stop the old
    // formatter rendering it as "0 min". Both were wrong; the measurement is
    // forty seconds and the screen can now say so.
    const forty = participationMs(
      interval({
        verified: true,
        startedAt: '2026-09-12T10:00:00.000Z',
        endedAt: '2026-09-12T10:00:40.000Z',
      }),
    );
    expect(forty).toBe(40_000);
    expect(formatDurationMs(forty)).toBe('40 s');
  });
});

describe('what a recipient still owes', () => {
  const facts = (over: Partial<RecipientFacts> = {}): RecipientFacts => ({
    memberId: 'm1',
    memberName: 'Ime Clan',
    acknowledgedAt: null,
    answer: null,
    etaMinutes: null,
    answeredAt: null,
    journey: null,
    journeyAt: null,
    ...over,
  });

  it('lists both when they have neither opened nor answered', () => {
    expect(outstandingFor(facts())).toEqual(['OPEN', 'ANSWER']);
  });

  it('still lists the missing answer after they opened it', () => {
    // The case a single "latest status" label would hide: opened, then silence.
    // That is exactly the person a commander needs to chase.
    expect(outstandingFor(facts({ acknowledgedAt: '2026-09-12T10:00:00.000Z' }))).toEqual([
      'ANSWER',
    ]);
  });

  it('lists nothing once both facts exist', () => {
    expect(
      outstandingFor(
        facts({ acknowledgedAt: '2026-09-12T10:00:00.000Z', answer: 'DOLAZIM' }),
      ),
    ).toEqual([]);
  });

  it('treats an answer without an opening as still owing the opening', () => {
    // Possible when somebody answers from a notification without opening the
    // screen. Both facts are real and neither implies the other.
    expect(outstandingFor(facts({ answer: 'NE_MOGU' }))).toEqual(['OPEN']);
  });
});

describe('which statuses can still be acted on', () => {
  it.each([
    ['PUBLISHED', true],
    ['ASSEMBLING', true],
    ['DEPLOYED', true],
    ['CONTAINED', true],
    ['DRAFT', false],
    ['CLOSED', false],
    ['CANCELLED', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isOpenStatus(status)).toBe(expected);
  });
});

describe('server refusals become sentences a firefighter can act on', () => {
  it.each([
    ['COMMAND_REQUIRED', /komandira/],
    ['STAFF_REQUIRED', /operativni pristup/],
    ['MEMBER_RECORD_REQUIRED', /povezan sa clanom/],
    ['NOT_A_RECIPIENT', /spisku pozvanih/],
    ['VEHICLE_ALREADY_OUT', /vec na terenu/],
    ['INTERVAL_CONFIRMED', /vec potvrdjen/],
    ['REASON_REQUIRED', /Razlog/],
    ['VERSION_CONFLICT', /Osvjezite/],
  ])('translates %s', (code, pattern) => {
    expect(explainRefusal(`ERROR: ${code}`)).toMatch(pattern);
  });

  it('translates a privilege refusal without leaking the table name', () => {
    const message = explainRefusal('permission denied for table attendance_intervals');
    expect(message).toMatch(/nemate pravo pristupa/i);
    expect(message).not.toMatch(/attendance_intervals/);
  });

  it('translates a network failure as a network failure, not a refusal', () => {
    // "The server said no" and "I could not reach the server" must never read
    // the same: one is a rule, the other is a reason to try again.
    expect(explainRefusal('TypeError: Failed to fetch')).toMatch(/nije dostupan/i);
  });

  it('never shows an unknown server message raw', () => {
    const leaky = 'ERROR: duplicate key value violates unique constraint "members_pkey"';
    const message = explainRefusal(leaky);
    expect(message).not.toMatch(/members_pkey/);
    expect(message).not.toMatch(/duplicate key/);
    expect(message).toBe('Server je odbio zahtjev. Promjena nije sacuvana.');
  });

  it('handles null and undefined without throwing', () => {
    expect(explainRefusal(null)).toBeTruthy();
    expect(explainRefusal(undefined)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

/**
 * Which timestamp belongs to which state.
 *
 * The archive list once printed `published_at ?? created_at` for every row,
 * whatever the row said it was. A closed intervention therefore showed the
 * moment it was OPENED beside the word "Zatvoreno", which is a false statement
 * about a record people are meant to rely on months later.
 *
 * The three times below are deliberately hours apart so no assertion can pass
 * by accident on a shared value.
 */
const CREATED = '2026-09-13T06:00:00.000Z';
const PUBLISHED = '2026-09-13T09:00:00.000Z';
const CLOSED = '2026-09-13T17:00:00.000Z';

const record = (over: Partial<Intervention> = {}): Intervention => ({
  id: 'x1',
  kind: 'POZAR',
  otherKindNote: null,
  title: 'Pozar niskog rastinja (izmisljeno)',
  instructions: 'Uputstvo.',
  incidentLocation: 'Izmisljena lokacija',
  assemblyPoint: null,
  latitude: null,
  longitude: null,
  status: 'CLOSED',
  version: 3,
  publishedAt: PUBLISHED,
  closedAt: CLOSED,
  closeReason: 'Vjezba zavrsena.',
  createdAt: CREATED,
  ...over,
});

describe('the timestamp that belongs to the displayed state', () => {
  it.each([
    ['DRAFT', CREATED],
    ['PUBLISHED', PUBLISHED],
    ['ASSEMBLING', PUBLISHED],
    ['DEPLOYED', PUBLISHED],
    ['CONTAINED', PUBLISHED],
    ['CLOSED', CLOSED],
    ['CANCELLED', CLOSED],
  ] as const)('%s uses %s', (status, expected) => {
    expect(stateTimestamp(record({ status }))).toBe(expected);
  });

  it('never answers the publication time for a closed intervention', () => {
    // The exact defect, stated as its own assertion so a future refactor that
    // reintroduces a `?? publishedAt` fallback fails here and not only in the
    // table above.
    const closed = record({ status: 'CLOSED' });
    expect(stateTimestamp(closed)).not.toBe(closed.publishedAt);
    expect(stateTimestamp(closed)).not.toBe(closed.createdAt);
  });

  it('covers every status the database allows', () => {
    // A status added to the schema without a timestamp decision would silently
    // return undefined here. This makes that a failing test rather than a blank
    // space on a board.
    for (const status of INTERVENTION_STATUSES) {
      expect(stateTimestamp(record({ status })), status).toBeTypeOf('string');
    }
  });

  it('reports a missing timestamp as missing rather than substituting another', () => {
    // The database constraints make this impossible, but a client can also be
    // handed a row by a fixture or a partially-migrated project. Inventing a
    // time would be worse than admitting there is none.
    expect(stateTimestamp(record({ status: 'CLOSED', closedAt: null }))).toBeNull();
    expect(stateTimestamp(record({ status: 'PUBLISHED', publishedAt: null }))).toBeNull();
  });
});
