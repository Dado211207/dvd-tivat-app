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
  type RecipientFacts,
  type VehicleMovement,
} from '@/auth/operations';
import { LIVE_STATUS_LABEL, useLiveOperations } from '@/auth/live';
import { requestPushDelivery } from '@/notifications/push';
import { formatDurationMs } from '@/auth/duration';
import { recipientTimings, summarise } from '@/auth/metrics';
import { OperationalSummary, ResponseTimings } from '../components/timings';
import { loadRoster, loadVehicles, type RosterMember, type RosterVehicle } from '@/auth/roster';
import { OperationalGate, type OperationalContext } from '../components/OperationalGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
      try {
        const [interventions, members, eligible, vehicles, availability, movements] =
          await Promise.all([
            fetchInterventions(),
            loadRoster(),
            fetchEligibleRecipients(),
            loadVehicles(),
            fetchAvailability(),
            fetchVehicleMovements(),
          ]);
        // The newest call-out that is still open is what a commander wants on
        // opening the screen; falling back to the newest of any kind means the
        // screen is never blank when history exists.
        const focusId =
          keepId ??
          interventions.find((i) => isOpenStatus(i.status))?.id ??
          interventions[0]?.id ??
          null;
        const [recipients, attendance, audit] = focusId
          ? await Promise.all([
              fetchRecipientFacts(focusId),
              fetchAttendance(
                focusId,
                new Map(members.map((m) => [m.id, m.fullName] as const)),
              ),
              fetchInterventionAudit(focusId),
            ])
          : [[], [], null];
        if (!mounted.current || ticket !== generation.current) return;
        setData({
          interventions, members, eligible, vehicles, availability, movements, recipients,
          attendance, audit,
        });
        setSelectedId(focusId);
      } catch (error) {
        if (!mounted.current || ticket !== generation.current) return;
        setLoadError(
          error instanceof Error && /permission/i.test(error.message)
            ? 'REFUSED_READ'
            : 'UNAVAILABLE',
        );
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

      {/* Says which of the two it is. "Uzivo" and "every twelve seconds" are
          different promises, and a commander deciding how much to trust what is
          in front of them needs the difference. */}
      <p className="muted small live-state" data-testid="live-state" data-live={liveStatus}>
        <span className={`live-dot live-dot--${liveStatus.toLowerCase()}`} aria-hidden="true" />
        {LIVE_STATUS_LABEL[liveStatus]}
      </p>

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
          hidden={tab !== id}
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
  if (interventions.length === 0) return null;
  return (
    <Field label={t.command.pickIntervention} controlId="intervention-picker">
      {(props) => (
        <select
          {...props}
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
      )}
    </Field>
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
  const [kind, setKind] = useState<InterventionKind>('POZAR');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [location, setLocation] = useState('');
  const [assembly, setAssembly] = useState('');
  const [otherNote, setOtherNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per compose session. A retried tap after a dropped connection must
  // return the SAME draft, never create a second call-out for one incident.
  const idempotencyKey = useRef(`ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<null | 'PUBLISH' | 'CLOSE' | 'CANCEL'>(null);
  const [closeReason, setCloseReason] = useState('');

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
        kind,
        title: title.trim(),
        instructions: instructions.trim(),
        location: location.trim(),
        idempotencyKey: idempotencyKey.current,
        otherKindNote: kind === 'DRUGO' ? otherNote.trim() : null,
        assemblyPoint: assembly.trim() === '' ? null : assembly.trim(),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onDone({ ok: true }, t.command.draftSaved);
      setTitle('');
      setInstructions('');
      setLocation('');
      setAssembly('');
      setOtherNote('');
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

  const composer = (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="muted small">{t.command.newNote}</p>

      <Field label={t.command.fieldKind} required controlId="new-kind">
          {(props) => (
            <select
              {...props}
              data-testid="new-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as InterventionKind)}
            >
              {INTERVENTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.vocabulary.interventionKind[k] ?? k}
                </option>
              ))}
            </select>
          )}
        </Field>

        {kind === 'DRUGO' ? (
          <Field label={t.command.fieldOtherKind} required controlId="new-other">
            {(props) => (
              <input
                {...props}
                data-testid="new-other"
                value={otherNote}
                onChange={(e) => setOtherNote(e.target.value)}
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>

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
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
        </Field>

        <Field label={t.command.fieldAssembly} controlId="new-assembly">
          {(props) => (
            <input
              {...props}
              data-testid="new-assembly"
              value={assembly}
              onChange={(e) => setAssembly(e.target.value)}
            />
          )}
        </Field>

        <Field label={t.command.fieldInstructions} required controlId="new-instructions">
          {(props) => (
            <textarea
              {...props}
              data-testid="new-instructions"
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          )}
        </Field>

        <button
          type="button"
          className="btn btn--primary"
          data-testid="create-draft"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? t.command.saving : t.command.saveDraft}
        </button>
    </>
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
        <section className="panel">
          <h2 className="panel__title">
            {selected.title}{' '}
            <Chip tone={isOpenStatus(selected.status) ? 'alert' : 'neutral'} symbol="#">
              {t.vocabulary.interventionStatus[selected.status] ?? selected.status}
            </Chip>
          </h2>
          <dl className="facts">
            <dt>{t.command.factKind}</dt>
            <dd>
              {t.vocabulary.interventionKind[selected.kind] ?? selected.kind}
              {selected.otherKindNote ? ` - ${selected.otherKindNote}` : ''}
            </dd>
            <dt>{t.command.factLocation}</dt>
            <dd data-testid="selected-location">{selected.incidentLocation}</dd>
            <dt>{t.command.factAssembly}</dt>
            <dd>{selected.assemblyPoint ?? t.command.notStated}</dd>
            <dt>{t.command.factInstructions}</dt>
            <dd>{selected.instructions}</dd>
          </dl>

          {isDraft ? (
            <>
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
                  data-testid="publish"
                  disabled={busy || selectedMembers.size === 0}
                  onClick={() => setConfirming('PUBLISH')}
                >
                  {t.command.publish}
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
