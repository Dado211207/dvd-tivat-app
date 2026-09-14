/**
 * The operational timings, on screen.
 *
 * Presentation only. Every value arrives already computed by
 * `src/auth/metrics.ts` from server timestamps, so nothing here does
 * arithmetic on a clock or a formatted string - which is the rule that keeps a
 * duration in a detail row and the same duration in a total from disagreeing.
 *
 * Used by BOTH the commander's console and the archive, deliberately. The same
 * incident looked at live and looked at six months later must show the same
 * numbers under the same labels, and two implementations of that promise is one
 * too many.
 *
 * **Every fact keeps its own label.** Publication to opening, publication to
 * answer, opening to answer and publication to arrival share a cell when the
 * screen is narrow, but never a label: a single "vrijeme odaziva" would have to
 * pick one of them and throw three away, and a commander reviewing a slow
 * turnout needs to know WHICH part was slow.
 *
 * **The panels are exported separately** as well as together. The commander's
 * console has nothing of its own to say about an incident and takes the whole
 * `OperationalSummary`; the archive already carries a chronology, a
 * participation ledger with rejection reasons, and a record header, so it
 * composes the individual panels around them instead of printing a second copy
 * of each table.
 */

import type { InterventionSummary, RecipientTimings } from '@/auth/metrics';
import { formatDurationOrNotMeasured } from '@/auth/duration';
import { formatTimeOrNotRecorded, notRecorded } from '@/i18n/labels';
import { useText } from '@/i18n/useText';
import { EmptyState, ScrollRegion } from './primitives';

/** One labelled fact inside a cell. The label is never dropped to save space. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="fact-line">
      <span className="fact-line__label">{label}</span>
      <span className="fact-line__value">{value}</span>
    </span>
  );
}

/**
 * Every recorded time and duration, per invited member.
 *
 * The review that prompted this found the commander's overview showing five
 * states per member and not one duration - a commander could see THAT somebody
 * answered, never how long it took.
 */
export function ResponseTimings({
  timings,
  testId = 'response-timings',
}: {
  timings: readonly RecipientTimings[];
  testId?: string;
}) {
  const t = useText();
  if (timings.length === 0) {
    return <EmptyState title={t.timings.nobodyInvited} />;
  }

  return (
    <ScrollRegion label={t.timings.perMemberLabel} className="table-wrap table-wrap--cards">
      <table className="table table--cards" data-testid={testId}>
        <thead>
          <tr>
            <th scope="col">{t.timings.colMember}</th>
            <th scope="col">{t.timings.colOpened}</th>
            <th scope="col">{t.timings.colAnswer}</th>
            <th scope="col">{t.timings.colMovement}</th>
            <th scope="col">{t.timings.colArrival}</th>
            <th scope="col">{t.timings.colAttendance}</th>
          </tr>
        </thead>
        <tbody>
          {timings.map((row) => (
            <tr key={row.memberId} data-testid={`timing-row-${row.memberId}`}>
              <th scope="row">{row.memberName}</th>

              <td data-label={t.timings.colOpened}>
                <Fact label={t.timings.factTime} value={formatTimeOrNotRecorded(row.openedAt)} />
                <Fact label={t.timings.factSincePublication} value={formatDurationOrNotMeasured(row.toOpenMs)} />
              </td>

              <td data-label={t.timings.colAnswer}>
                <Fact
                  label={t.timings.colAnswer}
                  value={
                    row.answer === null
                      ? notRecorded()
                      : t.vocabulary.answer[row.answer] ?? row.answer
                  }
                />
                <Fact label={t.timings.factTime} value={formatTimeOrNotRecorded(row.answeredAt)} />
                <Fact label={t.timings.factSincePublication} value={formatDurationOrNotMeasured(row.toAnswerMs)} />
                <Fact label={t.timings.factSinceOpening} value={formatDurationOrNotMeasured(row.openToAnswerMs)} />
                {/* The member's own estimate, never a measurement, and labelled
                    so it cannot be mistaken for one. */}
                <Fact
                  label={t.timings.factEstimate}
                  value={
                    row.etaMinutes === null
                      ? notRecorded()
                      : `${row.etaMinutes} ${t.timings.minutesShort}`
                  }
                />
              </td>

              <td data-label={t.timings.colMovement}>
                {row.movements.length === 0 ? (
                  <Fact label={t.timings.factReported} value={notRecorded()} />
                ) : (
                  row.movements.map((m) => (
                    <Fact
                      key={`${m.step}-${m.at}`}
                      label={t.vocabulary.journey[m.step] ?? m.step}
                      value={formatTimeOrNotRecorded(m.at)}
                    />
                  ))
                )}
              </td>

              <td data-label={t.timings.colArrival}>
                {/* Arrival is the member's statement that they are on scene. It
                    is not attendance, which is the column beside it. */}
                <Fact label={t.timings.factOnScene} value={formatTimeOrNotRecorded(row.arrivedAt)} />
                <Fact label={t.timings.factSincePublication} value={formatDurationOrNotMeasured(row.toArriveMs)} />
              </td>

              <td data-label={t.timings.colAttendance}>
                <Fact label={t.timings.factCheckIn} value={formatTimeOrNotRecorded(row.firstCheckInAt)} />
                <Fact
                  label={t.timings.factCheckOut}
                  value={
                    row.stillCheckedIn
                      ? t.timings.factStillCheckedIn
                      : formatTimeOrNotRecorded(row.lastCheckOutAt)
                  }
                />
                <Fact label={t.timings.factConfirmed} value={formatDurationOrNotMeasured(row.confirmedMs)} />
                {row.pendingIntervals > 0 ? (
                  <Fact label={t.timings.factAwaitingConfirmation} value={`${row.pendingIntervals}`} />
                ) : null}
                {row.rejectedIntervals > 0 ? (
                  <Fact label={t.timings.factRejected} value={`${row.rejectedIntervals}`} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** One headline figure: a moment and the duration from publication to it. */
function Milestone({
  label,
  at,
  ms,
  testId,
}: {
  label: string;
  at: string | null;
  ms: number | null;
  testId: string;
}) {
  return (
    <div className="milestone" data-testid={testId}>
      <div className="milestone__label">{label}</div>
      <div className="milestone__value">{formatDurationOrNotMeasured(ms)}</div>
      {/* The instant under the duration, and only when there is one. An event
          that never happened would otherwise print "Nije zabiljezeno" twice,
          which reads as two separate missing facts rather than one. */}
      {at === null ? null : <div className="milestone__at">{formatTimeOrNotRecorded(at)}</div>}
    </div>
  );
}

/**
 * A duration that has not finished yet, said as such.
 *
 * "Jos traje" and "Nije zabiljezeno" are different statements and the screen
 * must not use one for the other: an intervention still running, a member still
 * checked in and a vehicle still out all HAVE a start - what they do not have
 * is an end, and calling that unrecorded would suggest somebody failed to write
 * something down.
 */
function ongoingOr(ms: number | null, stillRunning: boolean, running: string): string {
  if (stillRunning) return running;
  return formatDurationOrNotMeasured(ms);
}

/**
 * The whole intervention, in numbers: milestones, counts, state periods and
 * vehicles.
 *
 * Every "first" here was chosen by comparing timestamps, not by list order -
 * see `earliestBy` in `src/auth/metrics.ts`.
 */
export function OperationalSummary({
  summary,
  testId = 'operational-summary',
}: {
  summary: InterventionSummary;
  testId?: string;
}) {
  return (
    <div className="stack" data-testid={testId}>
      <MilestonePanel summary={summary} />
      <InterventionDurationPanel summary={summary} />
      <SummaryCounts summary={summary} />
      <VehiclePanel summary={summary} />
    </div>
  );
}

/** The first of each kind of event, and how long after publication it happened. */
export function MilestonePanel({ summary }: { summary: InterventionSummary }) {
  const t = useText();
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">{t.timings.societyTitle}</h2>
        <p className="muted small">{t.timings.societyNote}</p>
        <div className="milestones">
          <Milestone
            label={t.timings.firstOpen}
            at={summary.firstOpenedAt}
            ms={summary.toFirstOpenMs}
            testId="first-open"
          />
          <Milestone
            label={t.timings.firstAnswer}
            at={summary.firstAnsweredAt}
            ms={summary.toFirstAnswerMs}
            testId="first-answer"
          />
          {/* Not the same as the first answer: somebody may have declined
              first, and "the first who said they were coming" is the
              operational fact a commander acts on. */}
          <Milestone
            label={t.timings.firstComing}
            at={summary.firstComingAt}
            ms={summary.toFirstComingMs}
            testId="first-coming"
          />
          <Milestone
            label={t.timings.firstArrive}
            at={summary.firstArrivedAt}
            ms={summary.toFirstArriveMs}
            testId="first-arrive"
          />
          <Milestone
            label={t.timings.firstCheckIn}
            at={summary.firstCheckInAt}
            ms={summary.toFirstCheckInMs}
            testId="first-checkin"
          />
          <Milestone
            label={t.timings.firstVehicle}
            at={summary.firstVehicleOutAt}
            ms={summary.toFirstVehicleOutMs}
            testId="first-vehicle"
          />
        </div>
      </section>
    </>
  );
}

/**
 * How long the intervention ran, and how long it spent in each state.
 *
 * The state table names the actor behind every transition. An intervention
 * record that says it was "Pod kontrolom" for two hours without saying who
 * decided that is an incomplete record.
 */
export function InterventionDurationPanel({ summary }: { summary: InterventionSummary }) {
  const t = useText();
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">{t.timings.durationTitle}</h2>
        <dl className="facts" data-testid="intervention-duration">
          <div>
            <dt>{t.timings.published}</dt>
            <dd>{formatTimeOrNotRecorded(summary.publishedAt)}</dd>
          </div>
          <div>
            <dt>{t.timings.closed}</dt>
            <dd>{summary.closedAt === null ? t.timings.stillRunning : formatTimeOrNotRecorded(summary.closedAt)}</dd>
          </div>
          <div>
            <dt>{t.timings.totalDuration}</dt>
            <dd data-testid="total-duration">
              {ongoingOr(summary.totalMs, summary.closedAt === null && summary.publishedAt !== null, t.timings.stillRunning)}
            </dd>
          </div>
          <div>
            <dt>{t.timings.totalConfirmed}</dt>
            <dd data-testid="total-confirmed">{formatDurationOrNotMeasured(summary.confirmedMs)}</dd>
          </div>
        </dl>

        {summary.states.length === 0 ? null : (
          <ScrollRegion label={t.timings.statePeriodsLabel} className="table-wrap table-wrap--cards">
            <table className="table table--cards" data-testid="state-periods">
              <thead>
                <tr>
                  <th scope="col">{t.timings.colState}</th>
                  <th scope="col">{t.timings.colFrom}</th>
                  <th scope="col">{t.timings.colTo}</th>
                  <th scope="col">{t.timings.colDuration}</th>
                  <th scope="col">{t.timings.colChangedBy}</th>
                </tr>
              </thead>
              <tbody>
                {summary.states.map((period) => (
                  <tr key={`${period.status}-${period.from}`}>
                    <th scope="row">
                      {t.vocabulary.interventionStatus[period.status] ?? period.status}
                    </th>
                    <td data-label={t.timings.colFrom} className="small mono">
                      {formatTimeOrNotRecorded(period.from)}
                    </td>
                    <td data-label={t.timings.colTo} className="small mono">
                      {period.to === null ? t.timings.stillRunning : formatTimeOrNotRecorded(period.to)}
                    </td>
                    <td data-label={t.timings.colDuration}>
                      {ongoingOr(period.durationMs, period.to === null, t.timings.stillRunning)}
                    </td>
                    <td data-label={t.timings.colChangedBy}>
                      {/* The first period was created by publishing, not
                          entered by a transition, so it names nobody. */}
                      {period.enteredBy ?? t.timings.byPublication}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
    </>
  );
}

/** Nine tallies, each its own fact, none of them implying another. */
export function SummaryCounts({ summary }: { summary: InterventionSummary }) {
  const t = useText();
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">{t.timings.countsTitle}</h2>
        <p className="muted small">{t.timings.countsNote}</p>
        <div className="totals" data-testid="summary-counts">
          <Tally label={t.timings.tallyInvited} value={summary.invited} testId="tally-invited" />
          <Tally label={t.timings.tallyOpened} value={summary.opened} testId="tally-opened" />
          <Tally label={t.timings.tallyResponded} value={summary.responded} testId="tally-responded" />
          <Tally label={t.timings.tallyComing} value={summary.coming} testId="tally-coming" />
          <Tally label={t.timings.tallyDelayed} value={summary.delayed} testId="tally-delayed" />
          <Tally label={t.timings.tallyDeclined} value={summary.declined} testId="tally-declined" />
          <Tally label={t.timings.tallyArrived} value={summary.arrived} testId="tally-arrived" />
          <Tally label={t.timings.tallyPresent} value={summary.present} testId="tally-present" />
          <Tally label={t.timings.tallyConfirmed} value={summary.confirmedMembers} testId="tally-confirmed" />
        </div>
      </section>
    </>
  );
}

/**
 * Each vehicle, with the time it spent away from the station and both actors.
 *
 * The review found the archive showing departure and return times and no
 * duration. Subtracting two timestamps in your head while reading a record is
 * exactly the arithmetic a record exists to have already done.
 */
export function VehiclePanel({ summary }: { summary: InterventionSummary }) {
  const t = useText();
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">{t.timings.vehiclesTitle}</h2>
        <p className="muted small">{t.timings.vehiclesNote}</p>
        {summary.vehicles.length === 0 ? (
          <EmptyState title={t.timings.noVehicles} />
        ) : (
          <ScrollRegion label={t.timings.vehiclesLabel} className="table-wrap table-wrap--cards">
            <table className="table table--cards" data-testid="vehicle-periods">
              <thead>
                <tr>
                  <th scope="col">{t.timings.colVehicle}</th>
                  <th scope="col">{t.timings.colDeparture}</th>
                  <th scope="col">{t.timings.colReturn}</th>
                  <th scope="col">{t.timings.colAway}</th>
                  <th scope="col">{t.timings.colDepartureBy}</th>
                  <th scope="col">{t.timings.colReturnBy}</th>
                  <th scope="col">{t.timings.colPurpose}</th>
                </tr>
              </thead>
              <tbody>
                {summary.vehicles.map((vehicle) => (
                  <tr key={vehicle.movementId}>
                    <th scope="row">
                      {vehicle.callsign} - {vehicle.vehicleName}
                    </th>
                    <td data-label={t.timings.colDeparture} className="small mono">
                      {formatTimeOrNotRecorded(vehicle.departedAt)}
                    </td>
                    <td data-label={t.timings.colReturn} className="small mono">
                      {vehicle.returnedAt === null
                        ? t.timings.notReturned
                        : formatTimeOrNotRecorded(vehicle.returnedAt)}
                    </td>
                    <td data-label={t.timings.colAway}>
                      {ongoingOr(vehicle.awayMs, vehicle.returnedAt === null, t.timings.stillAway)}
                    </td>
                    <td data-label={t.timings.colDepartureBy} className="small">
                      {vehicle.departedBy ?? notRecorded()}
                    </td>
                    <td data-label={t.timings.colReturnBy} className="small">
                      {vehicle.returnedBy ?? notRecorded()}
                    </td>
                    <td data-label={t.timings.colPurpose} className="small">
                      {vehicle.purpose ?? t.timings.purposeNotRecorded}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
    </>
  );
}

function Tally({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="total" data-testid={testId}>
      <div className="total__num">{value}</div>
      <div className="total__label">{label}</div>
    </div>
  );
}
