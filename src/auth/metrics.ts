/**
 * The operational timings of one intervention.
 *
 * Pure functions over rows the server already returned. Nothing here reads a
 * clock, formats a date, or asks the network: every value is derived from
 * timestamps PostgreSQL wrote, so the same input always gives the same answer
 * and the whole file can be tested without a browser or a database.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A FEW LINES IN A COMPONENT
 * ---------------------------------------------------------------------------
 *
 * An independent review of the hosted application found the commander's
 * overview showing five facts per member - opened, answered, moving, present,
 * confirmed - and not one duration. A commander could see THAT somebody
 * answered, never how long it took, and the archive could not say how long the
 * society had been committed to the incident.
 *
 * Computing that in a component would put the arithmetic next to the markup,
 * where it cannot be tested against the boundary cases that actually matter:
 * a member who never opened the call-out, an intervention still running, two
 * events sharing a transaction timestamp, a state that was never entered.
 *
 * ---------------------------------------------------------------------------
 * THE RULES THIS FILE KEEPS
 * ---------------------------------------------------------------------------
 *
 * **"First" is chronological, never positional.** Every first-event figure is
 * selected by comparing timestamps, not by taking `[0]` of a list. A list
 * arrives in whatever order a query returned it, and an ordering that happens
 * to be right today is a defect waiting for a different query plan.
 *
 * **Nothing is collapsed.** Publication to opening, publication to answer,
 * opening to answer and publication to arrival are four separate facts about
 * four separate moments. A single "vrijeme odaziva" would have to choose one
 * and discard three, and a commander needs to know which part was slow.
 *
 * **What was not measured is null.** Never zero, never a substituted
 * neighbouring timestamp. The screen says "Nije zabiljezeno".
 *
 * **Durations are exact milliseconds** throughout, summed before formatting.
 * See `src/auth/duration.ts` for why that sentence is load-bearing.
 */

import { between, sumMs } from './duration';
import {
  attendanceState,
  type AttendanceInterval,
  type AuditEvent,
  type Intervention,
  type InterventionStatus,
  type JourneyStep,
  type RecipientFacts,
  type ResponseAnswer,
  type VehicleMovement,
} from './operations';

// ---------------------------------------------------------------------------
// Choosing chronologically
// ---------------------------------------------------------------------------

/** Milliseconds since the epoch, or null for anything unusable. */
function instant(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

/**
 * The earliest of a set of candidates, by timestamp.
 *
 * The one function every "first" figure goes through. Ties break on a stable
 * secondary key, so two events written in one transaction - which share
 * `now()` to the microsecond - always resolve the same way rather than
 * following whatever order the rows arrived in.
 */
export function earliestBy<T>(
  items: readonly T[],
  at: (item: T) => string | null,
  tieBreak: (item: T) => string,
): T | null {
  let best: T | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  let bestKey = '';

  for (const item of items) {
    const value = instant(at(item));
    if (value === null) continue;
    const key = tieBreak(item);
    if (value < bestAt || (value === bestAt && key < bestKey)) {
      best = item;
      bestAt = value;
      bestKey = key;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// One member, on one intervention
// ---------------------------------------------------------------------------

/**
 * Every timing this system holds about one invited member.
 *
 * Each duration is nullable and independent. A member who opened the call-out
 * and never answered has an opening time and an opening duration and nothing
 * else, which is exactly what a commander needs to see.
 */
export interface RecipientTimings {
  readonly memberId: string;
  readonly memberName: string;

  /** When the call-out was published. The same for everybody, repeated here so a row is self-contained. */
  readonly publishedAt: string | null;

  readonly openedAt: string | null;
  /** Publication to opening. */
  readonly toOpenMs: number | null;

  readonly answer: ResponseAnswer | null;
  readonly answeredAt: string | null;
  /** Publication to answer. */
  readonly toAnswerMs: number | null;
  /** Opening to answer - how long they took to decide once they had read it. */
  readonly openToAnswerMs: number | null;
  /** The band the member declared, in minutes. Their estimate, never a measurement. */
  readonly etaMinutes: number | null;

  /** Every movement they reported, oldest first, with the time of each. */
  readonly movements: readonly { readonly step: JourneyStep; readonly at: string }[];
  /** The first `NA_LICU_MJESTA`, which is the only movement that means arrival. */
  readonly arrivedAt: string | null;
  /** Publication to arrival. */
  readonly toArriveMs: number | null;

  /** First attendance start and last attendance end, across all their intervals. */
  readonly firstCheckInAt: string | null;
  readonly lastCheckOutAt: string | null;
  /** Exact confirmed, closed participation. Summed over intervals before formatting. */
  readonly confirmedMs: number;
  readonly confirmedIntervals: number;
  readonly pendingIntervals: number;
  readonly rejectedIntervals: number;
  /** True while an interval is open, which is why it contributes no duration yet. */
  readonly stillCheckedIn: boolean;
}

/** Movements read from the audit, which holds every one of them rather than the latest. */
function movementsOf(
  audit: readonly AuditEvent[],
  memberId: string,
): { step: JourneyStep; at: string }[] {
  return audit
    .filter((event) => event.type === 'JOURNEY_PROGRESS_SET' && event.detail['member_id'] === memberId)
    .map((event) => ({ step: event.detail['to'] as JourneyStep, at: event.at }))
    .filter((movement) => typeof movement.step === 'string')
    .sort((a, b) => (instant(a.at) ?? 0) - (instant(b.at) ?? 0));
}

/**
 * Builds one row of the commander's timing table.
 *
 * `audit` may be empty - an older project without the chronology reader, or a
 * failed read. The movement list is then empty and arrival is null, which the
 * screen shows as "Nije zabiljezeno". Everything else still works, because it
 * comes from the per-recipient facts.
 */
export function recipientTimings(
  intervention: Intervention,
  facts: RecipientFacts,
  attendance: readonly AttendanceInterval[],
  audit: readonly AuditEvent[],
): RecipientTimings {
  const publishedAt = intervention.publishedAt;
  const movements = movementsOf(audit, facts.memberId);

  // Arrival is the FIRST time they said they were on scene. A member who
  // reported arriving, left, and reported arriving again arrived once.
  const arrival = earliestBy(
    movements.filter((m) => m.step === 'NA_LICU_MJESTA'),
    (m) => m.at,
    (m) => m.at,
  );
  // Falls back to the current-state journey row when the audit is unavailable,
  // so the figure degrades rather than disappearing.
  const arrivedAt =
    arrival?.at ?? (facts.journey === 'NA_LICU_MJESTA' ? facts.journeyAt : null);

  const mine = attendance.filter((interval) => interval.memberId === facts.memberId);
  const confirmed = mine.filter((interval) => attendanceState(interval) === 'CONFIRMED');
  const firstIn = earliestBy(mine, (i) => i.startedAt, (i) => i.id);
  const lastOut = mine.reduce<AttendanceInterval | null>((latest, interval) => {
    if (interval.endedAt === null) return latest;
    if (latest === null) return interval;
    const a = instant(interval.endedAt) ?? 0;
    const b = instant(latest.endedAt) ?? 0;
    return a > b || (a === b && interval.id > latest.id) ? interval : latest;
  }, null);

  return {
    memberId: facts.memberId,
    memberName: facts.memberName,
    publishedAt,

    openedAt: facts.acknowledgedAt,
    toOpenMs: between(publishedAt, facts.acknowledgedAt),

    answer: facts.answer,
    answeredAt: facts.answeredAt,
    toAnswerMs: between(publishedAt, facts.answeredAt),
    openToAnswerMs: between(facts.acknowledgedAt, facts.answeredAt),
    etaMinutes: facts.etaMinutes,

    movements,
    arrivedAt,
    toArriveMs: between(publishedAt, arrivedAt),

    firstCheckInAt: firstIn?.startedAt ?? null,
    lastCheckOutAt: lastOut?.endedAt ?? null,
    // Summed exactly, formatted once, by whoever displays it.
    confirmedMs: sumMs(confirmed.map((i) => between(i.startedAt, i.endedAt))),
    confirmedIntervals: confirmed.length,
    pendingIntervals: mine.filter((i) => attendanceState(i) === 'PENDING').length,
    rejectedIntervals: mine.filter((i) => attendanceState(i) === 'REJECTED').length,
    stillCheckedIn: mine.some((i) => i.endedAt === null && i.rejectedAt === null),
  };
}

// ---------------------------------------------------------------------------
// The whole intervention
// ---------------------------------------------------------------------------

/** One period the intervention spent in a single state. */
export interface StatePeriod {
  readonly status: InterventionStatus;
  readonly from: string;
  /** Null while the intervention is still in this state. */
  readonly to: string | null;
  readonly durationMs: number | null;
  /** Who moved it INTO this state. Null for the publication, which has its own line. */
  readonly enteredBy: string | null;
}

/** One vehicle's time away from the station. */
export interface VehiclePeriod {
  readonly movementId: string;
  readonly callsign: string;
  readonly vehicleName: string;
  readonly purpose: string | null;
  readonly departedAt: string;
  readonly returnedAt: string | null;
  readonly awayMs: number | null;
  readonly departedBy: string | null;
  readonly returnedBy: string | null;
}

export interface InterventionSummary {
  readonly publishedAt: string | null;
  readonly closedAt: string | null;
  /** Publication to closure. Null while it is still running. */
  readonly totalMs: number | null;

  readonly firstOpenedAt: string | null;
  readonly toFirstOpenMs: number | null;
  readonly firstAnsweredAt: string | null;
  readonly toFirstAnswerMs: number | null;
  /** The first member who said they were coming, which is not the first to answer. */
  readonly firstComingAt: string | null;
  readonly toFirstComingMs: number | null;
  readonly firstArrivedAt: string | null;
  readonly toFirstArriveMs: number | null;
  readonly firstCheckInAt: string | null;
  readonly toFirstCheckInMs: number | null;
  readonly firstVehicleOutAt: string | null;
  readonly toFirstVehicleOutMs: number | null;

  readonly invited: number;
  readonly opened: number;
  readonly responded: number;
  readonly coming: number;
  readonly delayed: number;
  readonly declined: number;
  readonly arrived: number;
  readonly present: number;
  readonly confirmedMembers: number;
  /** Exact total confirmed participation across every member. */
  readonly confirmedMs: number;

  readonly states: readonly StatePeriod[];
  readonly vehicles: readonly VehiclePeriod[];
}

/** Who moved the intervention into each state, from the audit. */
function statePeriods(
  intervention: Intervention,
  audit: readonly AuditEvent[],
): StatePeriod[] {
  const changes = audit
    .filter((event) => event.type === 'INTERVENTION_STATUS_CHANGED')
    .map((event) => ({
      to: event.detail['to'] as InterventionStatus,
      at: event.at,
      by: event.actorName,
      id: event.id,
    }))
    .filter((change) => typeof change.to === 'string')
    .sort((a, b) => {
      const diff = (instant(a.at) ?? 0) - (instant(b.at) ?? 0);
      // Equal timestamps are real: two changes can share a transaction clock.
      // The id is the stable secondary key, so the order never shuffles.
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  if (intervention.publishedAt === null) return [];

  const periods: StatePeriod[] = [];
  // The first period starts at publication, in the PUBLISHED state, and nobody
  // "entered" it by a transition - publishing created it.
  let currentStatus: InterventionStatus = 'PUBLISHED';
  let currentFrom = intervention.publishedAt;
  let currentBy: string | null = null;

  for (const change of changes) {
    periods.push({
      status: currentStatus,
      from: currentFrom,
      to: change.at,
      durationMs: between(currentFrom, change.at),
      enteredBy: currentBy,
    });
    currentStatus = change.to;
    currentFrom = change.at;
    currentBy = change.by;
  }

  // The last period runs to closure, or is still open.
  periods.push({
    status: currentStatus,
    from: currentFrom,
    to: intervention.closedAt,
    durationMs: between(currentFrom, intervention.closedAt),
    enteredBy: currentBy,
  });

  return periods;
}

/** Each vehicle movement with its time away and both actors, named from the audit. */
function vehiclePeriods(
  movements: readonly VehicleMovement[],
  audit: readonly AuditEvent[],
): VehiclePeriod[] {
  const actorFor = (type: string, movementId: string): string | null =>
    audit.find(
      (event) => event.type === type && event.detail['movement_id'] === movementId,
    )?.actorName ?? null;

  return [...movements]
    .sort((a, b) => {
      const diff = (instant(a.departedAt) ?? 0) - (instant(b.departedAt) ?? 0);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    })
    .map((movement) => ({
      movementId: movement.id,
      callsign: movement.callsign,
      vehicleName: movement.vehicleName,
      purpose: movement.purpose,
      departedAt: movement.departedAt,
      returnedAt: movement.returnedAt,
      awayMs: between(movement.departedAt, movement.returnedAt),
      departedBy: actorFor('VEHICLE_DEPARTED', movement.id),
      returnedBy: actorFor('VEHICLE_RETURNED', movement.id),
    }));
}

/**
 * Everything the commander's headline and the archive's summary need.
 *
 * Takes the rows the screens already have. Every "first" is selected by
 * comparing timestamps; none of it depends on the order a query returned.
 */
export function summarise(
  intervention: Intervention,
  recipients: readonly RecipientFacts[],
  attendance: readonly AttendanceInterval[],
  movements: readonly VehicleMovement[],
  audit: readonly AuditEvent[],
): InterventionSummary {
  const publishedAt = intervention.publishedAt;
  const timings = recipients.map((facts) =>
    recipientTimings(intervention, facts, attendance, audit),
  );

  const firstOpened = earliestBy(timings, (t) => t.openedAt, (t) => t.memberId);
  const firstAnswered = earliestBy(timings, (t) => t.answeredAt, (t) => t.memberId);
  // Not the same person as the first to answer: somebody may have declined
  // first, and "the first who said they were coming" is the operational fact.
  const firstComing = earliestBy(
    timings.filter((t) => t.answer === 'DOLAZIM'),
    (t) => t.answeredAt,
    (t) => t.memberId,
  );
  const firstArrived = earliestBy(timings, (t) => t.arrivedAt, (t) => t.memberId);
  const firstCheckIn = earliestBy(attendance, (i) => i.startedAt, (i) => i.id);
  const firstVehicle = earliestBy(movements, (m) => m.departedAt, (m) => m.id);

  return {
    publishedAt,
    closedAt: intervention.closedAt,
    totalMs: between(publishedAt, intervention.closedAt),

    firstOpenedAt: firstOpened?.openedAt ?? null,
    toFirstOpenMs: between(publishedAt, firstOpened?.openedAt ?? null),
    firstAnsweredAt: firstAnswered?.answeredAt ?? null,
    toFirstAnswerMs: between(publishedAt, firstAnswered?.answeredAt ?? null),
    firstComingAt: firstComing?.answeredAt ?? null,
    toFirstComingMs: between(publishedAt, firstComing?.answeredAt ?? null),
    firstArrivedAt: firstArrived?.arrivedAt ?? null,
    toFirstArriveMs: between(publishedAt, firstArrived?.arrivedAt ?? null),
    firstCheckInAt: firstCheckIn?.startedAt ?? null,
    toFirstCheckInMs: between(publishedAt, firstCheckIn?.startedAt ?? null),
    firstVehicleOutAt: firstVehicle?.departedAt ?? null,
    toFirstVehicleOutMs: between(publishedAt, firstVehicle?.departedAt ?? null),

    invited: recipients.length,
    opened: timings.filter((t) => t.openedAt !== null).length,
    responded: timings.filter((t) => t.answer !== null).length,
    coming: timings.filter((t) => t.answer === 'DOLAZIM').length,
    delayed: timings.filter((t) => t.answer === 'DOLAZIM_KASNIJE').length,
    declined: timings.filter((t) => t.answer === 'NE_MOGU').length,
    arrived: timings.filter((t) => t.arrivedAt !== null).length,
    // Anybody with an attendance record at all, confirmed or not. Deliberately
    // separate from the confirmed count: a claim is not a confirmation.
    present: new Set(attendance.map((i) => i.memberId)).size,
    confirmedMembers: timings.filter((t) => t.confirmedIntervals > 0).length,
    // Summed exactly across every member, formatted once by the caller.
    confirmedMs: sumMs(timings.map((t) => t.confirmedMs)),

    states: statePeriods(intervention, audit),
    vehicles: vehiclePeriods(movements, audit),
  };
}
