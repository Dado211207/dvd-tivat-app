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
  fetchInterventionAudit,
  fetchInterventions,
  fetchParticipationTotals,
  fetchRecipientFacts,
  fetchVehicleMovements,
  participationMs,
  stateTimestamp,
  type AttendanceInterval,
  type AuditEvent,
  type Intervention,
  type ParticipationTotal,
  type RecipientFacts,
  type VehicleMovement,
} from '@/auth/operations';
import { formatDurationMs } from '@/auth/duration';
import { recipientTimings, summarise } from '@/auth/metrics';
import { loadRoster } from '@/auth/roster';
import { OperationalGate } from '../components/OperationalGate';
import { Chip, EmptyState, Notice, ScrollRegion } from '../components/primitives';
import {
  InterventionDurationPanel,
  MilestonePanel,
  ResponseTimings,
  SummaryCounts,
  VehiclePanel,
} from '../components/timings';
import {
  ATTENDANCE_STATE_SYMBOL,
  endSentence,
  formatTime,
  formatTimeOrNotRecorded,
  forSentence,
} from '@/i18n/labels';
import type { Strings } from '@/i18n/strings.me';
import { useText } from '@/i18n/useText';

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
  /**
   * The recorded chronology, or null when it could not be read.
   *
   * Null is not "nothing happened". The screen falls back to the chronology it
   * can reconstruct from current-state rows and says so, rather than quietly
   * showing a shorter history as though it were the whole one.
   */
  readonly audit: readonly AuditEvent[] | null;
}

const NO_DETAIL: Detail = { recipients: [], attendance: [], audit: null };

function Archive() {
  const t = useText();
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
    // Clear first: merging into the previous record's detail would show one
    // intervention's chronology under another's heading for a moment.
    setDetail(NO_DETAIL);
    if (selectedId === null) return;
    let live = true;
    void (async () => {
      const [recipients, attendance] = await Promise.all([
        fetchRecipientFacts(selectedId),
        fetchAttendance(selectedId, names),
      ]);
      if (live && mounted.current) setDetail((current) => ({ ...current, recipients, attendance }));
    })();

    /*
     * The chronology is read SEPARATELY, not alongside the two above.
     *
     * A `Promise.all` is only as fast as its slowest member, so one read that
     * hangs - an unreachable project, a socket a proxy will not close - would
     * hold back the recipients and the attendance too, and the record would sit
     * empty as though nothing had happened. This way the facts arrive when they
     * arrive and the chronology fills in after, or says it could not be read.
     */
    void (async () => {
      const audit = await fetchInterventionAudit(selectedId);
      if (live && mounted.current) setDetail((current) => ({ ...current, audit }));
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

  if (loading) return <p role="status">{t.archive.loading}</p>;

  if (failed) {
    return (
      <Notice tone="error">
        <strong>{t.archive.failedTitle}</strong> {t.archive.failedText}{' '}
        <button type="button" className="btn btn--ghost" onClick={() => void load()}>
          {t.gate.retry}
        </button>
      </Notice>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">{t.archive.listTitle}</h2>
        {published.length === 0 ? (
          <EmptyState title={t.archive.emptyTitle}>{t.archive.emptyText}</EmptyState>
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
                    {t.vocabulary.interventionKind[item.kind] ?? item.kind} -{' '}
                    {t.vocabulary.interventionStatus[item.status] ?? item.status} -{' '}
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
          names={names}
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
  names,
  movements,
}: {
  record: Intervention;
  detail: Detail;
  names: ReadonlyMap<string, string>;
  movements: readonly VehicleMovement[];
}) {
  const t = useText();
  const closed = record.closedAt !== null;
  const recorded = detail.audit !== null;
  const events = useMemo(
    () =>
      detail.audit !== null
        ? recordedChronology(detail.audit, detail.recipients, names, t)
        : buildChronology(record, detail, movements, t),
    [record, detail, names, movements, t],
  );

  /*
   * The same two functions the commander's console calls, on the same kind of
   * rows. That is the whole point of `src/auth/metrics.ts`: an incident looked
   * at live and the same incident looked at in six months must produce
   * identical numbers, and two implementations of that promise is one too many.
   */
  const summary = useMemo(
    () => summarise(record, detail.recipients, detail.attendance, movements, detail.audit ?? []),
    [record, detail, movements],
  );
  const timings = useMemo(
    () =>
      detail.recipients.map((facts) =>
        recipientTimings(record, facts, detail.attendance, detail.audit ?? []),
      ),
    [record, detail],
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
          confirmedMs: confirmed.reduce((sum, i) => sum + participationMs(i), 0),
          confirmedCount: confirmed.length,
          pending: row.intervals.filter((i) => attendanceState(i) === 'PENDING').length,
          rejected: row.intervals.filter((i) => attendanceState(i) === 'REJECTED'),
        };
      })
      .sort((a, b) => b.confirmedMs - a.confirmedMs || a.name.localeCompare(b.name));
  }, [detail.attendance]);

  /*
   * Read from the summary rather than re-added here.
   *
   * The brief that produced this file requires the detail rows and the
   * cumulative total to use the same calculation contract. Two loops summing
   * the same intervals would satisfy it by accident today and drift the first
   * time one of them changed, so there is one loop - `summarise` - and this
   * line reads its answer.
   */
  const totalConfirmed = summary.confirmedMs;
  const stillPending = perMember.reduce((sum, row) => sum + row.pending, 0);

  return (
    <>
      <section className="panel" data-testid="archive-record">
        <h2 className="panel__title" data-testid="archive-title">
          {record.title}
        </h2>
        <p className="muted small">
          {t.vocabulary.interventionKind[record.kind] ?? record.kind}
          {record.otherKindNote ? ` - ${record.otherKindNote}` : ''} - {record.incidentLocation}
        </p>
        <dl className="facts" data-testid="archive-facts">
          <div>
            <dt>{t.archive.created}</dt>
            <dd>{formatTime(record.createdAt)}</dd>
          </div>
          <div>
            <dt>{t.archive.published}</dt>
            <dd>{record.publishedAt ? formatTime(record.publishedAt) : t.archive.notPublished}</dd>
          </div>
          <div>
            <dt>{t.archive.closed}</dt>
            <dd data-testid="archive-closed">
              {record.closedAt ? formatTime(record.closedAt) : t.archive.stillRunning}
            </dd>
          </div>
          <div>
            <dt>{t.archive.state}</dt>
            <dd>{t.vocabulary.interventionStatus[record.status] ?? record.status}</dd>
          </div>
        </dl>
        {record.closeReason ? (
          <p className="small">
            <strong>{t.archive.closeNote}:</strong> {record.closeReason}
          </p>
        ) : null}
        {closed ? null : (
          <Notice tone="warn">{t.archive.notClosedYet}</Notice>
        )}
      </section>

      {/* The measured record: how quickly the society responded, how long the
          intervention ran, and how long it held each state. Identical
          components and identical arithmetic to the commander's console. */}
      <MilestonePanel summary={summary} />
      <InterventionDurationPanel summary={summary} />
      <SummaryCounts summary={summary} />

      <section className="panel">
        <h2 className="panel__title">{t.archive.chronologyTitle}</h2>
        <p className="muted small">{t.archive.chronologyNote}</p>
        {recorded ? null : (
          /*
           * The audit could not be read - most likely the reading function is
           * not yet on this project. What is shown instead is reconstructed
           * from current-state rows, which can only ever carry each member's
           * LATEST movement and no state transition at all. Saying so is the
           * difference between a short record and a record that looks complete
           * and is not.
           */
          <Notice tone="warn" testId="chronology-degraded">
            <strong>{t.archive.chronologyDegradedTitle}</strong> {t.archive.chronologyDegradedText}
          </Notice>
        )}
        {events.length === 0 ? (
          <EmptyState title={t.archive.chronologyEmptyTitle}>
            {t.archive.chronologyEmptyText}
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
        <h2 className="panel__title">{t.archive.timingsTitle}</h2>
        <p className="muted small">{t.archive.timingsNote}</p>
        <ResponseTimings timings={timings} testId="archive-timings" />
      </section>

      <section className="panel">
        <h2 className="panel__title">{t.archive.participationTitle}</h2>
        <p className="muted small">{t.archive.participationNote}</p>
        {perMember.length === 0 ? (
          <EmptyState title={t.archive.participationEmptyTitle}>
            {t.archive.participationEmptyText}
          </EmptyState>
        ) : (
          <>
            <p className="small" data-testid="archive-total">
              {t.archive.totalConfirmed}: <strong>{formatDurationMs(totalConfirmed)}</strong>
              {stillPending > 0 ? (
                <>
                  {' '}
                  - <span data-testid="archive-pending">{stillPending}</span>{' '}
                  {t.archive.stillPendingSuffix}
                </>
              ) : null}
            </p>
            <ScrollRegion
              label={t.archive.perMemberLabel}
              className="table-wrap table-wrap--cards"
            >
              <table className="table table--cards" data-testid="archive-participation">
                <thead>
                  <tr>
                    <th scope="col">{t.timings.colMember}</th>
                    <th scope="col">{t.archive.colConfirmed}</th>
                    <th scope="col">{t.archive.colPending}</th>
                    <th scope="col">{t.archive.colRejected}</th>
                  </tr>
                </thead>
                <tbody>
                  {perMember.map((row) => (
                    <tr key={row.memberId}>
                      <th scope="row">{row.name}</th>
                      <td data-label={t.archive.colConfirmed}>
                        {row.confirmedCount > 0 ? (
                          <Chip tone="yes" symbol={ATTENDANCE_STATE_SYMBOL.CONFIRMED ?? '+'}>
                            {formatDurationMs(row.confirmedMs)}
                          </Chip>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td data-label={t.archive.colPending}>
                        {row.pending > 0 ? (
                          <Chip tone="later" symbol={ATTENDANCE_STATE_SYMBOL.PENDING ?? '~'}>
                            {row.pending}{' '}
                            {row.pending === 1 ? t.archive.claimsOne : t.archive.claimsMany}
                          </Chip>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td data-label={t.archive.colRejected}>
                        {row.rejected.length > 0 ? (
                          <span>
                            <Chip tone="no" symbol={ATTENDANCE_STATE_SYMBOL.REJECTED ?? '-'}>
                              {t.vocabulary.attendanceState.REJECTED ?? t.archive.colRejected}
                            </Chip>
                            <span className="small muted">
                              {' '}
                              {row.rejected
                                .map((i) => i.rejectionReason ?? t.archive.noReasonGiven)
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

      {/*
        Replaced a table that showed departure and return and left the reader to
        subtract them. It now carries the exact time out of the station and the
        member who recorded each end of it - both of which the server already
        held and the archive simply did not print.
      */}
      <VehiclePanel summary={summary} />
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

/**
 * The chronology as the SERVER recorded it.
 *
 * Every line here is an `operational_audit` row: a real event, with the time
 * the database stamped on it and the account that caused it. That is what the
 * fallback below cannot give - it reconstructs from current-state rows, so it
 * can only ever show a member's LATEST movement and no state transition at all.
 *
 * Opening a call-out and answering it are added from the recipient facts,
 * because those two are not audited: they live in their own tables, each with
 * its own timestamp, and are already single facts that cannot be superseded.
 */
function recordedChronology(
  audit: readonly AuditEvent[],
  recipients: readonly RecipientFacts[],
  names: ReadonlyMap<string, string>,
  t: Strings,
): readonly ChronologyEvent[] {
  const events: ChronologyEvent[] = [];

  for (const entry of audit) {
    const actor = entry.actorName ?? t.vocabulary.unnamedActor;
    const said = t.vocabulary.auditEvent[entry.type];
    // An unrecognised event type is still shown, with its time and its actor.
    // Hiding it would silently shorten a record somebody may be relying on, and
    // a raw name once is better than a missing line forever.
    events.push({
      key: entry.id,
      at: entry.at,
      who: actor,
      // `endSentence` rather than a bare ".": a quoted note may already carry
      // its own terminator, and "prototipa.." is the defect this replaced.
      text: endSentence(
        `${said ?? `${t.archive.saidUnknownEvent} (${entry.type})`}${describe(entry, names, t)}`,
      ),
    });
  }

  for (const person of recipients) {
    if (person.acknowledgedAt !== null) {
      events.push({
        key: `ack-${person.memberId}`,
        at: person.acknowledgedAt,
        who: person.memberName,
        text: t.archive.saidOpened,
      });
    }
    if (person.answer !== null && person.answeredAt !== null) {
      const answer = t.vocabulary.answer[person.answer] ?? person.answer;
      const eta =
        person.etaMinutes !== null
          ? ` (${t.archive.saidInMinutes} ${person.etaMinutes} ${t.timings.minutesShort})`
          : '';
      events.push({
        key: `answer-${person.memberId}`,
        at: person.answeredAt,
        who: person.memberName,
        text: `${t.archive.saidAnswered} ${answer}${eta}.`,
      });
    }
  }

  return events.sort(byTime);
}

/**
 * The part of a line that comes from the event's own detail.
 *
 * Each shape is the one the writing command records, read by name rather than
 * by position, and anything absent is simply left out - never rendered as
 * "undefined" and never guessed at.
 */
function describe(entry: AuditEvent, names: ReadonlyMap<string, string>, t: Strings): string {
  const detail = entry.detail;
  const text = (key: string): string | null => {
    const value = detail[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };
  /**
   * A note somebody TYPED, about to be quoted inside a sentence this function
   * builds.
   *
   * The hosted review found a line reading "Vjezba zavrsena - test operativnog
   * prototipa..": the commander's closing note already ended in a full stop and
   * the sentence around it added a second one. `forSentence` trims the trailing
   * punctuation from the quoted copy only - the stored audit text is never
   * touched, and the record header above still shows it character for
   * character.
   */
  const note = (key: string): string | null => forSentence(text(key));
  const count = (key: string): number | null => {
    const value = detail[key];
    return typeof value === 'number' ? value : null;
  };
  const member = (): string | null => {
    const id = detail['member_id'];
    if (typeof id !== 'string') return null;
    return names.get(id) ?? null;
  };

  switch (entry.type) {
    case 'INTERVENTION_PUBLISHED': {
      const recipients = count('recipient_count') ?? count('recipients');
      /*
       * Says WHO WAS CALLED OUT, and nothing about transport.
       *
       * This line used to read "i upisao N obaveza za slanje (bez stvarnog
       * slanja)". That was true when no channel existed; Web Push made it
       * false for every member who has opted a device in, and a record that
       * states "without actually sending" about a call-out that did send is
       * worse than one that says nothing. The count of members is the fact the
       * audit row actually holds, so that is what is printed.
       */
      return recipients === null ? '' : ` ${t.archive.saidCalledOutMembers} ${recipients}`;
    }
    case 'INTERVENTION_STATUS_CHANGED': {
      const from = text('from');
      const to = text('to');
      if (to === null) return '';
      const shownTo = t.vocabulary.interventionStatus[to] ?? to;
      const shownFrom = from === null ? null : t.vocabulary.interventionStatus[from] ?? from;
      return shownFrom === null ? `: ${shownTo}` : `: ${shownFrom} -> ${shownTo}`;
    }
    case 'JOURNEY_PROGRESS_SET': {
      const to = text('to');
      const who = member();
      const step = to === null ? '' : `: ${t.vocabulary.journey[to] ?? to}`;
      // "Na licu mjesta" is a statement about position. It is not attendance,
      // and this sentence must not let a reader think it was recorded as one.
      return who === null ? step : ` ${t.archive.forMember} ${who}${step}`;
    }
    case 'ATTENDANCE_CHECK_IN':
    case 'ATTENDANCE_CHECK_OUT':
    case 'ATTENDANCE_CONFIRMED':
    case 'ATTENDANCE_UNCONFIRMED':
    case 'ATTENDANCE_CORRECTED': {
      const who = member();
      const reason = note('note');
      return `${who === null ? '' : ` ${t.archive.forMember} ${who}`}${
        reason === null ? '' : ` - ${reason}`
      }`;
    }
    case 'ATTENDANCE_REJECTED': {
      const who = member();
      const reason = note('reason');
      return `${who === null ? '' : ` ${t.archive.ofMember} ${who}`}: ${
        reason ?? t.archive.noReasonGiven
      }`;
    }
    case 'INTERVENTION_CLOSED':
    case 'INTERVENTION_CANCELLED': {
      const reason = note('reason');
      const open = count('open_attendance');
      const stillOpen =
        open !== null && open > 0 ? ` (${t.archive.openAttendanceCount}: ${open})` : '';
      return `${reason === null ? '' : `: ${reason}`}${stillOpen}`;
    }
    default:
      return '';
  }
}

/** Oldest first, with a stable tie-break so the record never shuffles. */
function byTime(a: ChronologyEvent, b: ChronologyEvent): number {
  const diff = new Date(a.at).getTime() - new Date(b.at).getTime();
  return diff !== 0 ? diff : a.key.localeCompare(b.key);
}

function buildChronology(
  record: Intervention,
  detail: Detail,
  movements: readonly VehicleMovement[],
  t: Strings,
): readonly ChronologyEvent[] {
  const events: ChronologyEvent[] = [];

  if (record.publishedAt !== null) {
    events.push({
      key: 'published',
      at: record.publishedAt,
      who: t.archive.commander,
      // Says who was called out, never that anybody was reached. See the note
      // on INTERVENTION_PUBLISHED in `describe`.
      text: endSentence(
        `${t.vocabulary.auditEvent.INTERVENTION_PUBLISHED} ${t.archive.saidCalledOutMembers} ${detail.recipients.length}`,
      ),
    });
  }

  for (const person of detail.recipients) {
    if (person.acknowledgedAt !== null) {
      events.push({
        key: `ack-${person.memberId}`,
        at: person.acknowledgedAt,
        who: person.memberName,
        text: t.archive.saidOpened,
      });
    }
    if (person.answer !== null && person.answeredAt !== null) {
      const answer = t.vocabulary.answer[person.answer] ?? person.answer;
      const eta =
        person.etaMinutes !== null
          ? ` (${t.archive.saidInMinutes} ${person.etaMinutes} ${t.timings.minutesShort})`
          : '';
      events.push({
        key: `answer-${person.memberId}`,
        at: person.answeredAt,
        who: person.memberName,
        text: `${t.archive.saidAnswered} ${answer}${eta}.`,
      });
    }
    if (person.journey !== null && person.journeyAt !== null) {
      events.push({
        key: `journey-${person.memberId}`,
        at: person.journeyAt,
        who: person.memberName,
        // "Na licu mjesta" is a statement about movement. It is not attendance,
        // and this sentence must not let a reader think it was recorded as one.
        text: `${t.archive.saidMovement} ${t.vocabulary.journey[person.journey] ?? person.journey}.`,
      });
    }
  }

  for (const interval of detail.attendance) {
    const source = t.vocabulary.attendanceSource[interval.source] ?? interval.source;
    events.push({
      key: `in-${interval.id}`,
      at: interval.startedAt,
      who: interval.memberName,
      text: `${t.archive.saidPresent} (${source.toLowerCase()}).`,
    });
    if (interval.endedAt !== null) {
      events.push({
        key: `out-${interval.id}`,
        at: interval.endedAt,
        who: interval.memberName,
        text: t.archive.saidCheckedOut,
      });
    }
    if (interval.rejectedAt !== null) {
      events.push({
        key: `rej-${interval.id}`,
        at: interval.rejectedAt,
        who: t.archive.commander,
        text: `${t.archive.saidRejectedFor} ${interval.memberName}: ${
          interval.rejectionReason ?? t.archive.noReasonGiven
        }`,
      });
    }
  }

  for (const movement of movements) {
    events.push({
      key: `dep-${movement.id}`,
      at: movement.departedAt,
      who: `${movement.callsign} ${movement.vehicleName}`,
      text: `${t.archive.saidVehicleOut}${movement.purpose ? ` - ${movement.purpose}` : ''}.`,
    });
    if (movement.returnedAt !== null) {
      events.push({
        key: `ret-${movement.id}`,
        at: movement.returnedAt,
        who: `${movement.callsign} ${movement.vehicleName}`,
        text: t.archive.saidVehicleBack,
      });
    }
  }

  if (record.closedAt !== null) {
    const closingNote = forSentence(record.closeReason);
    events.push({
      key: 'closed',
      at: record.closedAt,
      who: t.archive.commander,
      // Same rule as the recorded chronology: the quoted copy loses a trailing
      // full stop so the built sentence does not end in two.
      text: endSentence(
        `${t.archive.saidClosed}${closingNote === null ? '' : `: ${closingNote}`}`,
      ),
    });
  }

  return events.sort(byTime);
}

// ---------------------------------------------------------------------------

function AllTimeTotals({ totals }: { totals: readonly ParticipationTotal[] }) {
  const t = useText();
  const sorted = useMemo(
    () =>
      [...totals].sort(
        (a, b) => b.confirmedMs - a.confirmedMs || a.memberName.localeCompare(b.memberName),
      ),
    [totals],
  );

  return (
    <section className="panel">
      <h2 className="panel__title">{t.archive.totalsTitle}</h2>
      <p className="muted small">{t.archive.totalsNote}</p>
      {sorted.length === 0 ? (
        <EmptyState title={t.archive.totalsEmptyTitle}>{t.archive.totalsEmptyText}</EmptyState>
      ) : (
        <ScrollRegion label={t.archive.totalsTitle} className="table-wrap table-wrap--cards">
          <table className="table table--cards" data-testid="archive-totals">
            <thead>
              <tr>
                <th scope="col">{t.timings.colMember}</th>
                <th scope="col">{t.archive.colConfirmedTime}</th>
                <th scope="col">{t.archive.colConfirmedCount}</th>
                <th scope="col">{t.archive.colPending}</th>
                <th scope="col">{t.archive.colOngoing}</th>
                <th scope="col">{t.archive.colRejected}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.memberId}>
                  <th scope="row">{row.memberName}</th>
                  <td
                    data-label={t.archive.colConfirmedTime}
                    data-testid={`total-confirmed-${row.memberId}`}
                  >
                    <strong>{formatDurationMs(row.confirmedMs)}</strong>
                  </td>
                  <td data-label={t.archive.colConfirmedCount}>{row.confirmedIntervals}</td>
                  <td data-label={t.archive.colPending}>
                    {row.unverifiedIntervals > 0 ? (
                      <span>
                        {row.unverifiedIntervals}{' '}
                        <span className="muted small">
                          ({formatDurationMs(row.unverifiedMs)} {t.archive.uncounted})
                        </span>
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td data-label={t.archive.colOngoing}>
                    {row.openIntervals > 0 ? row.openIntervals : <span className="muted">-</span>}
                  </td>
                  <td data-label={t.archive.colRejected}>
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
