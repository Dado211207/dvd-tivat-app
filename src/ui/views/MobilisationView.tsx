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
} from '@/auth/operations';
import { LIVE_STATUS_LABEL, useLiveOperations } from '@/auth/live';
import { formatDurationMs } from '@/auth/duration';
import { loadRoster } from '@/auth/roster';
import { readRouteParam } from '../router';
import { OperationalGate, type OperationalContext } from '../components/OperationalGate';
import {
  factStates,
  nextStep,
  type AttendanceStanding,
  type CallOutState,
  type CallOutStep,
  type FactState,
} from './callOutStep';
import { IncidentCard } from '../components/IncidentCard';
import { PushNotificationPanel } from '../components/PushNotificationPanel';
import { Chip, EmptyState, Field, Notice } from '../components/primitives';
import { formatTime } from '@/i18n/labels';
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

  /**
   * Where this member's attendance stands, read from the records themselves.
   *
   * Order matters and it is not arbitrary. An open interval is the live fact -
   * they are on the task now - and outranks anything already closed. Otherwise
   * a confirmed record is the strongest thing they have, and a closed record
   * nobody has confirmed is a claim waiting on a commander. Rejected records
   * count as nothing here; they are still readable in the list below.
   */
  const attendance: AttendanceStanding = openInterval !== null
    ? 'OPEN'
    : myIntervals.some((a) => attendanceState(a) === 'CONFIRMED')
      ? 'CONFIRMED'
      : myIntervals.some((a) => attendanceState(a) === 'PENDING')
        ? 'PENDING'
        : 'NONE';

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
          attendance={attendance}
          busy={busy}
          onAct={act}
        />
      )}

      {availability}

      {/*
        Notifications and the live indicator, at the bottom, together.

        Both were above the fire. The push panel rendered in FULL whenever push
        was unavailable or not yet configured - which is most devices most of
        the time - so five lines about notification setup stood between a
        firefighter and the incident. Neither is something anybody acts on while
        a call-out is running, and neither is hidden: they are simply last.
      */}
      <PushNotificationPanel variant={callOutIsOpen ? 'compact' : 'full'} />

      <p className="muted small live-state" data-testid="live-state" data-live={liveStatus}>
        <span className={`live-dot live-dot--${liveStatus.toLowerCase()}`} aria-hidden="true" />
        {LIVE_STATUS_LABEL[liveStatus]}
      </p>
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
  attendance,
  busy,
  onAct,
}: {
  intervention: Intervention;
  facts: RecipientFacts | null;
  intervals: readonly AttendanceInterval[];
  attendance: AttendanceStanding;
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
}) {
  const open = isOpenStatus(intervention.status);

  const state: CallOutState = {
    acknowledged: (facts?.acknowledgedAt ?? null) !== null,
    answer: facts?.answer ?? null,
    journey: facts?.journey ?? null,
    attendance,
    open,
  };
  const step = nextStep(state);

  /*
   * Two columns wherever there is width, one where there is not.
   *
   * Stacked, the incident card alone fills a phone held sideways - so the one
   * dominant action, the entire point of the screen, sat below the fold on a
   * landscape phone and below a lot of whitespace on a desktop. What is scarce
   * in landscape is height, not width, and the incident and the action are
   * exactly the two things somebody needs at once.
   *
   * The DOM order never changes: incident, then action, then what they have
   * told the commander, then everything else. A screen reader and the tab key
   * walk the same sequence at every size; only where the boxes land moves.
   */
  return (
    <div className="callout">
      <div className="callout__incident">
        <IncidentCard intervention={intervention} />
      </div>
      <div className="callout__actions">
        <NextAction
          step={step}
          state={state}
          intervention={intervention}
          busy={busy}
          onAct={onAct}
        />
        <MyStatus state={state} facts={facts} />
        <SecondaryActions
          state={state}
          intervention={intervention}
          intervals={intervals}
          busy={busy}
          onAct={onAct}
        />
      </div>
    </div>
  );
}

/**
 * What happened and where, first and largest.
 *
 * Everything a person woken at three in the morning needs before they decide
 * anything: the kind of incident, its title, where it is, where to gather, and
 * what they were told to bring. Nothing about their own state, nothing about
 * notifications, nothing about next week.
 */
/**
 * The one thing to do now, at the size of the one thing to do now.
 *
 * Each branch writes exactly ONE fact, which is the rule the whole schema rests
 * on: opening is not answering, answering is not arriving, arriving is not
 * attendance, and none of these buttons quietly records another.
 */
function NextAction({
  step,
  state,
  intervention,
  busy,
  onAct,
}: {
  step: CallOutStep;
  state: CallOutState;
  intervention: Intervention;
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
}) {
  const t = useText();
  const [wantsEta, setWantsEta] = useState(false);

  if (step === 'DONE') {
    const why = !state.open
      ? t.callout.doneClosed
      : state.journey === 'ODUSTAJEM'
        ? t.callout.doneTurnedBack
        : t.callout.doneDeclined;
    return (
      <section className="act act--settled" data-testid="next-action" data-step={step}>
        <p className="act__eyebrow">{t.callout.nothingLabel}</p>
        <p className="act__title">{t.callout.doneTitle}</p>
        <p className="act__why">{why}</p>
      </section>
    );
  }

  return (
    <section className="act" data-testid="next-action" data-step={step}>
      {/* On every step, so the card is recognisable as THE card before anybody
          has read a word of it. Three of the six steps are a single button and
          used to open straight onto their caveat, which reads as a note rather
          than as the thing being asked for. */}
      <p className="act__eyebrow">{t.callout.nextLabel}</p>

      {step === 'ACKNOWLEDGE' ? (
        <>
          <p className="act__why">{t.callout.doAcknowledgeWhy}</p>
          <button
            type="button"
            className="act__button act__button--primary"
            data-testid="acknowledge"
            disabled={busy}
            onClick={() =>
              void onAct(
                () => acknowledgeIntervention(intervention.id),
                t.mobilisation.ackSaved,
              )
            }
          >
            {t.callout.doAcknowledge}
          </button>
        </>
      ) : null}

      {step === 'ANSWER' ? (
        <>
          <p className="act__title">{t.callout.doAnswer}</p>
          {/*
            One tap is the answer.
            
            It used to take two: choose a chip, then press a separate "Posalji
            odgovor" button that sat there disabled until you had. That is a
            second tap on the most time-critical control on the screen, and the
            failure it invites - believing you answered when you only
            highlighted - is exactly the one a commander cannot see. An answer
            is changeable, so a mis-tap costs one more tap; a missed send costs
            a commander a member they think is coming.
            
            "Dolazim kasnije" still takes two, because the second tap records a
            DIFFERENT fact: how long. That is a real question, not a commit step.
          */}
          <div className="act__choices">
            <button
              type="button"
              className="act__choice act__choice--yes"
              data-testid="answer-DOLAZIM"
              disabled={busy}
              onClick={() =>
                void onAct(
                  () => submitResponse(intervention.id, 'DOLAZIM', null, false),
                  t.mobilisation.answerSaved,
                )
              }
            >
              {t.vocabulary.answer.DOLAZIM}
            </button>
            <button
              type="button"
              className="act__choice act__choice--later"
              data-testid="answer-DOLAZIM_KASNIJE"
              aria-expanded={wantsEta}
              disabled={busy}
              onClick={() => setWantsEta(true)}
            >
              {t.vocabulary.answer.DOLAZIM_KASNIJE}
            </button>
            <button
              type="button"
              className="act__choice act__choice--no"
              data-testid="answer-NE_MOGU"
              disabled={busy}
              onClick={() =>
                void onAct(
                  () => submitResponse(intervention.id, 'NE_MOGU', null, false),
                  t.mobilisation.answerSaved,
                )
              }
            >
              {t.vocabulary.answer.NE_MOGU}
            </button>
          </div>
          {wantsEta ? (
            <div className="act__eta" data-testid="eta-bands">
              <p className="act__why">{t.callout.etaQuestion}</p>
              <div className="act__choices act__choices--eta">
                {ETA_BANDS.map((band) => (
                  <button
                    key={band}
                    type="button"
                    className="act__choice act__choice--eta"
                    data-testid={`eta-${band}`}
                    disabled={busy}
                    onClick={() =>
                      void onAct(
                        () => submitResponse(intervention.id, 'DOLAZIM_KASNIJE', band, false),
                        t.mobilisation.answerSaved,
                      )
                    }
                  >
                    {band} {t.timings.minutesShort}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 'MOVE' ? (
        <>
          <p className="act__title">{t.callout.doMove}</p>
          <p className="act__why">{t.callout.doMoveWhy}</p>
          <div className="act__choices act__choices--journey">
            {JOURNEY_STEPS.map((journeyStep: JourneyStep) => (
              <button
                key={journeyStep}
                type="button"
                className={`act__choice ${
                  state.journey === journeyStep ? 'act__choice--on' : ''
                } ${journeyStep === 'ODUSTAJEM' ? 'act__choice--no' : ''}`}
                data-testid={`journey-${journeyStep}`}
                aria-pressed={state.journey === journeyStep}
                disabled={busy}
                onClick={() =>
                  void onAct(
                    () => setJourneyProgress(intervention.id, journeyStep),
                    `${t.mobilisation.journeySavedPrefix} ${
                      t.vocabulary.journey[journeyStep] ?? journeyStep
                    }. ${t.mobilisation.journeySavedSuffix}`,
                  )
                }
              >
                {t.vocabulary.journey[journeyStep] ?? journeyStep}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {step === 'CHECK_IN' ? (
        <>
          <p className="act__why">{t.callout.doCheckInWhy}</p>
          <button
            type="button"
            className="act__button act__button--primary"
            data-testid="check-in"
            disabled={busy}
            onClick={() =>
              void onAct(async () => {
                const result = await checkIn(intervention.id, null);
                return result.ok ? { ok: true } : { ok: false, message: result.message };
              }, t.mobilisation.checkInSaved)
            }
          >
            {t.callout.doCheckIn}
          </button>
        </>
      ) : null}

      {step === 'CHECK_OUT' ? (
        <>
          <p className="act__why">{t.callout.doCheckOutWhy}</p>
          <button
            type="button"
            className="act__button act__button--primary"
            data-testid="check-out"
            disabled={busy}
            onClick={() =>
              void onAct(() => checkOut(intervention.id, null), t.mobilisation.checkOutSaved)
            }
          >
            {t.callout.doCheckOut}
          </button>
        </>
      ) : null}
    </section>
  );
}

/**
 * The four facts, compact, with their own names kept.
 *
 * This is what the four numbered panels were actually for - letting a member
 * see what they have and have not told the commander - reduced to the size that
 * job needs. Each one carries a word as well as a colour, because a station
 * wall in sunlight and colour vision deficiency both defeat colour alone.
 */
function MyStatus({
  state,
  facts,
}: {
  state: CallOutState;
  facts: RecipientFacts | null;
}) {
  const t = useText();
  const label: Record<string, string> = {
    acknowledged: t.callout.factAcknowledged,
    answered: t.callout.factAnswered,
    moving: t.callout.factMoving,
    attending: t.callout.factAttending,
  };
  const detail: Record<string, string | null> = {
    acknowledged: facts?.acknowledgedAt ? formatTime(facts.acknowledgedAt) : null,
    answered: facts?.answer
      ? `${t.vocabulary.answer[facts.answer] ?? facts.answer}${
          facts.etaMinutes ? ` (${facts.etaMinutes} ${t.timings.minutesShort})` : ''
        }`
      : null,
    moving: facts?.journey ? (t.vocabulary.journey[facts.journey] ?? facts.journey) : null,
    /*
     * Says which of the four it is, in words.
     *
     * The strip used to print "ne" for anybody without an OPEN interval, which
     * told a member who had worked ninety minutes and checked out that their
     * attendance was nothing. `Ceka potvrdu` is the true answer there, and it
     * is also the sentence that keeps the product's central distinction in
     * front of them: their own report is a claim until a commander confirms it.
     */
    attending:
      state.attendance === 'OPEN'
        ? t.mobilisation.stillRunning
        : state.attendance === 'PENDING'
          ? t.callout.attendancePending
          : state.attendance === 'CONFIRMED'
            ? t.callout.attendanceConfirmed
            : null,
  };

  // `+`, `~`, `-` - never colour alone, and never a tick that means two
  // different things. `~` is the one that says "recorded, not yet counted".
  const MARK: Record<FactState['mark'], string> = { YES: '+', PARTIAL: '~', NO: '-' };

  return (
    <section className="my-status" aria-labelledby="my-status-title" data-testid="my-status">
      <h2 className="my-status__title" id="my-status-title">{t.callout.myStatus}</h2>
      <ul className="my-status__list">
        {factStates(state).map((fact) => (
          <li
            key={fact.key}
            className={`my-status__item my-status__item--${fact.mark.toLowerCase()}`}
            data-testid={`fact-${fact.key}`}
            data-mark={fact.mark}
          >
            <span className="my-status__mark" aria-hidden="true">{MARK[fact.mark]}</span>
            <span className="my-status__label">{label[fact.key]}</span>
            <span className="my-status__value">
              {detail[fact.key] ?? (fact.mark === 'NO' ? t.callout.factPending : t.callout.factDone)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Everything still reachable, one tap away and not in the way.
 *
 * Nothing was removed when the four panels went. Changing an answer, correcting
 * a movement already reported, and reading one's own attendance records all
 * still exist - they are simply not competing with the fire for the top of the
 * screen. Hiding a capability to make a screen look calmer would be buying calm
 * with a missing feature; closing it is not the same thing.
 */
function SecondaryActions({
  state,
  intervention,
  intervals,
  busy,
  onAct,
}: {
  state: CallOutState;
  intervention: Intervention;
  intervals: readonly AttendanceInterval[];
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
}) {
  const t = useText();
  const open = isOpenStatus(intervention.status);
  const step = nextStep(state);
  if (!open && intervals.length === 0) return null;

  return (
    <section className="panel">
      <details className="disclosure" data-testid="more-actions">
        <summary className="disclosure__summary">{t.callout.moreActions}</summary>
        <div className="disclosure__body">
          {open && state.answer !== null ? (
            <div>
              <p className="muted small">{t.callout.changeAnswer}</p>
              <div className="row-actions">
                {(['DOLAZIM', 'NE_MOGU'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`btn btn--big ${
                      state.answer === option ? 'btn--primary' : 'btn--ghost'
                    }`}
                    data-testid={`change-answer-${option}`}
                    aria-pressed={state.answer === option}
                    disabled={busy}
                    onClick={() =>
                      void onAct(
                        () => submitResponse(intervention.id, option, null, false),
                        t.mobilisation.answerSaved,
                      )
                    }
                  >
                    {t.vocabulary.answer[option] ?? option}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Movement is reachable even when the dominant action has moved past
              it: somebody who reported being on scene may have to correct it. */}
          {open && step !== 'MOVE' && state.answer !== null ? (
            <div>
              {/*
                The warning travels WITH the buttons it warns about.

                It used to live only on the `MOVE` step, so once a member had
                reported being on scene it disappeared - and these buttons, the
                ones that include `Na licu mjesta`, sat here with nothing saying
                that tapping them is not reporting attendance. That is the one
                confusion this whole schema is built to prevent, and it was
                being prevented in the one state where it had already passed.
              */}
              <p className="muted small">{t.callout.doMoveWhy}</p>
              <div className="row-actions">
              {JOURNEY_STEPS.map((journeyStep: JourneyStep) => (
                <button
                  key={journeyStep}
                  type="button"
                  className={`btn ${state.journey === journeyStep ? 'btn--primary' : 'btn--ghost'}`}
                  data-testid={`journey-${journeyStep}`}
                  aria-pressed={state.journey === journeyStep}
                  disabled={busy}
                  onClick={() =>
                    void onAct(
                      () => setJourneyProgress(intervention.id, journeyStep),
                      `${t.mobilisation.journeySavedPrefix} ${
                        t.vocabulary.journey[journeyStep] ?? journeyStep
                      }. ${t.mobilisation.journeySavedSuffix}`,
                    )
                  }
                >
                  {t.vocabulary.journey[journeyStep] ?? journeyStep}
                </button>
              ))}
              </div>
            </div>
          ) : null}

          {intervals.length > 0 ? (
            <>
              <p className="muted small">{t.callout.attendanceRecord}</p>
              <ul className="stack" data-testid="my-intervals">
                {intervals.map((interval) => {
                  const intervalState = attendanceState(interval);
                  return (
                    <li key={interval.id} className="card">
                      <p>
                        <Chip
                          tone={
                            intervalState === 'CONFIRMED'
                              ? 'yes'
                              : intervalState === 'REJECTED'
                                ? 'no'
                                : 'later'
                          }
                          symbol={
                            intervalState === 'CONFIRMED'
                              ? '+'
                              : intervalState === 'REJECTED'
                                ? '-'
                                : '~'
                          }
                        >
                          {t.vocabulary.attendanceState[intervalState] ?? intervalState}
                        </Chip>{' '}
                        <span className="muted small">
                          {t.vocabulary.attendanceSource[interval.source] ?? interval.source}
                        </span>
                      </p>
                      <p className="muted small">
                        {formatTime(interval.startedAt)} -{' '}
                        {interval.endedAt
                          ? formatTime(interval.endedAt)
                          : t.mobilisation.stillRunning}
                        {intervalState === 'CONFIRMED' && interval.endedAt
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
            </>
          ) : null}
        </div>
      </details>
    </section>
  );
}
