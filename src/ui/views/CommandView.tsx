/**
 * The commander's console, on real server data.
 *
 * Four jobs on one route, as tabs, because a phone at the station cannot carry
 * four separate navigation entries and because they are one task: run the
 * call-out. The tabs are `Poziv` (create and publish), `Pregled` (who is doing
 * what), `Prisustvo` (confirm the record) and `Vozila`.
 *
 * **The rule the overview keeps.** Every fact about a member has its own
 * column, and none of them is collapsed into a single "status". A row can show
 * that somebody opened the call-out forty minutes ago, never answered, and is
 * nonetheless checked in - which is a real situation a commander must be able to
 * see, and which any single-status design would flatten into one of its three
 * parts.
 *
 * **What this screen never claims.** Publishing creates an in-app obligation and,
 * only for opted-in devices, a Web Push outbox row. Provider acceptance still is
 * not proof that a phone made a sound or that the member opened the call-out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attendanceState,
  checkIn,
  checkOut,
  closeIntervention,
  confirmAttendance,
  confirmAttendanceMany,
  correctAttendance,
  createDraft,
  discardDraft,
  fetchAttendance,
  fetchAvailability,
  fetchInterventionAudit,
  fetchInterventions,
  fetchEligibleRecipients,
  fetchRecipientFacts,
  fetchVehicleMovements,
  isOpenStatus,
  participationMs,
  publishIntervention,
  recordVehicleDeparture,
  recordVehicleReturn,
  rejectAttendance,
  setInterventionStatus,
  unconfirmAttendance,
  INTERVENTION_KINDS,
  SETTABLE_STATUSES,
  type AttendanceInterval,
  type AuditEvent,
  type AvailabilityRow,
  type Intervention,
  type InterventionKind,
  type EligibleRecipient,
  type ReadFailure,
  type RecipientFacts,
  type VehicleMovement,
} from '@/auth/operations';
import { useLiveOperations } from '@/auth/live';
import { isPermissionDenied } from '@/auth/supabaseClient';
import { requestPushDelivery } from '@/notifications/push';
import { formatDurationMs } from '@/auth/duration';
import { recipientTimings, summarise } from '@/auth/metrics';
import { OperationalSummary, ResponseTimings } from '../components/timings';
import { loadRoster, loadVehicles, type RosterMember, type RosterVehicle } from '@/auth/roster';
import { OperationalGate, type OperationalContext } from '../components/OperationalGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IncidentCard } from '../components/IncidentCard';
import {
  clearDraft,
  draftHasContent,
  readStoredDraft,
  storeDraft,
  EMPTY_DRAFT,
  type CallOutDraft,
} from './callOutDraft';
import { Chip, EmptyState, Field, Notice, ScrollRegion } from '../components/primitives';
import {
  ATTENDANCE_STATE_SYMBOL,
  formatTime,
  JOURNEY_SYMBOL,
  SERVER_ANSWER_SYMBOL,
} from '@/i18n/labels';
import type { Strings } from '@/i18n/strings.me';
import { useText } from '@/i18n/useText';

type Tab = 'poziv' | 'pregled' | 'prisustvo' | 'vozila';

const TAB_IDS: readonly Tab[] = ['poziv', 'pregled', 'prisustvo', 'vozila'];

function tabLabel(id: Tab, t: Strings): string {
  return id === 'poziv' ? t.command.tabCallOut
    : id === 'pregled' ? t.command.tabOverview
    : id === 'prisustvo' ? t.command.tabAttendance
    : t.command.tabVehicles;
}

/**
 * Writing a call-out, one question at a time.
 *
 * Four steps in the commander's head, two server operations underneath:
 * `DETAILS` and `WHERE` end in `create_intervention_draft`, `WHO` and `REVIEW`
 * in `publish_intervention`. The split is at the write, so no step has to carry
 * half-entered state across one.
 */
type ComposeStep = 'DETAILS' | 'WHERE';
type PublishStep = 'WHO' | 'REVIEW';

const COMPOSE_STEPS: readonly ComposeStep[] = ['DETAILS', 'WHERE'];

function composeStepLabel(id: ComposeStep | PublishStep, t: Strings): string {
  return id === 'DETAILS' ? t.command.stepDetails
    : id === 'WHERE' ? t.command.stepWhere
    : id === 'WHO' ? t.command.stepWho
    : t.command.stepReview;
}

export function CommandView() {
  return (
    <OperationalGate allow={['OWNER', 'ADMIN', 'COMMANDER']}>
      {(context) => <CommandConsole context={context} />}
    </OperationalGate>
  );
}

interface ConsoleData {
  interventions: readonly Intervention[];
  members: readonly RosterMember[];
  /**
   * Who may be CALLED, answered by the server.
   *
   * Kept separate from `members`, which is the roster. The two are different
   * questions and were conflated until a withdrawn member appeared in the
   * picker: they were on the roster, their record was active, and their
   * account had been withdrawn, so they could not have opened the call-out.
   *
   * Null means the list could not be read. That is not the same as nobody
   * qualifying, and the screen says which.
   */
  eligible: readonly EligibleRecipient[] | null;
  vehicles: readonly RosterVehicle[];
  availability: readonly AvailabilityRow[];
  movements: readonly VehicleMovement[];
  recipients: readonly RecipientFacts[];
  attendance: readonly AttendanceInterval[];
  /**
   * The append-only chronology of the selected intervention.
   *
   * Needed here, not only in the archive, because it is the only place that
   * holds EVERY movement a member reported and the actor behind every state
   * change. The recipient rows carry the latest movement and nothing before it,
   * so a commander reading the console without this would see that somebody is
   * on scene and never when they set off.
   *
   * Null means the read failed or the project has not been migrated. The
   * timings degrade - movements empty, arrival falls back to the current
   * journey row - rather than the screen breaking.
   */
  audit: readonly AuditEvent[] | null;
}

const EMPTY: ConsoleData = {
  interventions: [],
  members: [],
  eligible: null,
  vehicles: [],
  availability: [],
  movements: [],
  recipients: [],
  attendance: [],
  audit: null,
};

function CommandConsole({ context }: { context: OperationalContext }) {
  const t = useText();
  const [tab, setTab] = useState<Tab>('poziv');
  const [data, setData] = useState<ConsoleData>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const selected = useMemo(
    () => data.interventions.find((i) => i.id === selectedId) ?? null,
    [data.interventions, selectedId],
  );

  /**
   * Re-read everything.
   *
   * `silent` is what a live update uses. An automatic re-read must not flash
   * "Ucitavanje sa servera..." every few seconds, and - more importantly - must
   * not look like the screen reset itself, which is the exact complaint this
   * slice exists to fix. It replaces the data underneath and touches nothing
   * else: not the tab, not the selection, not a half-typed call-out.
   */
  const refresh = useCallback(
    async (keepId?: string | null, options?: { readonly silent?: boolean }) => {
      const ticket = ++generation.current;
      const silent = options?.silent === true;
      if (!silent) setLoading(true);
      setLoadError(null);
      /** Record why the console has nothing to show, if this read is still current. */
      const failed = (forTicket: number, reason: ReadFailure) => {
        if (!mounted.current || forTicket !== generation.current) return;
        setLoadError(reason === 'REFUSED' ? 'REFUSED_READ' : 'UNAVAILABLE');
      };
      try {
        const [interventionsRead, members, eligible, vehicles, availabilityRead, movementsRead] =
          await Promise.all([
            fetchInterventions(),
            loadRoster(),
            fetchEligibleRecipients(),
            loadVehicles(),
            fetchAvailability(),
            fetchVehicleMovements(),
          ]);
        /*
         * The console says no if any of the three refused.
         *
         * A commander reads this screen to decide who to send. Showing it with
         * a silently empty availability board, or an empty vehicle list, would
         * invite a decision made on information the server declined to give.
         */
        const refused = [interventionsRead, availabilityRead, movementsRead].find((r) => !r.ok);
        if (refused && !refused.ok) return failed(ticket, refused.reason);
        if (!interventionsRead.ok || !availabilityRead.ok || !movementsRead.ok) return;
        const interventions = interventionsRead.value;

        // The newest call-out that is still open is what a commander wants on
        // opening the screen; falling back to the newest of any kind means the
        // screen is never blank when history exists.
        const focusId =
          keepId ??
          interventions.find((i) => isOpenStatus(i.status))?.id ??
          interventions[0]?.id ??
          null;

        let recipients: readonly RecipientFacts[] = [];
        let attendance: readonly AttendanceInterval[] = [];
        let audit: readonly AuditEvent[] | null = null;
        if (focusId) {
          const [recipientsRead, attendanceRead, auditRead] = await Promise.all([
            fetchRecipientFacts(focusId),
            fetchAttendance(
              focusId,
              new Map(members.map((m) => [m.id, m.fullName] as const)),
            ),
            fetchInterventionAudit(focusId),
          ]);
          if (!recipientsRead.ok) return failed(ticket, recipientsRead.reason);
          if (!attendanceRead.ok) return failed(ticket, attendanceRead.reason);
          recipients = recipientsRead.value;
          attendance = attendanceRead.value;
          // The chronology is deliberately exempt: it already answers null on
          // failure and the screen says "chronology could not be read" rather
          // than pretending the call-out had no events.
          audit = auditRead;
        }

        if (!mounted.current || ticket !== generation.current) return;
        setData({
          interventions, members, eligible, vehicles,
          availability: availabilityRead.value,
          movements: movementsRead.value,
          recipients, attendance, audit,
        });
        setSelectedId(focusId);
        setHasLoaded(true);
      } catch (error) {
        if (!mounted.current || ticket !== generation.current) return;
        /*
         * A PostgREST failure is a PLAIN OBJECT, not an `Error`.
         *
         * This read `error instanceof Error && /permission/i.test(...)`, and a
         * policy refusal is exactly the case that fails the first half - so the
         * branch saying "the server refused your read; check whether your
         * account still has a role" could never run, and a commander whose role
         * had been taken away was told to wait for a server that was working.
         * See `isPermissionDenied`.
         */
        setLoadError(isPermissionDenied(error) ? 'REFUSED_READ' : 'UNAVAILABLE');
      } finally {
        if (mounted.current && ticket === generation.current && !silent) setLoading(false);
      }
    },
    [],
  );

  /**
   * Stay current without anybody pressing anything.
   *
   * The gate above has already confirmed with the server who this is and that
   * they may be here, which is why `enabled` can be a constant true - the hook
   * is never reached otherwise. The notice itself is never read: `refresh` goes
   * through the same policy-checked queries as every other read on this screen.
   */
  const liveStatus = useLiveOperations({
    enabled: true,
    interventionId: selectedId,
    onChange: () => void refresh(selectedId, { silent: true }),
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const after = async (outcome: { ok: boolean; message?: string }, successText: string) => {
    if (outcome.ok) {
      setMessage({ tone: 'info', text: successText });
      await refresh(selectedId);
    } else {
      setMessage({ tone: 'error', text: outcome.message ?? t.command.notSaved });
    }
  };

  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label={t.command.tabsLabel}>
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={`tabs__tab ${tab === id ? 'tabs__tab--on' : ''}`}
            data-testid={`cmd-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {tabLabel(id, t)}
          </button>
        ))}
      </div>

      {loadError ? (
        <Notice tone="error">
          {loadError === 'REFUSED_READ' ? t.command.refusedRead : t.command.unavailable}{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void refresh(selectedId)}>
            {t.gate.retry}
          </button>
        </Notice>
      ) : null}
      {message ? (
        <div role="status">
          <Notice tone={message.tone === 'error' ? 'error' : 'info'}>{message.text}</Notice>
        </div>
      ) : null}
      {loading ? <p role="status" className="muted small">{t.command.loading}</p> : null}

      <InterventionPicker
        interventions={data.interventions}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          void refresh(id);
        }}
      />

      {/*
        Every tab stays MOUNTED and the inactive ones are hidden.

        Found by a browser test: a commander who typed half a call-out, stepped
        across to `Pregled` to see who was available and came back found the
        form empty. Rendering only the active tab destroys its `useState`, and
        the draft with it - the same class of fault as the resume reset, just
        reached by a different route.

        It also fixes the tab markup. Each button already declared
        `aria-controls="panel-<id>"`, but only one panel existed at a time and
        it carried the ACTIVE tab's id, so three of the four pointed at nothing.
      */}
      {TAB_IDS.map((id) => (
        <div
          key={id}
          role="tabpanel"
          id={`panel-${id}`}
          aria-labelledby={`tab-${id}`}
          tabIndex={0}
          className="tabpanel"
          hidden={tab !== id || !hasLoaded}
        >
          {id === 'poziv' ? (
            <CallOutTab
              data={data}
              selected={selected}
              onDone={after}
              onRefresh={() => void refresh(selectedId)}
            />
          ) : null}
          {id === 'pregled' ? <OverviewTab data={data} selected={selected} /> : null}
          {id === 'prisustvo' ? (
            <AttendanceTab data={data} selected={selected} onDone={after} context={context} />
          ) : null}
          {id === 'vozila' ? <VehiclesTab data={data} selected={selected} onDone={after} /> : null}
        </div>
      ))}

      {/*
        Says which of the two it is. "Uzivo" and "every twelve seconds" are
        different promises, and a commander deciding how much to trust what is
        in front of them needs the difference.

        It sits BELOW the console now. It qualifies everything above it, and it
        was costing a line of the first screenful - the same reason the push
        panel moved off the top of the firefighter's screen. Nobody opens this
        console to read the transport status first.
      */}
      <p className="muted small live-state" data-testid="live-state" data-live={liveStatus}>
        <span className={`live-dot live-dot--${liveStatus.toLowerCase()}`} aria-hidden="true" />
        {t.live[liveStatus]}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function InterventionPicker({
  interventions,
  selectedId,
  onSelect,
}: {
  interventions: readonly Intervention[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useText();

  /*
   * Nothing to pick, nothing to show.
   *
   * With one intervention on record the picker was a label, a marker reading
   * "(nije obavezno)" and a dropdown holding a single option - three lines of
   * the first screenful spent on a control that could not change anything. And
   * "optional" was simply false: this is not a field somebody may leave blank,
   * it is the switch that decides what the whole console is about. That is what
   * `Field` is for and why this is no longer one.
   */
  if (interventions.length < 2) return null;

  return (
    <div className="switcher">
      <label className="switcher__label" htmlFor="intervention-picker">
        {t.command.pickIntervention}
      </label>
      <select
        id="intervention-picker"
        className="switcher__select"
        data-testid="intervention-picker"
        value={selectedId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        {interventions.map((i) => (
          <option key={i.id} value={i.id}>
            {t.vocabulary.interventionStatus[i.status] ?? i.status} - {i.title}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: create, publish, manage.
// ---------------------------------------------------------------------------

function CallOutTab({
  data,
  selected,
  onDone,
  onRefresh,
}: {
  data: ConsoleData;
  selected: Intervention | null;
  onDone: (outcome: { ok: boolean; message?: string }, text: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const t = useText();

  /**
   * The unsaved call-out, as one value rather than six.
   *
   * Six `useState` calls meant six places to remember whenever the form was
   * restored, cleared or persisted, and the persistence below needs to write
   * all of it or none. One object with one setter is the difference between a
   * draft that is kept and a draft that is kept except for the field somebody
   * forgot to add to the list.
   *
   * Seeded from this device's storage on the first render only. A `useState`
   * initialiser runs once; doing it in an effect would flash an empty form and
   * then overwrite whatever the commander had already started typing.
   */
  const [draft, setDraft] = useState<CallOutDraft>(() => readStoredDraft() ?? EMPTY_DRAFT);
  const [restored] = useState(() => readStoredDraft() !== null);
  const field = <K extends keyof CallOutDraft>(key: K, value: CallOutDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Persist on every keystroke.
   *
   * Cheap - one small JSON write - and the alternative is choosing a moment to
   * save, which is always the moment before the one where the page went away.
   */
  useEffect(() => {
    storeDraft(draft);
  }, [draft]);

  // One key per compose session. A retried tap after a dropped connection must
  // return the SAME draft, never create a second call-out for one incident.
  const idempotencyKey = useRef(`ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<null | 'PUBLISH' | 'CLOSE' | 'CANCEL'>(null);
  const [closeReason, setCloseReason] = useState('');

  // Where the commander is in each half of the sequence. Two pieces of state,
  // not one, because the two halves are separated by a write to the server and
  // a draft that exists is a different situation from one still being typed.
  const [composeStep, setComposeStep] = useState<ComposeStep>('DETAILS');
  const [publishStep, setPublishStep] = useState<PublishStep>('WHO');

  const availableBy = useMemo(
    () => new Map(data.availability.map((a) => [a.memberId, a] as const)),
    [data.availability],
  );
  // Not filtered here. The screen used to apply its own rule - an active
  // roster row with a linked account - which passed a member whose ACCOUNT had
  // been withdrawn. The server answers this question now, by the same rule
  // `publish_intervention` enforces, so the list and the command cannot
  // disagree. See `fetchEligibleRecipients`.
  const eligible = data.eligible ?? [];
  const eligibleUnavailable = data.eligible === null;

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await createDraft({
        kind: draft.kind as InterventionKind,
        title: draft.title.trim(),
        instructions: draft.instructions.trim(),
        location: draft.location.trim(),
        idempotencyKey: idempotencyKey.current,
        otherKindNote: draft.kind === 'DRUGO' ? draft.otherNote.trim() : null,
        assemblyPoint: draft.assembly.trim() === '' ? null : draft.assembly.trim(),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onDone({ ok: true }, t.command.draftSaved);
      // The server holds it now, so the copy on this device has done its job.
      // Left behind it would reappear in the form the next time the console
      // opened, as a second call-out for an incident already recorded.
      setDraft(EMPTY_DRAFT);
      clearDraft();
      setComposeStep('DETAILS');
      idempotencyKey.current = `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await publishIntervention(selected.id, [...selectedMembers]);
      const workerReached = result.ok ? await requestPushDelivery(result.value) : false;
      await onDone(
        result.ok ? { ok: true } : { ok: false, message: result.message },
        workerReached ? t.command.publishedWorkerReached : t.command.publishedWorkerQueued,
      );
      setSelectedMembers(new Set());
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const finish = async (status: 'CLOSED' | 'CANCELLED') => {
    if (!selected) return;
    setBusy(true);
    try {
      const openIntervals = data.attendance.filter((a) => a.endedAt === null).length;
      const result = await closeIntervention(
        selected.id,
        status,
        closeReason.trim(),
        openIntervals > 0,
      );
      await onDone(
        result,
        status === 'CLOSED' ? t.command.closedMessage : t.command.cancelledMessage,
      );
      setCloseReason('');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const isDraft = selected?.status === 'DRAFT';
  const openIntervals = data.attendance.filter((a) => a.endedAt === null).length;
  /**
   * Whether a call-out is being RUN right now.
   *
   * The compose form used to sit at the top of this tab unconditionally, so a
   * commander with a fire in progress opened their console onto a blank form
   * for a DIFFERENT fire, and had to scroll past it to reach the one they were
   * running. The running intervention comes first now and the form goes below
   * it, closed - reachable in one tap, which is the right cost for starting a
   * second call-out and the wrong cost for reading the first.
   */
  const running = selected !== null && !isDraft && isOpenStatus(selected.status);

  /*
   * What has to be filled in before the draft can be saved.
   *
   * The server enforces this too - `create_intervention_draft` refuses an empty
   * title, location or instruction - and this only decides whether the button
   * that would fail is offered at all. A disabled button with nothing saying
   * why is its own kind of confusion, so the step that is incomplete says so.
   */
  const detailsComplete =
    draft.title.trim() !== '' && (draft.kind !== 'DRUGO' || draft.otherNote.trim() !== '');
  const whereComplete = draft.location.trim() !== '' && draft.instructions.trim() !== '';

  /*
   * ---------------------------------------------------------------------------
   * A CALL-OUT IS WRITTEN IN A SEQUENCE, NOT ON A FORM
   * ---------------------------------------------------------------------------
   *
   * Six fields, a submit button and a recipient picker all at once is a page a
   * commander has to read before they can start. The sequence asks one question
   * at a time - what happened, then where and what to do, then who, then a last
   * look before it goes - which is the order somebody thinks in anyway.
   *
   * BOTH STEPS STAY MOUNTED and the inactive one is `hidden`. Rendering only
   * the current step would destroy its `useState` on every move between them,
   * which is the exact fault class that `live-updates.spec.ts` exists for. The
   * fields are also held in one object persisted to this device, so a reload
   * does not lose them either - see `callOutDraft.ts`.
   */
  const composer = (
    <div className="wizard" data-testid="new-call-out-wizard" data-step={composeStep}>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {restored && draftHasContent(draft) ? (
        <Notice tone="info" testId="draft-restored">{t.command.draftRestored}</Notice>
      ) : null}

      <ol className="wizard__steps" data-testid="wizard-steps">
        {COMPOSE_STEPS.map((id, index) => (
          <li
            key={id}
            className={`wizard__step ${composeStep === id ? 'wizard__step--on' : ''}`}
            aria-current={composeStep === id ? 'step' : undefined}
            data-testid={`wizard-step-${id}`}
          >
            <span className="wizard__num">{index + 1}</span>
            <span className="wizard__name">{composeStepLabel(id, t)}</span>
          </li>
        ))}
      </ol>

      <div hidden={composeStep !== 'DETAILS'}>
        <p className="muted small">{t.command.newNote}</p>

        <Field label={t.command.fieldKind} required controlId="new-kind">
          {(props) => (
            <select
              {...props}
              data-testid="new-kind"
              value={draft.kind}
              onChange={(e) => field('kind', e.target.value)}
            >
              {INTERVENTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.vocabulary.interventionKind[k] ?? k}
                </option>
              ))}
            </select>
          )}
        </Field>

        {draft.kind === 'DRUGO' ? (
          <Field label={t.command.fieldOtherKind} required controlId="new-other">
            {(props) => (
              <input
                {...props}
                data-testid="new-other"
                value={draft.otherNote}
                onChange={(e) => field('otherNote', e.target.value)}
              />
            )}
          </Field>
        ) : null}

        <Field
          label={t.command.fieldTitle}
          required
          hint={t.command.fieldTitleHint}
          controlId="new-title"
        >
          {(props) => (
            <input
              {...props}
              data-testid="new-title"
              value={draft.title}
              onChange={(e) => field('title', e.target.value)}
            />
          )}
        </Field>

        <div className="row-actions">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="wizard-next"
            disabled={!detailsComplete}
            onClick={() => setComposeStep('WHERE')}
          >
            {t.command.wizardNext}
          </button>
        </div>
      </div>

      <div hidden={composeStep !== 'WHERE'}>
        <Field
          label={t.command.fieldLocation}
          required
          hint={t.command.fieldLocationHint}
          controlId="new-location"
        >
          {(props) => (
            <input
              {...props}
              data-testid="new-location"
              value={draft.location}
              onChange={(e) => field('location', e.target.value)}
            />
          )}
        </Field>

        <Field label={t.command.fieldAssembly} controlId="new-assembly">
          {(props) => (
            <input
              {...props}
              data-testid="new-assembly"
              value={draft.assembly}
              onChange={(e) => field('assembly', e.target.value)}
            />
          )}
        </Field>

        <Field label={t.command.fieldInstructions} required controlId="new-instructions">
          {(props) => (
            <textarea
              {...props}
              data-testid="new-instructions"
              rows={3}
              value={draft.instructions}
              onChange={(e) => field('instructions', e.target.value)}
            />
          )}
        </Field>

        {/* Said before the button rather than discovered after it. Saving a
            draft is not sending it, and a commander who believes otherwise has
            a crew nobody called. */}
        <Notice tone="info">{t.command.draftIsNotSent}</Notice>

        <div className="row-actions">
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="wizard-back"
            onClick={() => setComposeStep('DETAILS')}
          >
            {t.command.wizardBack}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="create-draft"
            disabled={busy || !detailsComplete || !whereComplete}
            onClick={() => void create()}
          >
            {busy ? t.command.saving : t.command.saveDraft}
          </button>
        </div>
      </div>
    </div>
  );

  const composerPanel = running ? (
    <section className="panel">
      <details className="disclosure" data-testid="new-call-out-disclosure">
        <summary className="disclosure__summary">{t.command.newSummary}</summary>
        <div className="disclosure__body">{composer}</div>
      </details>
    </section>
  ) : (
    <section className="panel">
      <h2 className="panel__title">{t.command.newTitle}</h2>
      {composer}
    </section>
  );

  return (
    <div className="stack">
      {/*
        ONE render position, always.
        
        The obvious way to move a panel is to render it in one of two places
        depending on a flag - and that unmounts it when the flag flips, taking
        its `useState` with it. Publishing the selected draft flips `running`,
        so a commander who had half-typed an unrelated second call-out would
        have lost it at exactly the wrong moment. That is the same class of
        fault as the resume reset, and `live-updates.spec.ts` exists because of
        it. The panel stays here and only its shape changes.
      */}
      {selected ? (
        <>
          {/*
            The same card the firefighters are looking at.

            This was a definition list: an uppercase label column beside every
            value, two pairs to a row, so on a phone a location got half the
            width and wrapped to three lines next to a label that fitted on one.
            The status was a chip inside the heading and the kind was a row of
            the list. Reading it took real effort in the one moment nobody has
            any to spare.

            It is now `IncidentCard` - the identical component the firefighter's
            screen leads with. Every fact that was in the list is still here;
            they are arranged the way somebody actually asks for them, and a
            commander and a firefighter standing at the same incident now see
            the same description of it.
          */}
          <IncidentCard intervention={selected} testId="selected" />

          {/*
            WHO IS COMING, second, on the tab the commander lands on.

            The console opened onto the incident's static facts and a status
            picker; the one question a commander actually has during a call-out -
            who is coming - lived on a different tab. A compact summary here
            answers it without a tap, and the full board is still one tap away.
          */}
          {!isDraft ? <ResponseBar data={data} /> : null}

          {/* Only when it holds something. A closed intervention with no closing
              note has no recipients to pick, no status to set and nothing to
              close, and an empty bordered card below the incident would read as
              a panel that failed to load. */}
          {isDraft || isOpenStatus(selected.status) || selected.closeReason ? (
          <section className="panel" data-testid="intervention-actions">
          {isDraft ? (
            <>
              {/*
                Steps three and four of the same sequence.

                They live here rather than in the composer above because they
                belong to a DIFFERENT server operation: the first two steps end
                in `create_intervention_draft`, these two in
                `publish_intervention`. Splitting them at the boundary the
                server already draws means neither half has to carry state
                across a write, and the draft is safe on the server before
                anybody starts choosing who to wake.
              */}
              <ol className="wizard__steps" data-testid="publish-steps">
                {(['WHO', 'REVIEW'] as const).map((id, index) => (
                  <li
                    key={id}
                    className={`wizard__step ${publishStep === id ? 'wizard__step--on' : ''}`}
                    aria-current={publishStep === id ? 'step' : undefined}
                    data-testid={`publish-step-${id}`}
                  >
                    <span className="wizard__num">{index + 3}</span>
                    <span className="wizard__name">{composeStepLabel(id, t)}</span>
                  </li>
                ))}
              </ol>

              <div hidden={publishStep !== 'WHO'}>
              <h3>{t.command.recipientsTitle}</h3>
              <p className="muted small">{t.command.recipientsNote}</p>
              {/*
                An empty picker with no explanation reads as a screen that has
                not finished loading. It has two entirely different causes and a
                commander must not have to guess which one they are looking at.
              */}
              {eligibleUnavailable ? (
                <Notice tone="error" testId="eligible-recipients-unavailable">
                  <strong>{t.command.recipientsUnreadTitle}</strong> {t.command.recipientsUnreadText}
                </Notice>
              ) : eligible.length === 0 ? (
                <Notice tone="warn" testId="no-eligible-recipients">
                  <strong>{t.command.recipientsNoneTitle}</strong> {t.command.recipientsNoneText}
                </Notice>
              ) : null}
              <ScrollRegion
                label={t.command.recipientsListLabel}
                className="table-wrap table-wrap--tall"
              >
                <ul className="pick-list" data-testid="recipient-picker">
                  {eligible.map((m) => {
                    const availability = availableBy.get(m.memberId);
                    return (
                      <li key={m.memberId}>
                        <label className="pick">
                          <input
                            type="checkbox"
                            checked={selectedMembers.has(m.memberId)}
                            onChange={(event) => {
                              const next = new Set(selectedMembers);
                              if (event.target.checked) next.add(m.memberId);
                              else next.delete(m.memberId);
                              setSelectedMembers(next);
                            }}
                          />
                          <span className="pick__name">{m.fullName}</span>
                          {availability ? (
                            <Chip
                              tone={availability.available ? 'yes' : 'no'}
                              symbol={availability.available ? '+' : '-'}
                            >
                              {availability.available
                                ? t.command.availableYes
                                : t.command.availableNo}
                            </Chip>
                          ) : (
                            <Chip tone="unknown" symbol="?">
                              {t.command.availableUnknown}
                            </Chip>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </ScrollRegion>
              <p className="muted small" data-testid="selected-recipient-count">
                {t.command.selectedCount}: {selectedMembers.size}
              </p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="to-review"
                  disabled={selectedMembers.size === 0}
                  onClick={() => setPublishStep('REVIEW')}
                >
                  {t.command.wizardToReview}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  data-testid="discard-draft"
                  disabled={busy}
                  onClick={() => setConfirming('CANCEL')}
                >
                  {t.command.discardDraft}
                </button>
              </div>
              </div>

              {/*
                The last look before a telephone rings in somebody's pocket.

                Publishing is the one act on this console that reaches other
                people, and until now it was a button underneath a scrolling
                list of names - the commander could see the crew they had ticked
                or the incident they had written, never both. This shows exactly
                what is about to be sent and to how many, in one screenful,
                using the record the server already holds rather than the form
                fields, so what is reviewed is what will actually go.
              */}
              <div hidden={publishStep !== 'REVIEW'} data-testid="publish-review">
                <h3>{t.command.reviewTitle}</h3>
                {/*
                  A SUMMARY, not a second card.

                  This rendered a full `IncidentCard` and the full card was
                  already directly above it on the same screen - the identical
                  block twice, which is the duplication this whole pass exists
                  to remove. What the review step has to add is confirmation of
                  what is about to be sent, in one line, plus the names.
                */}
                <p className="review__what" data-testid="review-what">
                  <strong>{selected.title}</strong>
                  {' - '}
                  {selected.incidentLocation}
                </p>
                <p className="review__count" data-testid="review-count">
                  <strong>{selectedMembers.size}</strong> {t.command.reviewRecipients}
                </p>
                <ul className="review__names" data-testid="review-names">
                  {eligible
                    .filter((m) => selectedMembers.has(m.memberId))
                    .map((m) => (
                      <li key={m.memberId}>{m.fullName}</li>
                    ))}
                </ul>
                {/* Provider acceptance is not a ringing telephone. Said here,
                    before publishing, not only in the confirmation. */}
                <Notice tone="warn">{t.command.confirmPublishTransport}</Notice>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid="review-back"
                    onClick={() => setPublishStep('WHO')}
                  >
                    {t.command.wizardBack}
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--big"
                    data-testid="publish"
                    disabled={busy || selectedMembers.size === 0}
                    onClick={() => setConfirming('PUBLISH')}
                  >
                    {t.command.publish}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {isOpenStatus(selected.status) ? (
            <>
              <h3>{t.command.statusTitle}</h3>
              <div className="row-actions">
                {SETTABLE_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`btn ${selected.status === status ? 'btn--primary' : 'btn--ghost'}`}
                    data-testid={`status-${status}`}
                    disabled={busy || selected.status === status}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        const result = await setInterventionStatus(
                          selected.id,
                          status,
                          selected.version,
                        );
                        await onDone(
                          result,
                          `${t.command.statusChanged}: ${
                            t.vocabulary.interventionStatus[status] ?? status
                          }.`,
                        );
                        setBusy(false);
                      })()
                    }
                  >
                    {t.vocabulary.interventionStatus[status] ?? status}
                  </button>
                ))}
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn--danger"
                  data-testid="close-intervention"
                  disabled={busy}
                  onClick={() => setConfirming('CLOSE')}
                >
                  {t.command.closeIntervention}
                </button>
              </div>
            </>
          ) : null}

          {selected.closeReason ? (
            <p className="muted small">
              {t.command.closedWithNote}: <strong>{selected.closeReason}</strong>
            </p>
          ) : null}
          </section>
          ) : null}
        </>
      ) : (
        <EmptyState title={t.command.noInterventionTitle}>
          {t.command.noInterventionText}
        </EmptyState>
      )}

      {composerPanel}

      {confirming === 'PUBLISH' ? (
        <ConfirmDialog
          open
          title={t.command.confirmPublishTitle}
          confirmLabel={t.command.confirmPublishAction}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void publish()}
        >
          <p>
            {t.command.confirmPublishToPrefix} <strong>{selectedMembers.size}</strong>{' '}
            {t.command.confirmPublishToSuffix}
          </p>
          <p className="muted small">{t.command.confirmPublishTransport}</p>
        </ConfirmDialog>
      ) : null}

      {confirming === 'CANCEL' || confirming === 'CLOSE' ? (
        <ConfirmDialog
          open
          title={
            confirming === 'CLOSE' ? t.command.confirmCloseTitle : t.command.confirmDiscardTitle
          }
          confirmLabel={
            confirming === 'CLOSE' ? t.command.confirmCloseAction : t.command.confirmDiscardAction
          }
          confirmDisabled={closeReason.trim().length < 2}
          onCancel={() => {
            setConfirming(null);
            setCloseReason('');
          }}
          onConfirm={() =>
            void (confirming === 'CLOSE'
              ? finish('CLOSED')
              : (async () => {
                  if (!selected) return;
                  setBusy(true);
                  const result = await discardDraft(selected.id, closeReason.trim());
                  await onDone(result, t.command.draftDiscarded);
                  setCloseReason('');
                  setBusy(false);
                  setConfirming(null);
                })())
          }
        >
          <Field
            label={t.command.fieldReason}
            required
            hint={t.command.reasonStaysHint}
            controlId="close-reason"
          >
            {(props) => (
              <input
                {...props}
                data-testid="close-reason"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              />
            )}
          </Field>
          {confirming === 'CLOSE' && openIntervals > 0 ? (
            <Notice tone="warn">
              {t.command.openIntervalsPrefix} <strong>{openIntervals}</strong>{' '}
              {t.command.openIntervalsSuffix}
            </Notice>
          ) : null}
        </ConfirmDialog>
      ) : null}

      <p className="muted small">
        <button type="button" className="btn btn--ghost" onClick={onRefresh}>
          {t.command.refresh}
        </button>
      </p>
    </div>
  );
}

/**
 * How the crew answered, in one glance.
 *
 * Six counts, each its own fact and none of them inferred from another - the
 * same rule the board on the next tab keeps, at the size that fits above it.
 * `Na terenu` is the count of members who reported being on scene, which is a
 * statement about position and NOT about attendance; attendance is confirmed
 * time and lives on its own tab.
 */
function ResponseBar({ data }: { data: ConsoleData }) {
  const t = useText();
  const recipients = data.recipients;
  if (recipients.length === 0) return null;

  const count = (predicate: (r: RecipientFacts) => boolean) =>
    recipients.filter(predicate).length;

  const cells = [
    { key: 'invited', label: t.responseBar.invited, value: recipients.length, tone: '' },
    { key: 'coming', label: t.responseBar.coming, value: count((r) => r.answer === 'DOLAZIM'), tone: 'yes' },
    { key: 'later', label: t.responseBar.later, value: count((r) => r.answer === 'DOLAZIM_KASNIJE'), tone: 'later' },
    { key: 'declined', label: t.responseBar.declined, value: count((r) => r.answer === 'NE_MOGU'), tone: 'no' },
    { key: 'noanswer', label: t.responseBar.noAnswer, value: count((r) => r.answer === null), tone: 'unknown' },
    { key: 'onscene', label: t.responseBar.onScene, value: count((r) => r.journey === 'NA_LICU_MJESTA'), tone: 'accent' },
  ];

  return (
    <section className="response-bar" aria-labelledby="response-bar-title" data-testid="response-bar">
      <h3 className="response-bar__title" id="response-bar-title">{t.responseBar.title}</h3>
      <ul className="response-bar__list">
        {cells.map((cell) => (
          <li
            key={cell.key}
            className={`response-cell ${cell.tone ? `response-cell--${cell.tone}` : ''}`}
            data-testid={`response-${cell.key}`}
          >
            <span className="response-cell__num">{cell.value}</span>
            <span className="response-cell__label">{cell.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: the live picture, with every fact in its own column.
// ---------------------------------------------------------------------------

function OverviewTab({
  data,
  selected,
}: {
  data: ConsoleData;
  selected: Intervention | null;
}) {
  const t = useText();
  if (!selected) {
    return (
      <EmptyState title={t.command.pickInterventionTitle}>
        {t.command.overviewNeedsOne}
      </EmptyState>
    );
  }
  if (selected.status === 'DRAFT') {
    return (
      <EmptyState title={t.command.draftNotPublishedTitle}>
        {t.command.draftNotPublishedText}
      </EmptyState>
    );
  }

  const attendanceBy = new Map<string, AttendanceInterval[]>();
  for (const interval of data.attendance) {
    const list = attendanceBy.get(interval.memberId) ?? [];
    list.push(interval);
    attendanceBy.set(interval.memberId, list);
  }

  const audit = data.audit ?? [];
  const mine = data.movements.filter((m) => m.interventionId === selected.id);
  const summary = summarise(selected, data.recipients, data.attendance, mine, audit);
  const timings = data.recipients.map((r) =>
    recipientTimings(selected, r, data.attendance, audit),
  );

  // Still on the task RIGHT NOW: checked in and not yet checked out, and
  // vehicles not yet back. These two are the only counts on this screen that
  // describe the present moment rather than the record, which is why they are
  // not in the summary below - the archive would have nothing to say about
  // them six months later.
  const onTask = data.attendance.filter((a) => a.endedAt === null && a.rejectedAt === null).length;
  const vehiclesOut = mine.filter((m) => m.returnedAt === null).length;

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">{t.command.nowOnScene}</h2>
        <p className="muted small">{t.command.nowOnSceneNote}</p>
        <div className="totals" data-testid="overview-totals">
          <Count label={t.command.countOnTask} value={onTask} testId="count-present" />
          <Count label={t.command.countVehiclesOut} value={vehiclesOut} testId="count-vehicles" />
        </div>
        {data.audit === null ? (
          /* Said plainly rather than shown as a screen full of "Nije
             zabiljezeno", which would read as "nobody did anything". */
          <Notice tone="info">{t.command.auditMissing}</Notice>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel__title">{t.command.whoIsWhere}</h2>
        <ScrollRegion label={t.command.whoIsWhereLabel} className="table-wrap table-wrap--cards">
          {/* Five facts per member is exactly the table a telephone cannot show
              side by side. Below 640px each row becomes a card - see
              `.table--cards` - rather than collapsing any of them into one
              status, which is the thing this screen exists not to do. */}
          <table className="table table--cards" data-testid="overview-table">
            <thead>
              <tr>
                <th scope="col">{t.timings.colMember}</th>
                <th scope="col">{t.command.colOpened}</th>
                <th scope="col">{t.timings.colAnswer}</th>
                <th scope="col">{t.timings.colMovement}</th>
                <th scope="col">{t.timings.colAttendance}</th>
              </tr>
            </thead>
            <tbody>
              {data.recipients.map((r) => {
                const intervals = attendanceBy.get(r.memberId) ?? [];
                const open = intervals.find((i) => i.endedAt === null && i.rejectedAt === null);
                const confirmed = intervals.filter((i) => attendanceState(i) === 'CONFIRMED');
                return (
                  <tr key={r.memberId}>
                    <th scope="row">{r.memberName}</th>
                    <td data-label={t.command.colOpened}>
                      {r.acknowledgedAt ? (
                        <Chip tone="yes" symbol="+">{t.command.chipOpened}</Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">{t.command.chipNotOpened}</Chip>
                      )}
                    </td>
                    <td data-label={t.timings.colAnswer}>
                      {r.answer ? (
                        <Chip
                          tone={
                            r.answer === 'DOLAZIM'
                              ? 'yes'
                              : r.answer === 'DOLAZIM_KASNIJE'
                                ? 'later'
                                : 'no'
                          }
                          symbol={SERVER_ANSWER_SYMBOL[r.answer] ?? '?'}
                        >
                          {t.vocabulary.answer[r.answer] ?? r.answer}
                          {r.etaMinutes ? ` (${r.etaMinutes} ${t.timings.minutesShort})` : ''}
                        </Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">{t.vocabulary.noAnswer}</Chip>
                      )}
                    </td>
                    <td data-label={t.timings.colMovement}>
                      {r.journey ? (
                        <Chip
                          tone={r.journey === 'ODUSTAJEM' ? 'no' : 'accent'}
                          symbol={JOURNEY_SYMBOL[r.journey] ?? '?'}
                        >
                          {t.vocabulary.journey[r.journey] ?? r.journey}
                        </Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">{t.command.chipNoMovement}</Chip>
                      )}
                    </td>
                    <td data-label={t.timings.colAttendance}>
                      {open ? (
                        <Chip tone="alert" symbol="*">{t.command.chipCheckedIn}</Chip>
                      ) : confirmed.length > 0 ? (
                        <Chip tone="yes" symbol="+">
                          {t.command.chipConfirmed}{' '}
                          {formatDurationMs(
                            confirmed.reduce((sum, i) => sum + participationMs(i), 0),
                          )}
                        </Chip>
                      ) : intervals.length > 0 ? (
                        <Chip tone="later" symbol="~">{t.command.chipAwaiting}</Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">{t.command.chipNoRecord}</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      {/*
        The timings, which the board above deliberately does not carry.

        The chips answer "where is everybody" in one glance, which is what a
        commander needs while the call-out is running. They cannot answer "how
        long did this take", and an independent review found exactly that gap:
        five states per member and not one duration. The two live together
        rather than one replacing the other, because they answer different
        questions at different moments.

        Identical component and identical numbers in the archive - see
        `src/ui/components/timings.tsx`.
      */}
      <section className="panel">
        <h2 className="panel__title">{t.archive.timingsTitle}</h2>
        <p className="muted small">{t.command.timingsNote}</p>
        <ResponseTimings timings={timings} />
      </section>

      <OperationalSummary summary={summary} />
    </div>
  );
}

function Count({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="total total--unknown">
      <div className="total__num" data-testid={testId}>
        {value}
      </div>
      <div className="total__label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: the attendance board.
// ---------------------------------------------------------------------------

function AttendanceTab({
  data,
  selected,
  onDone,
  context,
}: {
  data: ConsoleData;
  selected: Intervention | null;
  onDone: (outcome: { ok: boolean; message?: string }, text: string) => Promise<void>;
  context: OperationalContext;
}) {
  const t = useText();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reasonFor, setReasonFor] = useState<
    null | { id: string; action: 'REJECT' | 'UNCONFIRM' | 'CORRECT' }
  >(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!selected) {
    return (
      <EmptyState title={t.command.pickInterventionTitle}>
        {t.command.attendanceNeedsOne}
      </EmptyState>
    );
  }

  const pending = data.attendance.filter((a) => attendanceState(a) === 'PENDING');
  const confirmed = data.attendance.filter((a) => attendanceState(a) === 'CONFIRMED');
  const rejected = data.attendance.filter((a) => attendanceState(a) === 'REJECTED');
  const open = data.attendance.filter((a) => a.endedAt === null && a.rejectedAt === null);
  const officialSeconds = confirmed.reduce((sum, i) => sum + participationMs(i), 0);

  const confirmPicked = async () => {
    setBusy(true);
    const result = await confirmAttendanceMany([...picked], null);
    if (!result.ok) {
      await onDone({ ok: false, message: result.message }, '');
    } else {
      const failures = result.value.filter((r) => r.outcome !== 'CONFIRMED');
      await onDone(
        { ok: true },
        failures.length === 0
          ? `${t.command.confirmedMany}: ${result.value.length}.`
          : `${t.command.confirmedSome} ${result.value.length - failures.length}, ${
              t.command.notConfirmedSome
            } ${failures.length}.`,
      );
      setPicked(new Set());
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">{t.command.officialTitle}</h2>
        <p className="big-number" data-testid="official-total">
          {formatDurationMs(officialSeconds)}
        </p>
        <p className="muted small">{t.command.officialNote}</p>
        {open.length > 0 ? (
          <Notice tone="warn">
            {t.command.openRecordsPrefix} <strong>{open.length}</strong>{' '}
            {t.command.openRecordsSuffix}
          </Notice>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel__title">
          {t.command.pendingTitle} ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState title={t.command.pendingEmpty} />
        ) : (
          <>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="pick-all-pending"
                onClick={() =>
                  setPicked(
                    picked.size === pending.length ? new Set() : new Set(pending.map((p) => p.id)),
                  )
                }
              >
                {picked.size === pending.length ? t.command.pickNone : t.command.pickAll}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="confirm-many"
                disabled={busy || picked.size === 0}
                onClick={() => void confirmPicked()}
              >
                {t.command.confirmPicked} ({picked.size})
              </button>
            </div>
            <p className="muted small">{t.command.confirmNoteRule}</p>
            <ul className="stack" data-testid="pending-list">
              {pending.map((interval) => (
                <li key={interval.id} className="card">
                  <label className="pick">
                    <input
                      type="checkbox"
                      checked={picked.has(interval.id)}
                      onChange={(event) => {
                        const next = new Set(picked);
                        if (event.target.checked) next.add(interval.id);
                        else next.delete(interval.id);
                        setPicked(next);
                      }}
                    />
                    <span>
                      <strong>{interval.memberName}</strong>{' '}
                      <Chip tone={interval.source === 'SELF_DECLARED' ? 'later' : 'accent'} symbol="~">
                        {t.vocabulary.attendanceSource[interval.source] ?? interval.source}
                      </Chip>
                    </span>
                  </label>
                  <p className="muted small">
                    {formatTime(interval.startedAt)} -{' '}
                    {interval.endedAt ? formatTime(interval.endedAt) : t.command.stillCheckedIn}
                  </p>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      data-testid={`confirm-${interval.id}`}
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          await onDone(
                            await confirmAttendance(interval.id, null),
                            t.command.confirmedOneMessage,
                          );
                          setBusy(false);
                        })()
                      }
                    >
                      {t.command.confirmOne}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      data-testid={`reject-${interval.id}`}
                      disabled={busy}
                      onClick={() => {
                        setReasonFor({ id: interval.id, action: 'REJECT' });
                        setReason('');
                      }}
                    >
                      {t.command.reject}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy}
                      onClick={() => {
                        setReasonFor({ id: interval.id, action: 'CORRECT' });
                        setReason('');
                      }}
                    >
                      {t.command.correctTime}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">
          {t.command.confirmedTitle} ({confirmed.length})
        </h2>
        {confirmed.length === 0 ? (
          <EmptyState title={t.command.confirmedEmpty} />
        ) : (
          <ul className="stack" data-testid="confirmed-list">
            {confirmed.map((interval) => (
              <li key={interval.id} className="card">
                <p>
                  <strong>{interval.memberName}</strong>{' '}
                  <Chip tone="yes" symbol={ATTENDANCE_STATE_SYMBOL.CONFIRMED ?? '+'}>
                    {t.vocabulary.attendanceState.CONFIRMED ?? t.command.chipConfirmed}
                  </Chip>{' '}
                  {formatDurationMs(participationMs(interval))}
                </p>
                <button
                  type="button"
                  className="btn btn--ghost"
                  data-testid={`unconfirm-${interval.id}`}
                  disabled={busy}
                  onClick={() => {
                    setReasonFor({ id: interval.id, action: 'UNCONFIRM' });
                    setReason('');
                  }}
                >
                  {t.command.unconfirm}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 ? (
        <section className="panel">
          <h2 className="panel__title">
            {t.command.rejectedTitle} ({rejected.length})
          </h2>
          <p className="muted small">{t.command.rejectedNote}</p>
          <ul className="stack" data-testid="rejected-list">
            {rejected.map((interval) => (
              <li key={interval.id} className="card">
                <p>
                  <strong>{interval.memberName}</strong>{' '}
                  <Chip tone="no" symbol={ATTENDANCE_STATE_SYMBOL.REJECTED ?? '-'}>
                    {t.vocabulary.attendanceState.REJECTED ?? t.command.rejectedTitle}
                  </Chip>
                </p>
                <p className="muted small">
                  {t.command.reasonLabel}: {interval.rejectionReason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="panel__title">{t.command.recordForMemberTitle}</h2>
        <p className="muted small">{t.command.recordForMemberNote}</p>
        <div className="row-actions">
          {data.recipients.slice(0, 40).map((r) => {
            const openFor = data.attendance.find(
              (a) => a.memberId === r.memberId && a.endedAt === null && a.rejectedAt === null,
            );
            return (
              <button
                key={r.memberId}
                type="button"
                className="btn btn--ghost"
                data-testid={`toggle-presence-${r.memberId}`}
                disabled={busy || !isOpenStatus(selected.status)}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    if (openFor) {
                      await onDone(
                        await checkOut(selected.id, r.memberId),
                        `${r.memberName}: ${t.command.checkOutRecorded}`,
                      );
                    } else {
                      const result = await checkIn(selected.id, r.memberId);
                      await onDone(
                        result.ok ? { ok: true } : { ok: false, message: result.message },
                        `${r.memberName}: ${t.command.checkInRecorded}`,
                      );
                    }
                    setBusy(false);
                  })()
                }
              >
                {openFor
                  ? `${t.command.checkOutMember} ${r.memberName}`
                  : `${t.command.checkInMember} ${r.memberName}`}
              </button>
            );
          })}
        </div>
      </section>

      {reasonFor ? (
        <ConfirmDialog
          open
          title={
            reasonFor.action === 'REJECT'
              ? t.command.confirmRejectTitle
              : reasonFor.action === 'UNCONFIRM'
                ? t.command.confirmUnconfirmTitle
                : t.command.confirmCorrectTitle
          }
          confirmLabel={t.common.save}
          confirmDisabled={reason.trim().length < 2}
          onCancel={() => {
            setReasonFor(null);
            setReason('');
          }}
          onConfirm={() =>
            void (async () => {
              setBusy(true);
              const { id, action } = reasonFor;
              const text = reason.trim();
              const outcome =
                action === 'REJECT'
                  ? await rejectAttendance(id, text)
                  : action === 'UNCONFIRM'
                    ? await unconfirmAttendance(id, text)
                    : await correctAttendance(id, null, null, text);
              await onDone(
                outcome,
                action === 'REJECT'
                  ? t.command.rejectedMessage
                  : action === 'UNCONFIRM'
                    ? t.command.unconfirmedMessage
                    : t.command.correctedMessage,
              );
              setReasonFor(null);
              setReason('');
              setBusy(false);
            })()
          }
        >
          <Field
            label={t.command.fieldReason}
            required
            hint={t.command.reasonPermanentHint}
            controlId="attendance-reason"
          >
            {(props) => (
              <input
                {...props}
                data-testid="attendance-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <p className="muted small">
            {t.command.signedBy}: {context.fullName}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: vehicles.
// ---------------------------------------------------------------------------

function VehiclesTab({
  data,
  selected,
  onDone,
}: {
  data: ConsoleData;
  selected: Intervention | null;
  onDone: (outcome: { ok: boolean; message?: string }, text: string) => Promise<void>;
}) {
  const t = useText();
  const [busy, setBusy] = useState(false);
  const openBy = new Map(
    data.movements.filter((m) => m.returnedAt === null).map((m) => [m.vehicleId, m] as const),
  );

  return (
    <div className="stack">
      <Notice tone="info">{t.command.vehiclesNote}</Notice>

      {data.vehicles.length === 0 ? (
        <EmptyState title={t.command.vehiclesEmptyTitle}>
          {t.command.vehiclesEmptyText}
        </EmptyState>
      ) : (
        <ul className="stack" data-testid="vehicle-list">
          {data.vehicles.map((vehicle) => {
            const out = openBy.get(vehicle.id);
            return (
              <li key={vehicle.id} className="card">
                <p>
                  <strong>{vehicle.callsign}</strong> - {vehicle.name}{' '}
                  {!vehicle.active ? (
                    <Chip tone="no" symbol="-">{t.command.vehicleOutOfService}</Chip>
                  ) : out ? (
                    <Chip tone="accent" symbol="*">{t.command.vehicleOnScene}</Chip>
                  ) : (
                    <Chip tone="neutral" symbol="=">{t.command.vehicleAtStation}</Chip>
                  )}
                </p>
                {out ? (
                  <p className="muted small">
                    {t.command.vehicleDeparted}: {formatTime(out.departedAt)}
                    {out.purpose ? ` - ${out.purpose}` : ''}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost"
                  data-testid={`vehicle-${vehicle.callsign}`}
                  disabled={busy || !vehicle.active}
                  onClick={() =>
                    void (async () => {
                      setBusy(true);
                      if (out) {
                        await onDone(
                          await recordVehicleReturn(out.id),
                          `${vehicle.callsign}: ${t.command.returnRecorded}`,
                        );
                      } else {
                        const result = await recordVehicleDeparture(
                          vehicle.id,
                          selected && isOpenStatus(selected.status) ? selected.id : null,
                          selected && isOpenStatus(selected.status) ? selected.title : null,
                        );
                        await onDone(
                          result.ok ? { ok: true } : { ok: false, message: result.message },
                          `${vehicle.callsign}: ${t.command.departureRecorded}`,
                        );
                      }
                      setBusy(false);
                    })()
                  }
                >
                  {out ? t.command.recordReturn : t.command.recordDeparture}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
