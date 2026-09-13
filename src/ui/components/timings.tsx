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
import {
  formatTimeOrNotRecorded,
  INTERVENTION_STATUS_LABEL,
  JOURNEY_LABEL,
  SERVER_ANSWER_LABEL,
} from '@/i18n/labels';
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
  if (timings.length === 0) {
    return <EmptyState title="Niko nije pozvan na ovu intervenciju" />;
  }

  return (
    <ScrollRegion label="Vremena odziva po clanu" className="table-wrap table-wrap--cards">
      <table className="table table--cards" data-testid={testId}>
        <thead>
          <tr>
            <th scope="col">Clan</th>
            <th scope="col">Otvaranje</th>
            <th scope="col">Odgovor</th>
            <th scope="col">Kretanje</th>
            <th scope="col">Dolazak</th>
            <th scope="col">Prisustvo</th>
          </tr>
        </thead>
        <tbody>
          {timings.map((t) => (
            <tr key={t.memberId} data-testid={`timing-row-${t.memberId}`}>
              <th scope="row">{t.memberName}</th>

              <td data-label="Otvaranje">
                <Fact label="Vrijeme" value={formatTimeOrNotRecorded(t.openedAt)} />
                <Fact label="Od objave" value={formatDurationOrNotMeasured(t.toOpenMs)} />
              </td>

              <td data-label="Odgovor">
                <Fact
                  label="Odgovor"
                  value={t.answer === null ? 'Nije zabiljezeno' : SERVER_ANSWER_LABEL[t.answer] ?? t.answer}
                />
                <Fact label="Vrijeme" value={formatTimeOrNotRecorded(t.answeredAt)} />
                <Fact label="Od objave" value={formatDurationOrNotMeasured(t.toAnswerMs)} />
                <Fact label="Od otvaranja" value={formatDurationOrNotMeasured(t.openToAnswerMs)} />
                {/* The member's own estimate, never a measurement, and labelled
                    so it cannot be mistaken for one. */}
                <Fact
                  label="Najavio (procjena)"
                  value={t.etaMinutes === null ? 'Nije zabiljezeno' : `${t.etaMinutes} min`}
                />
              </td>

              <td data-label="Kretanje">
                {t.movements.length === 0 ? (
                  <Fact label="Javljeno" value="Nije zabiljezeno" />
                ) : (
                  t.movements.map((m) => (
                    <Fact
                      key={`${m.step}-${m.at}`}
                      label={JOURNEY_LABEL[m.step] ?? m.step}
                      value={formatTimeOrNotRecorded(m.at)}
                    />
                  ))
                )}
              </td>

              <td data-label="Dolazak">
                {/* Arrival is the member's statement that they are on scene. It
                    is not attendance, which is the column beside it. */}
                <Fact label="Na licu mjesta" value={formatTimeOrNotRecorded(t.arrivedAt)} />
                <Fact label="Od objave" value={formatDurationOrNotMeasured(t.toArriveMs)} />
              </td>

              <td data-label="Prisustvo">
                <Fact label="Prijava" value={formatTimeOrNotRecorded(t.firstCheckInAt)} />
                <Fact
                  label="Odjava"
                  value={
                    t.stillCheckedIn ? 'Jos je prijavljen' : formatTimeOrNotRecorded(t.lastCheckOutAt)
                  }
                />
                <Fact label="Potvrdjeno" value={formatDurationOrNotMeasured(t.confirmedMs)} />
                {t.pendingIntervals > 0 ? (
                  <Fact label="Ceka potvrdu" value={`${t.pendingIntervals}`} />
                ) : null}
                {t.rejectedIntervals > 0 ? (
                  <Fact label="Odbijeno" value={`${t.rejectedIntervals}`} />
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
      <div className="milestone__at">{formatTimeOrNotRecorded(at)}</div>
    </div>
  );
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
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">Vremena odziva drustva</h2>
        <p className="muted small">
          Svako vrijeme je mjereno od objave poziva, iz vremena koje je upisao server. Prvi
          dogadjaj je izabran po vremenu, nikada po redoslijedu u spisku.
        </p>
        <div className="milestones">
          <Milestone
            label="Prvo otvaranje poziva"
            at={summary.firstOpenedAt}
            ms={summary.toFirstOpenMs}
            testId="first-open"
          />
          <Milestone
            label="Prvi odgovor"
            at={summary.firstAnsweredAt}
            ms={summary.toFirstAnswerMs}
            testId="first-answer"
          />
          {/* Not the same as the first answer: somebody may have declined
              first, and "the first who said they were coming" is the
              operational fact a commander acts on. */}
          <Milestone
            label="Prvi odgovor Dolazim"
            at={summary.firstComingAt}
            ms={summary.toFirstComingMs}
            testId="first-coming"
          />
          <Milestone
            label="Prvi dolazak na lice mjesta"
            at={summary.firstArrivedAt}
            ms={summary.toFirstArriveMs}
            testId="first-arrive"
          />
          <Milestone
            label="Prva prijava prisustva"
            at={summary.firstCheckInAt}
            ms={summary.toFirstCheckInMs}
            testId="first-checkin"
          />
          <Milestone
            label="Prvi izlazak vozila"
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
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">Trajanje intervencije</h2>
        <dl className="facts" data-testid="intervention-duration">
          <div>
            <dt>Objavljeno</dt>
            <dd>{formatTimeOrNotRecorded(summary.publishedAt)}</dd>
          </div>
          <div>
            <dt>Zatvoreno</dt>
            <dd>{summary.closedAt === null ? 'Jos traje' : formatTimeOrNotRecorded(summary.closedAt)}</dd>
          </div>
          <div>
            <dt>Ukupno trajanje</dt>
            <dd data-testid="total-duration">{formatDurationOrNotMeasured(summary.totalMs)}</dd>
          </div>
          <div>
            <dt>Ukupno potvrdjeno ucesce</dt>
            <dd data-testid="total-confirmed">{formatDurationOrNotMeasured(summary.confirmedMs)}</dd>
          </div>
        </dl>

        {summary.states.length === 0 ? null : (
          <ScrollRegion label="Vrijeme provedeno u svakom stanju" className="table-wrap table-wrap--cards">
            <table className="table table--cards" data-testid="state-periods">
              <thead>
                <tr>
                  <th scope="col">Stanje</th>
                  <th scope="col">Od</th>
                  <th scope="col">Do</th>
                  <th scope="col">Trajanje</th>
                  <th scope="col">Promijenio</th>
                </tr>
              </thead>
              <tbody>
                {summary.states.map((period) => (
                  <tr key={`${period.status}-${period.from}`}>
                    <th scope="row">
                      {INTERVENTION_STATUS_LABEL[period.status] ?? period.status}
                    </th>
                    <td data-label="Od" className="small mono">
                      {formatTimeOrNotRecorded(period.from)}
                    </td>
                    <td data-label="Do" className="small mono">
                      {period.to === null ? 'Jos traje' : formatTimeOrNotRecorded(period.to)}
                    </td>
                    <td data-label="Trajanje">{formatDurationOrNotMeasured(period.durationMs)}</td>
                    <td data-label="Promijenio">
                      {/* The first period was created by publishing, not
                          entered by a transition, so it names nobody. */}
                      {period.enteredBy ?? 'Objavom poziva'}
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
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">Odziv u brojkama</h2>
        <p className="muted small">
          Svaka brojka je svoja cinjenica. Ko je otvorio poziv nije ko je odgovorio, ko je
          odgovorio nije ko je dosao, a prijavljeno prisustvo nije potvrdjeno prisustvo.
        </p>
        <div className="totals" data-testid="summary-counts">
          <Tally label="Pozvano" value={summary.invited} testId="tally-invited" />
          <Tally label="Otvorilo" value={summary.opened} testId="tally-opened" />
          <Tally label="Odgovorilo" value={summary.responded} testId="tally-responded" />
          <Tally label="Dolazim" value={summary.coming} testId="tally-coming" />
          <Tally label="Dolazim kasnije" value={summary.delayed} testId="tally-delayed" />
          <Tally label="Ne mogu" value={summary.declined} testId="tally-declined" />
          <Tally label="Javilo dolazak" value={summary.arrived} testId="tally-arrived" />
          <Tally label="Prijavilo prisustvo" value={summary.present} testId="tally-present" />
          <Tally label="Potvrdjeno prisustvo" value={summary.confirmedMembers} testId="tally-confirmed" />
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
  return (
    <>
      <section className="panel">
        <h2 className="panel__title">Vozila</h2>
        <p className="muted small">
          Izlazak vozila je zapis o vozilu. On nikada ne stvara prisustvo clana - to je posebna
          cinjenica koju clan prijavljuje sam.
        </p>
        {summary.vehicles.length === 0 ? (
          <EmptyState title="Nijedno vozilo nije evidentirano na ovoj intervenciji" />
        ) : (
          <ScrollRegion label="Vozila i vrijeme van baze" className="table-wrap table-wrap--cards">
            <table className="table table--cards" data-testid="vehicle-periods">
              <thead>
                <tr>
                  <th scope="col">Vozilo</th>
                  <th scope="col">Izlazak</th>
                  <th scope="col">Povratak</th>
                  <th scope="col">Van baze</th>
                  <th scope="col">Evidentirao izlazak</th>
                  <th scope="col">Evidentirao povratak</th>
                  <th scope="col">Namjena</th>
                </tr>
              </thead>
              <tbody>
                {summary.vehicles.map((vehicle) => (
                  <tr key={vehicle.movementId}>
                    <th scope="row">
                      {vehicle.callsign} - {vehicle.vehicleName}
                    </th>
                    <td data-label="Izlazak" className="small mono">
                      {formatTimeOrNotRecorded(vehicle.departedAt)}
                    </td>
                    <td data-label="Povratak" className="small mono">
                      {vehicle.returnedAt === null
                        ? 'Jos nije vraceno'
                        : formatTimeOrNotRecorded(vehicle.returnedAt)}
                    </td>
                    <td data-label="Van baze">{formatDurationOrNotMeasured(vehicle.awayMs)}</td>
                    <td data-label="Evidentirao izlazak" className="small">
                      {vehicle.departedBy ?? 'Nije zabiljezeno'}
                    </td>
                    <td data-label="Evidentirao povratak" className="small">
                      {vehicle.returnedBy ?? 'Nije zabiljezeno'}
                    </td>
                    <td data-label="Namjena" className="small">
                      {vehicle.purpose ?? 'Nije upisana'}
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
