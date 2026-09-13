/**
 * The record of what happened, on real server data.
 *
 * This screen is why the rest of the system is careful. A mobilisation tool is
 * only worth running if, weeks later, somebody can answer "who actually turned
 * out, and how do we know". So nothing here is summarised into a single
 * judgement: the chronology lists each fact as its own line with its own time,
 * and the participation table gives confirmed, unconfirmed and rejected their
 * own columns.
 *
 * **The one number that is participation.** Confirmed, closed time. An interval
 * a commander has not confirmed is a claim; a rejected one stays visible, with
 * its reason, and counts nothing. The screen says so in words rather than
 * expecting the reader to infer it from a column heading.
 *
 * **Two sources for the same figure, on purpose.** Per intervention the total is
 * computed here from intervals the screen already has. The all-time table is
 * read from `attendance_totals()` on the server. Both apply the identical rule,
 * so a disagreement between them is a real defect and should be visible rather
 * than hidden behind one of them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attendanceState,
  fetchAttendance,
  fetchInterventions,
  fetchParticipationTotals,
  fetchRecipientFacts,
  fetchVehicleMovements,
  formatDuration,
  participationSeconds,
  stateTimestamp,
  type AttendanceInterval,
  type Intervention,
  type ParticipationTotal,
  type RecipientFacts,
  type VehicleMovement,
} from '@/auth/operations';
import { loadRoster } from '@/auth/roster';
import { OperationalGate } from '../components/OperationalGate';
import { Chip, EmptyState, Notice, ScrollRegion } from '../components/primitives';
import {
  ATTENDANCE_SOURCE_LABEL,
  ATTENDANCE_STATE_LABEL,
  ATTENDANCE_STATE_SYMBOL,
  formatTime,
  formatTimeOrNotRecorded,
  INTERVENTION_KIND_LABEL,
  INTERVENTION_STATUS_LABEL,
  JOURNEY_LABEL,
  SERVER_ANSWER_LABEL,
} from '@/i18n/labels';

export function ArchiveView() {
  return (
    <OperationalGate allow={['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER']}>
      {() => <Archive />}
    </OperationalGate>
  );
}

interface Detail {
  readonly recipients: readonly RecipientFacts[];
  readonly attendance: readonly AttendanceInterval[];
}

const NO_DETAIL: Detail = { recipients: [], attendance: [] };

function Archive() {
  const [interventions, setInterventions] = useState<readonly Intervention[]>([]);
  const [movements, setMovements] = useState<readonly VehicleMovement[]>([]);
  const [totals, setTotals] = useState<readonly ParticipationTotal[]>([]);
  // Attendance rows carry a member id, not a name. The name is read from the
  // roster rather than copied onto the interval, so a corrected name is correct
  // everywhere at once - the one exception being a recipient list, which keeps
  // the name AT PUBLICATION on purpose.
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [detail, setDetail] = useState<Detail>(NO_DETAIL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const [list, moves, sums, roster] = await Promise.all([
        fetchInterventions(),
        fetchVehicleMovements(),
        fetchParticipationTotals(),
        loadRoster(),
      ]);
      if (!mounted.current || ticket !== generation.current) return;
      setInterventions(list);
      setMovements(moves);
      setTotals(sums);
      setNames(new Map(roster.map((member) => [member.id, member.fullName])));
      setSelectedId((current) => {
        if (current !== null && list.some((i) => i.id === current)) return current;
        return list.find((i) => i.status !== 'DRAFT')?.id ?? null;
      });
    } catch {
      if (mounted.current && ticket === generation.current) setFailed(true);
    } finally {
      if (mounted.current && ticket === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Detail follows the selection. Kept as a second read rather than loading
  // every intervention's recipients up front: an archive grows without bound.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(NO_DETAIL);
      return;
    }
    let live = true;
    void (async () => {
      const [recipients, attendance] = await Promise.all([
        fetchRecipientFacts(selectedId),
        fetchAttendance(selectedId, names),
      ]);
      if (live && mounted.current) setDetail({ recipients, attendance });
    })();
    return () => {
      live = false;
    };
  }, [selectedId, names]);

  const record = useMemo(
    () => interventions.find((i) => i.id === selectedId) ?? null,
    [interventions, selectedId],
  );
  // A draft was never published, so it has no record to show and is not offered.
  const published = useMemo(
    () => interventions.filter((i) => i.status !== 'DRAFT'),
    [interventions],
  );

  if (loading) return <p role="status">Ucitavanje arhive...</p>;

  if (failed) {
    return (
      <Notice tone="error">
        <strong>Arhiva nije ucitana.</strong> Server nije odgovorio, pa ovaj ekran ne prikazuje
        nikakav zapis - prazna tabela bi ovdje izgledala kao da se nista nije dogodilo.{' '}
        <button type="button" className="btn btn--ghost" onClick={() => void load()}>
          Pokusaj ponovo
        </button>
      </Notice>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">Zavrsene i objavljene intervencije</h2>
        {published.length === 0 ? (
          <EmptyState title="Arhiva je prazna">
            Cim komandir objavi prvi poziv, ovdje se pojavljuje njegov zapis.
          </EmptyState>
        ) : (
          <ul className="picker" data-testid="archive-list">
            {published.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`picker__item ${item.id === selectedId ? 'picker__item--on' : ''}`}
                  aria-pressed={item.id === selectedId}
                  data-testid={`archive-item-${item.id}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="picker__title">{item.title}</span>
                  <span className="picker__meta" data-testid={`archive-meta-${item.id}`}>
                    {INTERVENTION_KIND_LABEL[item.kind] ?? item.kind} -{' '}
                    {INTERVENTION_STATUS_LABEL[item.status] ?? item.status} -{' '}
                    {/*
                      The time that belongs to the state printed beside it. A
                      row reading "Zatvoreno" once showed the publication time,
                      which said the intervention was closed the moment it
                      opened. See `stateTimestamp`.
                    */}
                    {formatTimeOrNotRecorded(stateTimestamp(item))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {record === null ? null : (
        <InterventionRecord
          record={record}
          detail={detail}
          movements={movements.filter((m) => m.interventionId === record.id)}
        />
      )}

      <AllTimeTotals totals={totals} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function InterventionRecord({
  record,
  detail,
  movements,
}: {
  record: Intervention;
  detail: Detail;
  movements: readonly VehicleMovement[];
}) {
  const closed = record.closedAt !== null;
  const events = useMemo(
    () => buildChronology(record, detail, movements),
    [record, detail, movements],
  );

  const perMember = useMemo(() => {
    const rows = new Map<string, { name: string; intervals: AttendanceInterval[] }>();
    for (const interval of detail.attendance) {
      const row = rows.get(interval.memberId) ?? { name: interval.memberName, intervals: [] };
      row.intervals.push(interval);
      rows.set(interval.memberId, row);
    }
    return [...rows.entries()]
      .map(([memberId, row]) => {
        const confirmed = row.intervals.filter((i) => attendanceState(i) === 'CONFIRMED');
        return {
          memberId,
          name: row.name,
          confirmedSeconds: confirmed.reduce((sum, i) => sum + participationSeconds(i), 0),
          confirmedCount: confirmed.length,
          pending: row.intervals.filter((i) => attendanceState(i) === 'PENDING').length,
          rejected: row.intervals.filter((i) => attendanceState(i) === 'REJECTED'),
        };
      })
      .sort((a, b) => b.confirmedSeconds - a.confirmedSeconds || a.name.localeCompare(b.name));
  }, [detail.attendance]);

  const totalConfirmed = perMember.reduce((sum, row) => sum + row.confirmedSeconds, 0);
  const stillPending = perMember.reduce((sum, row) => sum + row.pending, 0);

  return (
    <>
      <section className="panel" data-testid="archive-record">
        <h2 className="panel__title" data-testid="archive-title">
          {record.title}
        </h2>
        <p className="muted small">
          {INTERVENTION_KIND_LABEL[record.kind] ?? record.kind}
          {record.otherKindNote ? ` - ${record.otherKindNote}` : ''} - {record.incidentLocation}
        </p>
        <dl className="facts" data-testid="archive-facts">
          <div>
            <dt>Kreirano</dt>
            <dd>{formatTime(record.createdAt)}</dd>
          </div>
          <div>
            <dt>Objavljeno</dt>
            <dd>{record.publishedAt ? formatTime(record.publishedAt) : 'nije objavljeno'}</dd>
          </div>
          <div>
            <dt>Zatvoreno</dt>
            <dd data-testid="archive-closed">
              {record.closedAt ? formatTime(record.closedAt) : 'jos traje'}
            </dd>
          </div>
          <div>
            <dt>Stanje</dt>
            <dd>{INTERVENTION_STATUS_LABEL[record.status] ?? record.status}</dd>
          </div>
        </dl>
        {record.closeReason ? (
          <p className="small">
            <strong>Zabiljeska pri zatvaranju:</strong> {record.closeReason}
          </p>
        ) : null}
        {closed ? null : (
          <Notice tone="warn">
            Ova intervencija jos nije zatvorena, pa zapis nije konacan. Prisustvo se jos moze
            prijaviti i potvrditi.
          </Notice>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Hronologija</h2>
        <p className="muted small">
          Svaki red je jedna cinjenica sa svojim vremenom. Nista nije spojeno u zajednicki
          &quot;status&quot;, jer otvaranje poziva, odgovor, kretanje i prisustvo su cetiri razlicite
          stvari.
        </p>
        {events.length === 0 ? (
          <EmptyState title="Nema zabiljezenih dogadjaja">
            Poziv je objavljen, ali jos niko nije otvorio, odgovorio niti se prijavio.
          </EmptyState>
        ) : (
          <ol className="timeline" data-testid="archive-timeline">
            {events.map((event) => (
              <li key={event.key} className="timeline__row">
                <span className="timeline__time mono small">{formatTime(event.at)}</span>
                <span className="timeline__what">
                  <strong>{event.who}</strong> {event.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Ucesce na ovoj intervenciji</h2>
        <p className="muted small">
          Ucesce je <strong>samo potvrdjeno i zatvoreno vrijeme</strong>. Prijava koju komandir nije
          potvrdio je i dalje samo izjava i ne ulazi u zbir. Odbijena prijava ostaje u zapisu sa
          razlogom i ne broji se.
        </p>
        {perMember.length === 0 ? (
          <EmptyState title="Niko nije prijavio prisustvo">
            Odziv i kretanje se i dalje vide u hronologiji iznad.
          </EmptyState>
        ) : (
          <>
            <p className="small" data-testid="archive-total">
              Ukupno potvrdjeno: <strong>{formatDuration(totalConfirmed)}</strong>
              {stillPending > 0 ? (
                <>
                  {' '}
                  - <span data-testid="archive-pending">{stillPending}</span> prijava jos ceka
                  potvrdu komandira i nije uracunata.
                </>
              ) : null}
            </p>
            <ScrollRegion label="Ucesce po clanu na ovoj intervenciji">
              <table className="table" data-testid="archive-participation">
                <thead>
                  <tr>
                    <th scope="col">Clan</th>
                    <th scope="col">Potvrdjeno</th>
                    <th scope="col">Ceka potvrdu</th>
                    <th scope="col">Odbijeno</th>
                  </tr>
                </thead>
                <tbody>
                  {perMember.map((row) => (
                    <tr key={row.memberId}>
                      <th scope="row">{row.name}</th>
                      <td>
                        {row.confirmedCount > 0 ? (
                          <Chip tone="yes" symbol={ATTENDANCE_STATE_SYMBOL.CONFIRMED ?? '+'}>
                            {formatDuration(row.confirmedSeconds)}
                          </Chip>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        {row.pending > 0 ? (
                          <Chip tone="later" symbol={ATTENDANCE_STATE_SYMBOL.PENDING ?? '~'}>
                            {row.pending} {row.pending === 1 ? 'prijava' : 'prijave'}
                          </Chip>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        {row.rejected.length > 0 ? (
                          <span>
                            <Chip tone="no" symbol={ATTENDANCE_STATE_SYMBOL.REJECTED ?? '-'}>
                              {ATTENDANCE_STATE_LABEL.REJECTED ?? 'Odbijeno'}
                            </Chip>
                            <span className="small muted">
                              {' '}
                              {row.rejected
                                .map((i) => i.rejectionReason ?? 'bez upisanog razloga')
                                .join('; ')}
                            </span>
                          </span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Vozila</h2>
        <p className="muted small">
          Izlazak vozila je zapis o vozilu. On nikada ne stvara prisustvo clana - to je posebna
          cinjenica koju clan prijavljuje sam.
        </p>
        {movements.length === 0 ? (
          <EmptyState title="Nijedno vozilo nije evidentirano na ovoj intervenciji" />
        ) : (
          <ScrollRegion label="Vozila na ovoj intervenciji">
            <table className="table" data-testid="archive-vehicles">
              <thead>
                <tr>
                  <th scope="col">Vozilo</th>
                  <th scope="col">Izlazak</th>
                  <th scope="col">Povratak</th>
                  <th scope="col">Namjena</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <th scope="row">
                      {movement.callsign} - {movement.vehicleName}
                    </th>
                    <td className="small mono">{formatTime(movement.departedAt)}</td>
                    <td className="small mono">
                      {movement.returnedAt ? formatTime(movement.returnedAt) : 'jos nije vraceno'}
                    </td>
                    <td className="small">{movement.purpose ?? '-'}</td>
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

// ---------------------------------------------------------------------------

/**
 * Every recorded fact about one intervention, in the order it happened.
 *
 * Deliberately built from separate reads rather than a server-side event log:
 * the rows ARE the log, and reconstructing the order from their timestamps
 * proves the facts were stored separately in the first place.
 */
interface ChronologyEvent {
  readonly key: string;
  readonly at: string;
  readonly who: string;
  readonly text: string;
}

function buildChronology(
  record: Intervention,
  detail: Detail,
  movements: readonly VehicleMovement[],
): readonly ChronologyEvent[] {
  const events: ChronologyEvent[] = [];

  if (record.publishedAt !== null) {
    events.push({
      key: 'published',
      at: record.publishedAt,
      who: 'Komandir',
      // Never "obavijesteni". Publishing writes obligations; no transport exists.
      text: `je objavio poziv i upisao ${detail.recipients.length} obaveza za slanje (bez stvarnog slanja).`,
    });
  }

  for (const person of detail.recipients) {
    if (person.acknowledgedAt !== null) {
      events.push({
        key: `ack-${person.memberId}`,
        at: person.acknowledgedAt,
        who: person.memberName,
        text: 'je otvorio poziv.',
      });
    }
    if (person.answer !== null && person.answeredAt !== null) {
      const answer = SERVER_ANSWER_LABEL[person.answer] ?? person.answer;
      const eta = person.etaMinutes !== null ? ` (za ${person.etaMinutes} min)` : '';
      events.push({
        key: `answer-${person.memberId}`,
        at: person.answeredAt,
        who: person.memberName,
        text: `je odgovorio: ${answer}${eta}.`,
      });
    }
    if (person.journey !== null && person.journeyAt !== null) {
      events.push({
        key: `journey-${person.memberId}`,
        at: person.journeyAt,
        who: person.memberName,
        // "Na licu mjesta" is a statement about movement. It is not attendance,
        // and this sentence must not let a reader think it was recorded as one.
        text: `je javio kretanje: ${JOURNEY_LABEL[person.journey] ?? person.journey}.`,
      });
    }
  }

  for (const interval of detail.attendance) {
    const source = ATTENDANCE_SOURCE_LABEL[interval.source] ?? interval.source;
    events.push({
      key: `in-${interval.id}`,
      at: interval.startedAt,
      who: interval.memberName,
      text: `je prijavljen kao prisutan (${source.toLowerCase()}).`,
    });
    if (interval.endedAt !== null) {
      events.push({
        key: `out-${interval.id}`,
        at: interval.endedAt,
        who: interval.memberName,
        text: 'je odjavio prisustvo.',
      });
    }
    if (interval.rejectedAt !== null) {
      events.push({
        key: `rej-${interval.id}`,
        at: interval.rejectedAt,
        who: 'Komandir',
        text: `je odbio prijavu clana ${interval.memberName}: ${
          interval.rejectionReason ?? 'bez upisanog razloga'
        }`,
      });
    }
  }

  for (const movement of movements) {
    events.push({
      key: `dep-${movement.id}`,
      at: movement.departedAt,
      who: `${movement.callsign} ${movement.vehicleName}`,
      text: `je izaslo iz baze${movement.purpose ? ` - ${movement.purpose}` : ''}.`,
    });
    if (movement.returnedAt !== null) {
      events.push({
        key: `ret-${movement.id}`,
        at: movement.returnedAt,
        who: `${movement.callsign} ${movement.vehicleName}`,
        text: 'se vratilo u bazu.',
      });
    }
  }

  if (record.closedAt !== null) {
    events.push({
      key: 'closed',
      at: record.closedAt,
      who: 'Komandir',
      text: `je zatvorio intervenciju${record.closeReason ? `: ${record.closeReason}` : '.'}`,
    });
  }

  return events.sort((a, b) => {
    const diff = new Date(a.at).getTime() - new Date(b.at).getTime();
    // Ties are possible when two rows share a transaction time. Fall back to a
    // stable key so the order does not shuffle between renders.
    return diff !== 0 ? diff : a.key.localeCompare(b.key);
  });
}

// ---------------------------------------------------------------------------

function AllTimeTotals({ totals }: { totals: readonly ParticipationTotal[] }) {
  const sorted = useMemo(
    () =>
      [...totals].sort(
        (a, b) => b.confirmedSeconds - a.confirmedSeconds || a.memberName.localeCompare(b.memberName),
      ),
    [totals],
  );

  return (
    <section className="panel">
      <h2 className="panel__title">Ukupno ucesce po clanu</h2>
      <p className="muted small">
        Zbir svih intervencija, izracunat na serveru. Potvrdjeno, nepotvrdjeno i odbijeno stoje u
        odvojenim kolonama i nikada se ne sabiraju u jedan broj.
      </p>
      {sorted.length === 0 ? (
        <EmptyState title="Jos nema zabiljezenog prisustva">
          Tabela se popunjava kada se prijavi i potvrdi prvo prisustvo.
        </EmptyState>
      ) : (
        <ScrollRegion label="Ukupno ucesce po clanu">
          <table className="table" data-testid="archive-totals">
            <thead>
              <tr>
                <th scope="col">Clan</th>
                <th scope="col">Potvrdjeno vrijeme</th>
                <th scope="col">Potvrdjenih</th>
                <th scope="col">Ceka potvrdu</th>
                <th scope="col">U toku</th>
                <th scope="col">Odbijeno</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.memberId}>
                  <th scope="row">{row.memberName}</th>
                  <td data-testid={`total-confirmed-${row.memberId}`}>
                    <strong>{formatDuration(row.confirmedSeconds)}</strong>
                  </td>
                  <td>{row.confirmedIntervals}</td>
                  <td>
                    {row.unverifiedIntervals > 0 ? (
                      <span>
                        {row.unverifiedIntervals}{' '}
                        <span className="muted small">
                          ({formatDuration(row.unverifiedSeconds)} neuracunato)
                        </span>
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>{row.openIntervals > 0 ? row.openIntervals : <span className="muted">-</span>}</td>
                  <td>
                    {row.rejectedIntervals > 0 ? (
                      row.rejectedIntervals
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </section>
  );
}
