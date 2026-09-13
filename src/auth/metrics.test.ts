/**
 * The operational timings, against the situations that actually occur.
 *
 * The fixture below is one intervention with four invited members chosen to
 * cover the cases a real call-out produces, and it is deliberately built in the
 * WRONG ORDER: the member who opened last is first in the list, the member who
 * arrived first is last. Every "first" assertion therefore fails if anything
 * starts taking `[0]` instead of comparing timestamps.
 *
 * The cast:
 *
 *   Ana    opened late, answered "Dolazim", reported all three movements,
 *          attended twice - two confirmed intervals that must be summed
 *          exactly, not formatted and added
 *   Bojan  opened FIRST, declined. Answered before anybody said they were
 *          coming, which is why "first response" and "first Dolazim" are two
 *          different figures
 *   Ceda   opened, answered "Dolazim kasnije", arrived FIRST, still checked in
 *   Dejan  never opened it at all - every one of his timings is null, and none
 *          of them is a zero
 */

import { describe, expect, it } from 'vitest';
import { formatDurationMs, formatDurationOrNotMeasured } from './duration';
import { earliestBy, recipientTimings, summarise } from './metrics';
import type {
  AttendanceInterval,
  AuditEvent,
  Intervention,
  RecipientFacts,
  VehicleMovement,
} from './operations';

const PUBLISHED = '2026-09-13T10:00:00.000Z';
const CLOSED = '2026-09-13T11:30:00.000Z';

const INTERVENTION: Intervention = {
  id: 'i1',
  kind: 'POZAR',
  otherKindNote: null,
  title: 'Pozar niskog rastinja (izmisljeno)',
  instructions: 'Uputstvo.',
  incidentLocation: 'Izmisljena lokacija',
  assemblyPoint: 'Baza',
  latitude: null,
  longitude: null,
  status: 'CLOSED',
  version: 5,
  publishedAt: PUBLISHED,
  closedAt: CLOSED,
  closeReason: 'Vjezba zavrsena.',
  createdAt: '2026-09-13T09:55:00.000Z',
};

const facts = (over: Partial<RecipientFacts> & { memberId: string; memberName: string }): RecipientFacts => ({
  acknowledgedAt: null,
  answer: null,
  etaMinutes: null,
  answeredAt: null,
  journey: null,
  journeyAt: null,
  ...over,
});

/** Deliberately not in chronological order. */
const RECIPIENTS: RecipientFacts[] = [
  facts({
    memberId: 'ana',
    memberName: 'Ana Vatrogasac',
    acknowledgedAt: '2026-09-13T10:05:00.000Z', // last to open
    answer: 'DOLAZIM',
    answeredAt: '2026-09-13T10:06:00.000Z',
    etaMinutes: 15,
    journey: 'NA_LICU_MJESTA',
    journeyAt: '2026-09-13T10:20:00.000Z',
  }),
  facts({
    memberId: 'bojan',
    memberName: 'Bojan Vatrogasac',
    acknowledgedAt: '2026-09-13T10:00:30.000Z', // FIRST to open
    answer: 'NE_MOGU',
    answeredAt: '2026-09-13T10:01:00.000Z', // FIRST to answer, but declined
  }),
  facts({
    memberId: 'ceda',
    memberName: 'Ceda Vatrogasac',
    acknowledgedAt: '2026-09-13T10:02:00.000Z',
    answer: 'DOLAZIM_KASNIJE',
    answeredAt: '2026-09-13T10:03:00.000Z',
    etaMinutes: 30,
    journey: 'NA_LICU_MJESTA',
    journeyAt: '2026-09-13T10:12:00.000Z', // FIRST to arrive
  }),
  facts({ memberId: 'dejan', memberName: 'Dejan Vatrogasac' }),
];

const audit = (
  id: string,
  at: string,
  type: string,
  detail: Record<string, unknown>,
  actorName: string | null = 'Komandir Smjene',
): AuditEvent => ({ id, at, type, detail, actorName, actorIsYou: false });

/** Also out of order, for the same reason. */
const AUDIT: AuditEvent[] = [
  audit('e9', '2026-09-13T10:20:00.000Z', 'JOURNEY_PROGRESS_SET', { member_id: 'ana', to: 'NA_LICU_MJESTA' }, 'Ana Vatrogasac'),
  audit('e1', PUBLISHED, 'INTERVENTION_PUBLISHED', { recipient_count: 4 }),
  audit('e5', '2026-09-13T10:12:00.000Z', 'JOURNEY_PROGRESS_SET', { member_id: 'ceda', to: 'NA_LICU_MJESTA' }, 'Ceda Vatrogasac'),
  audit('e7', '2026-09-13T10:10:00.000Z', 'JOURNEY_PROGRESS_SET', { member_id: 'ana', to: 'KRECEM' }, 'Ana Vatrogasac'),
  audit('e8', '2026-09-13T10:15:00.000Z', 'JOURNEY_PROGRESS_SET', { member_id: 'ana', to: 'U_PUTU' }, 'Ana Vatrogasac'),
  audit('s2', '2026-09-13T10:25:00.000Z', 'INTERVENTION_STATUS_CHANGED', { from: 'ASSEMBLING', to: 'DEPLOYED' }, 'Komandir Smjene'),
  audit('s1', '2026-09-13T10:08:00.000Z', 'INTERVENTION_STATUS_CHANGED', { from: 'PUBLISHED', to: 'ASSEMBLING' }, 'Komandir Smjene'),
  audit('s3', '2026-09-13T11:00:00.000Z', 'INTERVENTION_STATUS_CHANGED', { from: 'DEPLOYED', to: 'CONTAINED' }, 'Admin Kancelarija'),
  audit('v1', '2026-09-13T10:09:00.000Z', 'VEHICLE_DEPARTED', { movement_id: 'm1', vehicle_id: 'nv1' }, 'Komandir Smjene'),
  audit('v2', '2026-09-13T11:10:00.000Z', 'VEHICLE_RETURNED', { movement_id: 'm1', vehicle_id: 'nv1' }, 'Ana Vatrogasac'),
];

const interval = (over: Partial<AttendanceInterval> & { id: string; memberId: string }): AttendanceInterval => ({
  memberName: 'x',
  startedAt: '2026-09-13T10:20:00.000Z',
  endedAt: null,
  source: 'SELF_DECLARED',
  verified: false,
  rejectedAt: null,
  rejectionReason: null,
  ...over,
});

const ATTENDANCE: AttendanceInterval[] = [
  // Ana, twice. 29.6s each: rounded individually they are 30+30=60 ("1 min"),
  // summed exactly they are 59.2 ("59 s"). The difference is the point.
  interval({ id: 'a1', memberId: 'ana', startedAt: '2026-09-13T10:20:00.000Z', endedAt: '2026-09-13T10:20:29.600Z', verified: true }),
  interval({ id: 'a2', memberId: 'ana', startedAt: '2026-09-13T10:30:00.000Z', endedAt: '2026-09-13T10:30:29.600Z', verified: true }),
  // Ceda is still checked in: no end, so no duration yet.
  interval({ id: 'c1', memberId: 'ceda', startedAt: '2026-09-13T10:15:00.000Z', endedAt: null }),
  // Bojan's claim was rejected. It stays in the record and counts nothing.
  interval({ id: 'b1', memberId: 'bojan', startedAt: '2026-09-13T10:40:00.000Z', endedAt: '2026-09-13T11:40:00.000Z', rejectedAt: '2026-09-13T11:45:00.000Z', rejectionReason: 'Nije bio na terenu.' }),
];

const MOVEMENTS: VehicleMovement[] = [
  {
    id: 'm1',
    vehicleId: 'nv1',
    callsign: 'NV-1',
    vehicleName: 'Navalno vozilo',
    interventionId: 'i1',
    purpose: 'Gasenje',
    departedAt: '2026-09-13T10:09:00.000Z',
    returnedAt: '2026-09-13T11:10:00.000Z',
  },
];

// ---------------------------------------------------------------------------

describe('choosing the first of something', () => {
  it('compares timestamps rather than taking the first in the list', () => {
    const items = [
      { id: 'late', at: '2026-09-13T10:05:00.000Z' },
      { id: 'early', at: '2026-09-13T10:01:00.000Z' },
      { id: 'middle', at: '2026-09-13T10:03:00.000Z' },
    ];
    expect(earliestBy(items, (i) => i.at, (i) => i.id)?.id).toBe('early');
  });

  it('breaks an exact tie on the stable key, the same way every time', () => {
    // Two events written in one transaction share `now()` to the microsecond.
    // Without a secondary key the answer would depend on row order.
    const tied = [
      { id: 'zebra', at: '2026-09-13T10:00:00.000Z' },
      { id: 'alpha', at: '2026-09-13T10:00:00.000Z' },
    ];
    expect(earliestBy(tied, (i) => i.at, (i) => i.id)?.id).toBe('alpha');
    expect(earliestBy([...tied].reverse(), (i) => i.at, (i) => i.id)?.id).toBe('alpha');
  });

  it('ignores items with no timestamp rather than treating them as earliest', () => {
    const items = [
      { id: 'never', at: null },
      { id: 'real', at: '2026-09-13T10:05:00.000Z' },
    ];
    expect(earliestBy(items, (i) => i.at, (i) => i.id)?.id).toBe('real');
    expect(earliestBy([{ id: 'x', at: null }], (i) => i.at, (i) => i.id)).toBeNull();
    expect(earliestBy([], (i: { at: string | null; id: string }) => i.at, (i) => i.id)).toBeNull();
  });
});

describe('one member’s timings', () => {
  const forMember = (memberId: string) =>
    recipientTimings(
      INTERVENTION,
      RECIPIENTS.find((r) => r.memberId === memberId)!,
      ATTENDANCE,
      AUDIT,
    );

  it('keeps the four response durations apart', () => {
    const ana = forMember('ana');
    expect(ana.toOpenMs).toBe(5 * 60_000); // published 10:00, opened 10:05
    expect(ana.toAnswerMs).toBe(6 * 60_000); // answered 10:06
    expect(ana.openToAnswerMs).toBe(60_000); // one minute to decide
    expect(ana.toArriveMs).toBe(20 * 60_000); // on scene 10:20
    // Four separate facts. None is derivable from the others, which is why
    // there is no single "vrijeme odaziva".
    expect(new Set([ana.toOpenMs, ana.toAnswerMs, ana.openToAnswerMs, ana.toArriveMs]).size).toBe(4);
  });

  it('lists every movement, oldest first, not just the latest', () => {
    const ana = forMember('ana');
    expect(ana.movements.map((m) => m.step)).toEqual(['KRECEM', 'U_PUTU', 'NA_LICU_MJESTA']);
    expect(ana.movements.map((m) => m.at)).toEqual([
      '2026-09-13T10:10:00.000Z',
      '2026-09-13T10:15:00.000Z',
      '2026-09-13T10:20:00.000Z',
    ]);
  });

  it('sums two confirmed intervals exactly before anything is formatted', () => {
    const ana = forMember('ana');
    expect(ana.confirmedIntervals).toBe(2);
    expect(ana.confirmedMs).toBe(59_200);
    // Rounded individually these are 30 s + 30 s = "1 min". Summed exactly and
    // formatted once they are 59 s, which is what actually happened.
    expect(formatDurationMs(ana.confirmedMs!)).toBe('59 s');
  });

  it('reports the declared ETA as the member’s estimate, beside the measurement', () => {
    expect(forMember('ana').etaMinutes).toBe(15);
    expect(forMember('ceda').etaMinutes).toBe(30);
    expect(forMember('bojan').etaMinutes).toBeNull();
  });

  it('counts an open interval as present but gives it no duration', () => {
    const ceda = forMember('ceda');
    expect(ceda.stillCheckedIn).toBe(true);
    expect(ceda.firstCheckInAt).toBe('2026-09-13T10:15:00.000Z');
    expect(ceda.lastCheckOutAt).toBeNull();
    // Null, not zero. A running interval has no duration YET, which is a
    // different statement from "was here for no time" - and the screen says so
    // in words rather than printing "0 s" beside somebody who is standing on
    // the incident ground right now.
    expect(ceda.confirmedMs, 'a running interval has no duration yet').toBeNull();
    expect(formatDurationOrNotMeasured(ceda.confirmedMs)).toBe('Nije zabiljezeno');
    expect(ceda.confirmedIntervals).toBe(0);
  });

  it('keeps a rejected claim in the record and out of the total', () => {
    const bojan = forMember('bojan');
    expect(bojan.rejectedIntervals).toBe(1);
    // A whole hour of rejected claim must not reach the figure - and the
    // absence of a confirmed one is stated, not rendered as a measured zero.
    expect(bojan.confirmedMs).toBeNull();
    expect(bojan.confirmedIntervals).toBe(0);
    expect(formatDurationOrNotMeasured(bojan.confirmedMs)).toBe('Nije zabiljezeno');
  });

  it('measures a confirmed interval that really did last no time as zero', () => {
    // The other side of the same rule. This member HAS a confirmed, closed
    // record; it is simply very short. "0 s" is the measurement, and it must
    // remain distinguishable from "nothing was recorded".
    const zero = recipientTimings(
      INTERVENTION,
      RECIPIENTS.find((r) => r.memberId === 'ana')!,
      [
        {
          id: 'z1', memberId: 'ana', memberName: 'Ana Prva',
          startedAt: '2026-09-13T10:30:00.000Z',
          endedAt: '2026-09-13T10:30:00.000Z',
          source: 'SELF_DECLARED', verified: true, rejectedAt: null, rejectionReason: null,
        },
      ],
      AUDIT,
    );
    expect(zero.confirmedMs).toBe(0);
    expect(formatDurationOrNotMeasured(zero.confirmedMs)).toBe('0 s');
  });

  it('gives a member who never opened it nulls, not zeros', () => {
    const dejan = forMember('dejan');
    for (const value of [
      dejan.openedAt, dejan.toOpenMs, dejan.answeredAt, dejan.toAnswerMs,
      dejan.openToAnswerMs, dejan.arrivedAt, dejan.toArriveMs,
      dejan.firstCheckInAt, dejan.lastCheckOutAt,
    ]) {
      expect(value).toBeNull();
    }
    expect(dejan.movements).toEqual([]);
  });

  it('falls back to the current-state journey row when the audit is unavailable', () => {
    // An older project without the chronology reader still shows arrival.
    const ana = recipientTimings(
      INTERVENTION,
      RECIPIENTS.find((r) => r.memberId === 'ana')!,
      ATTENDANCE,
      [],
    );
    expect(ana.movements, 'no audit, no movement history').toEqual([]);
    expect(ana.arrivedAt, 'but arrival still comes from the current state').toBe(
      '2026-09-13T10:20:00.000Z',
    );
  });

  it('takes the FIRST arrival when somebody reported it twice', () => {
    const twice = [
      ...AUDIT,
      audit('e10', '2026-09-13T10:45:00.000Z', 'JOURNEY_PROGRESS_SET', { member_id: 'ana', to: 'NA_LICU_MJESTA' }, 'Ana'),
    ];
    const ana = recipientTimings(
      INTERVENTION,
      RECIPIENTS.find((r) => r.memberId === 'ana')!,
      ATTENDANCE,
      twice,
    );
    expect(ana.arrivedAt, 'somebody who arrived, left and returned arrived once').toBe(
      '2026-09-13T10:20:00.000Z',
    );
  });
});

describe('the summary for the whole intervention', () => {
  const summary = summarise(INTERVENTION, RECIPIENTS, ATTENDANCE, MOVEMENTS, AUDIT);

  it('picks every first chronologically, not from list order', () => {
    // Ana is first in the recipient list and last to open. Bojan is second in
    // the list and first to open. Taking [0] would give the wrong answer to
    // every one of these.
    expect(summary.firstOpenedAt).toBe('2026-09-13T10:00:30.000Z'); // Bojan
    expect(summary.firstAnsweredAt).toBe('2026-09-13T10:01:00.000Z'); // Bojan
    expect(summary.firstArrivedAt).toBe('2026-09-13T10:12:00.000Z'); // Ceda
    expect(summary.firstCheckInAt).toBe('2026-09-13T10:15:00.000Z'); // Ceda
    expect(summary.firstVehicleOutAt).toBe('2026-09-13T10:09:00.000Z');
  });

  it('separates the first response from the first "Dolazim"', () => {
    // Bojan answered first and declined. The first person who said they were
    // coming is a different member at a different time, and a commander needs
    // that one.
    expect(summary.firstAnsweredAt).toBe('2026-09-13T10:01:00.000Z');
    expect(summary.firstComingAt).toBe('2026-09-13T10:06:00.000Z'); // Ana
    expect(summary.firstAnsweredAt).not.toBe(summary.firstComingAt);
  });

  it('measures each headline duration from publication', () => {
    expect(summary.toFirstOpenMs).toBe(30_000);
    expect(summary.toFirstAnswerMs).toBe(60_000);
    expect(summary.toFirstComingMs).toBe(6 * 60_000);
    expect(summary.toFirstArriveMs).toBe(12 * 60_000);
    expect(summary.toFirstCheckInMs).toBe(15 * 60_000);
    expect(summary.toFirstVehicleOutMs).toBe(9 * 60_000);
    expect(summary.totalMs).toBe(90 * 60_000);
    expect(formatDurationMs(summary.totalMs!)).toBe('1 h 30 min');
  });

  it('counts each state of the response separately', () => {
    expect(summary.invited).toBe(4);
    expect(summary.opened).toBe(3); // Dejan never did
    expect(summary.responded).toBe(3);
    expect(summary.coming).toBe(1); // Ana
    expect(summary.delayed).toBe(1); // Ceda
    expect(summary.declined).toBe(1); // Bojan
    expect(summary.arrived).toBe(2); // Ana and Ceda
    expect(summary.present).toBe(3); // anybody with an interval, including rejected
    expect(summary.confirmedMembers).toBe(1); // only Ana's are confirmed
  });

  it('totals confirmed participation exactly, and only confirmed', () => {
    // Ana's two intervals only. Ceda's is open, Bojan's is rejected.
    expect(summary.confirmedMs).toBe(59_200);
    expect(formatDurationMs(summary.confirmedMs)).toBe('59 s');
  });

  it('gives each state its own period, duration and actor', () => {
    const states = summary.states;
    expect(states.map((s) => s.status)).toEqual([
      'PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED',
    ]);
    expect(states[0]!.durationMs).toBe(8 * 60_000); // 10:00 -> 10:08
    expect(states[1]!.durationMs).toBe(17 * 60_000); // 10:08 -> 10:25
    expect(states[2]!.durationMs).toBe(35 * 60_000); // 10:25 -> 11:00
    expect(states[3]!.durationMs).toBe(30 * 60_000); // 11:00 -> closed 11:30

    // Who moved it. The first period was created by publishing, not entered by
    // a transition, so it names nobody.
    expect(states[0]!.enteredBy).toBeNull();
    expect(states[1]!.enteredBy).toBe('Komandir Smjene');
    expect(states[3]!.enteredBy).toBe('Admin Kancelarija');
  });

  it('leaves the last state open while the intervention is running', () => {
    const running = summarise(
      { ...INTERVENTION, status: 'DEPLOYED', closedAt: null, closeReason: null },
      RECIPIENTS, ATTENDANCE, MOVEMENTS, AUDIT,
    );
    expect(running.totalMs, 'an intervention still running has no total').toBeNull();
    const last = running.states[running.states.length - 1]!;
    expect(last.to).toBeNull();
    expect(last.durationMs).toBeNull();
  });

  it('gives a vehicle its time away and both actors', () => {
    const vehicle = summary.vehicles[0]!;
    expect(vehicle.departedAt).toBe('2026-09-13T10:09:00.000Z');
    expect(vehicle.returnedAt).toBe('2026-09-13T11:10:00.000Z');
    expect(vehicle.awayMs).toBe(61 * 60_000);
    expect(formatDurationMs(vehicle.awayMs!)).toBe('1 h 1 min');
    expect(vehicle.departedBy).toBe('Komandir Smjene');
    expect(vehicle.returnedBy).toBe('Ana Vatrogasac');
    expect(vehicle.purpose).toBe('Gasenje');
  });

  it('gives a vehicle still out no duration rather than a running one', () => {
    const out = summarise(
      INTERVENTION, RECIPIENTS, ATTENDANCE,
      [{ ...MOVEMENTS[0]!, returnedAt: null }],
      AUDIT,
    );
    expect(out.vehicles[0]!.awayMs).toBeNull();
    expect(out.vehicles[0]!.returnedBy).toBe('Ana Vatrogasac'); // the audit still has it
  });

  it('says nothing rather than zero for an intervention nobody touched', () => {
    const untouched = summarise(INTERVENTION, [], [], [], []);
    for (const value of [
      untouched.firstOpenedAt, untouched.toFirstOpenMs,
      untouched.firstAnsweredAt, untouched.toFirstAnswerMs,
      untouched.firstComingAt, untouched.firstArrivedAt,
      untouched.firstCheckInAt, untouched.firstVehicleOutAt,
    ]) {
      expect(value).toBeNull();
    }
    expect(untouched.invited).toBe(0);
    expect(untouched.confirmedMs).toBe(0);
  });

  it('produces nothing at all for a draft, which was never published', () => {
    const draft = summarise(
      { ...INTERVENTION, status: 'DRAFT', publishedAt: null, closedAt: null },
      RECIPIENTS, ATTENDANCE, MOVEMENTS, AUDIT,
    );
    expect(draft.states, 'an unpublished draft has no state history').toEqual([]);
    expect(draft.totalMs).toBeNull();
    expect(draft.toFirstOpenMs, 'no publication to measure from').toBeNull();
  });
});

describe('two events that share a transaction clock', () => {
  it('orders states the same way on every read', () => {
    const tied: AuditEvent[] = [
      audit('zzz', '2026-09-13T10:08:00.000Z', 'INTERVENTION_STATUS_CHANGED', { from: 'PUBLISHED', to: 'ASSEMBLING' }),
      audit('aaa', '2026-09-13T10:08:00.000Z', 'INTERVENTION_STATUS_CHANGED', { from: 'ASSEMBLING', to: 'DEPLOYED' }),
    ];
    const first = summarise(INTERVENTION, [], [], [], tied).states.map((s) => s.status);
    const second = summarise(INTERVENTION, [], [], [], [...tied].reverse()).states.map((s) => s.status);
    expect(first).toEqual(second);
    expect(first).toEqual(['PUBLISHED', 'DEPLOYED', 'ASSEMBLING', 'ASSEMBLING']
      .slice(0, first.length));
  });
});
