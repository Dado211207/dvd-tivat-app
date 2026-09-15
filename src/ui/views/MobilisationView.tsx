/**
 * The firefighter's screen: my availability, and the call-outs addressed to me.
 *
 * Designed for one hand, in the dark, in a hurry. The call-out's operational
 * detail is at the top because that is what somebody woken at 03:00 needs
 * first - what, where, and where to gather - and the actions are large targets
 * below it.
 *
 * **Every button here writes exactly one fact.** Opening is not answering.
 * Answering is not setting off. Setting off is not arriving. Arriving is not
 * attendance. Attendance is not confirmed attendance. The screen shows all of
 * them at once, separately, so a member can see what they have and have not
 * told the commander - and so nothing the member taps can quietly assert
 * something they did not mean.
 *
 * In particular, `Na licu mjesta` does NOT check anybody in. Check-in is its
 * own button, and even then it produces a record marked "prijavio se sam" that
 * a commander must confirm before it counts as participation. That chain is the
 * whole point of the schema and the screen states it in plain words rather than
 * implying it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acknowledgeIntervention,
  attendanceState,
  checkIn,
  checkOut,
  ETA_BANDS,
  fetchAttendance,
  fetchAvailability,
  fetchInterventions,
  fetchRecipientFacts,
  isOpenStatus,
  JOURNEY_STEPS,
  participationMs,
  setJourneyProgress,
  setOwnAvailability,
  submitResponse,
  type AttendanceInterval,
  type Intervention,
  type JourneyStep,
  type RecipientFacts,
  type ResponseAnswer,
} from '@/auth/operations';
import { LIVE_STATUS_LABEL, useLiveOperations } from '@/auth/live';
import { formatDurationMs } from '@/auth/duration';
import { loadRoster } from '@/auth/roster';
import { readRouteParam } from '../router';
import { OperationalGate, type OperationalContext } from '../components/OperationalGate';
import { PushNotificationPanel } from '../components/PushNotificationPanel';
import { Chip, EmptyState, Field, Notice } from '../components/primitives';
import { formatTime, JOURNEY_SYMBOL } from '@/i18n/labels';
import { useText } from '@/i18n/useText';

export function MobilisationView() {
  const t = useText();
  return (
    <OperationalGate allow={['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER']} requiresMember>
      {/* The gate's `requiresMember` already refuses to render without one, so
          this branch is unreachable - which is exactly why it is a check and
          not a `!`. This is the screen whose whole argument is that nothing may
          claim a fact that was not established; asserting one here would be the
          same mistake in miniature. Narrowed at the boundary, where there are
          no hooks to call conditionally. */}
      {(context) =>
        context.memberId === null ? (
          <Notice tone="error">
            <strong>{t.mobilisation.noMemberTitle}</strong> {t.mobilisation.noMemberText}
          </Notice>
        ) : (
          <Mobilisation context={context} memberId={context.memberId} />
        )
      }
    </OperationalGate>
  );
}

interface MyData {
  interventions: readonly Intervention[];
  facts: readonly RecipientFacts[];
  attendance: readonly AttendanceInterval[];
  available: boolean | null;
  availabilityNote: string | null;
  availabilityChangedAt: string | null;
}

const EMPTY: MyData = {
  interventions: [],
  facts: [],
  attendance: [],
  available: null,
  availabilityNote: null,
  availabilityChangedAt: null,
};

/**
 * The intervention a pressed notification asked for, or null.
 *
 * Read through the router's own parser rather than a second copy of it: two
 * hash parsers that can disagree is exactly how a deep link starts working
 * everywhere except the one case nobody tested.
 *
 * **This is a hint, never an authority.** The id is checked against the
 * interventions the SERVER returned for this account, so a link to somebody
 * else's call-out selects nothing and the screen falls back to whatever this
 * member may actually see. Row level security refuses it regardless; this only
 * decides which of their own call-outs to open on.
 */
function requestedInterventionId(): string | null {
  const value = readRouteParam('intervention');
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function Mobilisation({ memberId }: { context: OperationalContext; memberId: string }) {
  const t = useText();
  const [data, setData] = useState<MyData>(EMPTY);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Re-read everything.
   *
   * `silent` is what a live update uses: the screen must not flash a loading
   * line every few seconds, and must not look as though it reset itself while
   * somebody was halfway through answering.
   */
  const refresh = useCallback(
    async (keepId?: string | null, options?: { readonly silent?: boolean }) => {
      const ticket = ++generation.current;
      const silent = options?.silent === true;
      if (!silent) setLoading(true);
      try {
        const [interventions, availability, members] = await Promise.all([
          fetchInterventions(),
          fetchAvailability(),
          loadRoster(),
        ]);
        // Row level security already limits this to call-outs this member was
        // sent, so there is nothing to filter client-side - and filtering here
        // would imply the list could contain somebody else's.
        const open = interventions.filter((i) => isOpenStatus(i.status));
        const requested = requestedInterventionId();
        const linked = requested && interventions.some((item) => item.id === requested) ? requested : null;
        const focusId = keepId ?? linked ?? open[0]?.id ?? interventions[0]?.id ?? null;
        const [facts, attendance] = focusId
          ? await Promise.all([
              fetchRecipientFacts(focusId),
              fetchAttendance(focusId, new Map(members.map((m) => [m.id, m.fullName] as const))),
            ])
          : [[], []];
        const mine = availability.find((a) => a.memberId === memberId);
        if (!mounted.current || ticket !== generation.current) return;
        setData({
          interventions,
          facts,
          attendance,
          available: mine?.available ?? null,
          availabilityNote: mine?.note ?? null,
          availabilityChangedAt: mine?.changedAt ?? null,
        });
        setActiveId(focusId);
        setOffline(false);
      } catch {
        if (!mounted.current || ticket !== generation.current) return;
        setOffline(true);
      } finally {
        if (mounted.current && ticket === generation.current && !silent) setLoading(false);
      }
    },
    [memberId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * A call-out that arrives while this screen is open should appear on it.
   *
   * Which is the whole point from a member's side: the telephone is in a pocket,
   * the commander publishes, and the screen has to show it without the member
   * thinking to pull down. The notice is never read - `refresh` re-reads through
   * the same policy-checked queries, so a member still sees only the call-outs
   * they were actually sent.
   */
  const liveStatus = useLiveOperations({
    enabled: true,
    interventionId: activeId,
    onChange: () => void refresh(activeId, { silent: true }),
  });

  const active = useMemo(
    () => data.interventions.find((i) => i.id === activeId) ?? null,
    [data.interventions, activeId],
  );
  const myFacts = useMemo(
    () => data.facts.find((f) => f.memberId === memberId) ?? null,
    [data.facts, memberId],
  );
  const myIntervals = useMemo(
    () => data.attendance.filter((a) => a.memberId === memberId),
    [data.attendance, memberId],
  );
  const openInterval = myIntervals.find((a) => a.endedAt === null && a.rejectedAt === null) ?? null;

  const act = async (
    run: () => Promise<{ ok: boolean; message?: string }>,
    successText: string,
  ) => {
    setBusy(true);
    const outcome = await run();
    if (outcome.ok) {
      setMessage({ tone: 'info', text: successText });
      await refresh(activeId);
    } else {
      setMessage({ tone: 'error', text: outcome.message ?? t.mobilisation.notSaved });
    }
    setBusy(false);
  };

  /**
   * Whether this member is in the middle of something.
   *
   * The screen's order changes on this one fact, and that is the whole point of
   * the rearrangement. Everything used to be shown at once, in a fixed order,
   * with general availability and a notification panel above the call-out: a
   * firefighter woken at three in the morning scrolled past two panels about
   * next week to reach the fire. Now the call-out is first whenever there is
   * one, and availability - which is about next week - goes below it, closed.
   */
  const callOutIsOpen = active !== null && isOpenStatus(active.status);

  const availability = (
    <AvailabilityPanel data={data} busy={busy} onAct={act} collapsed={callOutIsOpen} />
  );

  return (
    <div className="stack">
      {/* Compact while it is already on: a paragraph explaining a thing that is
          working is just something between a firefighter and their call-out.
          When there IS an action to take it shows in full. */}
      <PushNotificationPanel variant="compact" />
      {offline ? (
        <Notice tone="error">
          <strong>{t.mobilisation.offlineTitle}</strong> {t.mobilisation.offlineText}{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void refresh(activeId)}>
            {t.gate.retry}
          </button>
        </Notice>
      ) : null}
      {message ? (
        <div role="status">
          <Notice tone={message.tone === 'error' ? 'error' : 'info'}>{message.text}</Notice>
        </div>
      ) : null}
      {loading ? <p role="status" className="muted small">{t.common.loading}</p> : null}

      <p className="muted small live-state" data-testid="live-state" data-live={liveStatus}>
        <span className={`live-dot live-dot--${liveStatus.toLowerCase()}`} aria-hidden="true" />
        {LIVE_STATUS_LABEL[liveStatus]}
      </p>

      {/* Rendered once, below - never in one of two positions. Moving a panel
          by rendering it somewhere else unmounts it and takes its state with
          it, and this one holds a note somebody may be halfway through typing. */}
      {data.interventions.length > 1 ? (
        <Field label={t.mobilisation.pickCallOut} controlId="my-intervention">
          {(props) => (
            <select
              {...props}
              data-testid="my-intervention"
              value={activeId ?? ''}
              onChange={(event) => {
                setActiveId(event.target.value);
                void refresh(event.target.value);
              }}
            >
              {data.interventions.map((i) => (
                <option key={i.id} value={i.id}>
                  {t.vocabulary.interventionStatus[i.status] ?? i.status} - {i.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      {active === null ? (
        <EmptyState title={t.mobilisation.noCallOutTitle}>
          {t.mobilisation.noCallOutText}
        </EmptyState>
      ) : (
        <CallOutCard
          intervention={active}
          facts={myFacts}
          intervals={myIntervals}
          openInterval={openInterval}
          busy={busy}
          onAct={act}
        />
      )}

      {availability}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AvailabilityPanel({
  data,
  busy,
  onAct,
  collapsed,
}: {
  data: MyData;
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
  /** True while a call-out is open: this is about next week, that is about now. */
  collapsed: boolean;
}) {
  const t = useText();
  const [note, setNote] = useState('');
  useEffect(() => {
    setNote(data.availabilityNote ?? '');
  }, [data.availabilityNote]);

  const body = (
    <>
      <p className="muted small">{t.mobilisation.availabilityNote}</p>

      <div className="row-actions">
        <button
          type="button"
          className={`btn btn--big ${data.available === true ? 'btn--primary' : 'btn--ghost'}`}
          data-testid="available-yes"
          aria-pressed={data.available === true}
          disabled={busy}
          onClick={() =>
            void onAct(
              () => setOwnAvailability(true, note.trim() === '' ? null : note.trim()),
              t.mobilisation.availableSavedYes,
            )
          }
        >
          {t.mobilisation.availableYes}
        </button>
        <button
          type="button"
          className={`btn btn--big ${data.available === false ? 'btn--primary' : 'btn--ghost'}`}
          data-testid="available-no"
          aria-pressed={data.available === false}
          disabled={busy}
          onClick={() =>
            void onAct(
              () => setOwnAvailability(false, note.trim() === '' ? null : note.trim()),
              t.mobilisation.availableSavedNo,
            )
          }
        >
          {t.mobilisation.availableNo}
        </button>
      </div>

      <Field
        label={t.mobilisation.availabilityNoteLabel}
        hint={t.mobilisation.availabilityNoteHint}
        controlId="availability-note"
      >
        {(props) => (
          <input
            {...props}
            data-testid="availability-note"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      <p className="muted small" data-testid="availability-state">
        {data.available === null
          ? t.mobilisation.availabilityUnset
          : `${data.available ? t.mobilisation.availabilityIsYes : t.mobilisation.availabilityIsNo}${
              data.availabilityChangedAt
                ? ` ${t.mobilisation.availabilitySince} ${formatTime(data.availabilityChangedAt)}`
                : ''
            }.`}
      </p>
    </>
  );

  // Closed, not removed. Stating availability during a call-out is a real thing
  // somebody occasionally needs to do, and hiding the capability to tidy the
  // screen would be buying calm with a missing feature.
  if (collapsed) {
    return (
      <section className="panel">
        <details className="disclosure" data-testid="availability-disclosure">
          <summary className="disclosure__summary">{t.mobilisation.availabilityShow}</summary>
          <div className="disclosure__body">{body}</div>
        </details>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="panel__title">{t.mobilisation.availabilityTitle}</h2>
      {body}
    </section>
  );
}

// ---------------------------------------------------------------------------

function CallOutCard({
  intervention,
  facts,
  intervals,
  openInterval,
  busy,
  onAct,
}: {
  intervention: Intervention;
  facts: RecipientFacts | null;
  intervals: readonly AttendanceInterval[];
  openInterval: AttendanceInterval | null;
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
}) {
  const t = useText();
  const [answer, setAnswer] = useState<ResponseAnswer | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const open = isOpenStatus(intervention.status);

  return (
    <>
      <section className="panel panel--callout">
        <p className="eyebrow">
          {t.vocabulary.interventionKind[intervention.kind] ?? intervention.kind}
          {intervention.otherKindNote ? ` - ${intervention.otherKindNote}` : ''}
        </p>
        <h2 className="callout__title" data-testid="callout-title">
          {intervention.title}
        </h2>
        <p className="callout__where" data-testid="callout-location">
          {intervention.incidentLocation}
        </p>
        {intervention.assemblyPoint ? (
          <p className="callout__assembly">
            {t.mobilisation.assembly}: <strong>{intervention.assemblyPoint}</strong>
          </p>
        ) : null}
        <p className="callout__instructions">{intervention.instructions}</p>
        <p className="muted small">
          {t.vocabulary.interventionStatus[intervention.status] ?? intervention.status}
          {intervention.publishedAt
            ? ` - ${t.mobilisation.publishedAt} ${formatTime(intervention.publishedAt)}`
            : ''}
        </p>
        {!open ? (
          <Notice tone="info">{t.mobilisation.closedNotice}</Notice>
        ) : null}
      </section>

      <section className="panel">
        <h3 className="panel__title">{t.mobilisation.step1}</h3>
        {facts?.acknowledgedAt ? (
          <p data-testid="ack-state">
            <Chip tone="yes" symbol="+">
              {t.mobilisation.ackDone} {formatTime(facts.acknowledgedAt)}
            </Chip>
          </p>
        ) : (
          <>
            <p className="muted small">{t.mobilisation.ackWhy}</p>
            <button
              type="button"
              className="btn btn--big btn--primary"
              data-testid="acknowledge"
              disabled={busy || !open}
              onClick={() =>
                void onAct(
                  () => acknowledgeIntervention(intervention.id),
                  t.mobilisation.ackSaved,
                )
              }
            >
              {t.mobilisation.ackButton}
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <h3 className="panel__title">{t.mobilisation.step2}</h3>
        {facts?.answer ? (
          <p data-testid="answer-state">
            <Chip
              tone={
                facts.answer === 'DOLAZIM' ? 'yes' : facts.answer === 'DOLAZIM_KASNIJE' ? 'later' : 'no'
              }
              symbol="="
            >
              {t.vocabulary.answer[facts.answer] ?? facts.answer}
              {facts.etaMinutes ? ` (${facts.etaMinutes} ${t.timings.minutesShort})` : ''}
            </Chip>{' '}
            <span className="muted small">{t.mobilisation.answerChangeable}</span>
          </p>
        ) : null}

        <div className="row-actions">
          {(['DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`btn btn--big ${answer === option ? 'btn--primary' : 'btn--ghost'}`}
              data-testid={`answer-${option}`}
              aria-pressed={answer === option}
              disabled={busy || !open}
              onClick={() => {
                setAnswer(option);
                if (option !== 'DOLAZIM_KASNIJE') setEta(null);
              }}
            >
              {t.vocabulary.answer[option] ?? option}
            </button>
          ))}
        </div>

        {answer === 'DOLAZIM_KASNIJE' ? (
          <>
            <p className="muted small">{t.mobilisation.etaQuestion}</p>
            <div className="row-actions">
              {ETA_BANDS.map((band) => (
                <button
                  key={band}
                  type="button"
                  className={`btn btn--big ${eta === band ? 'btn--primary' : 'btn--ghost'}`}
                  data-testid={`eta-${band}`}
                  aria-pressed={eta === band}
                  disabled={busy}
                  onClick={() => setEta(band)}
                >
                  {band} {t.timings.minutesShort}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="btn btn--big btn--primary"
          data-testid="submit-answer"
          disabled={busy || !open || answer === null || (answer === 'DOLAZIM_KASNIJE' && eta === null)}
          onClick={() =>
            void onAct(
              () => submitResponse(intervention.id, answer!, eta, false),
              t.mobilisation.answerSaved,
            )
          }
        >
          {t.mobilisation.sendAnswer}
        </button>
        <p className="muted small">{t.mobilisation.answerIsNotAttendance}</p>
      </section>

      <section className="panel">
        <h3 className="panel__title">{t.mobilisation.step3}</h3>
        <p className="muted small">{t.mobilisation.journeyNote}</p>
        {facts?.journey ? (
          <p data-testid="journey-state">
            <Chip tone={facts.journey === 'ODUSTAJEM' ? 'no' : 'accent'} symbol={JOURNEY_SYMBOL[facts.journey] ?? '?'}>
              {t.vocabulary.journey[facts.journey] ?? facts.journey}
            </Chip>
          </p>
        ) : null}
        <div className="row-actions">
          {JOURNEY_STEPS.map((step: JourneyStep) => (
            <button
              key={step}
              type="button"
              className={`btn btn--big ${facts?.journey === step ? 'btn--primary' : 'btn--ghost'}`}
              data-testid={`journey-${step}`}
              aria-pressed={facts?.journey === step}
              disabled={busy || !open}
              onClick={() =>
                void onAct(
                  () => setJourneyProgress(intervention.id, step),
                  `${t.mobilisation.journeySavedPrefix} ${t.vocabulary.journey[step] ?? step}. ${t.mobilisation.journeySavedSuffix}`,
                )
              }
            >
              {t.vocabulary.journey[step] ?? step}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel__title">{t.mobilisation.step4}</h3>
        <p className="muted small">{t.mobilisation.attendanceNote}</p>

        {intervals.length > 0 ? (
          <ul className="stack" data-testid="my-intervals">
            {intervals.map((interval) => {
              const state = attendanceState(interval);
              return (
                <li key={interval.id} className="card">
                  <p>
                    <Chip
                      tone={state === 'CONFIRMED' ? 'yes' : state === 'REJECTED' ? 'no' : 'later'}
                      symbol={state === 'CONFIRMED' ? '+' : state === 'REJECTED' ? '-' : '~'}
                    >
                      {t.vocabulary.attendanceState[state] ?? state}
                    </Chip>{' '}
                    <span className="muted small">
                      {t.vocabulary.attendanceSource[interval.source] ?? interval.source}
                    </span>
                  </p>
                  <p className="muted small">
                    {formatTime(interval.startedAt)} -{' '}
                    {interval.endedAt ? formatTime(interval.endedAt) : t.mobilisation.stillRunning}
                    {state === 'CONFIRMED' && interval.endedAt
                      ? ` (${formatDurationMs(participationMs(interval))})`
                      : ''}
                  </p>
                  {interval.rejectionReason ? (
                    <p className="muted small">
                      {t.mobilisation.rejectionReason}: {interval.rejectionReason}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {openInterval ? (
          <button
            type="button"
            className="btn btn--big btn--primary"
            data-testid="check-out"
            disabled={busy || !open}
            onClick={() =>
              void onAct(
                () => checkOut(intervention.id, null),
                t.mobilisation.checkOutSaved,
              )
            }
          >
            {t.mobilisation.checkOut}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--big btn--primary"
            data-testid="check-in"
            disabled={busy || !open}
            onClick={() =>
              void onAct(
                async () => {
                  const result = await checkIn(intervention.id, null);
                  return result.ok ? { ok: true } : { ok: false, message: result.message };
                },
                t.mobilisation.checkInSaved,
              )
            }
          >
            {t.mobilisation.checkIn}
          </button>
        )}
      </section>
    </>
  );
}
