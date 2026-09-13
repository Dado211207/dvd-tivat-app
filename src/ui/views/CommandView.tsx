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
 * **What this screen never claims.** Publishing creates `QUEUED` outbox rows.
 * There is no transport, so the confirmation says exactly that. Nothing here may
 * ever read as "the members were notified".
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
  fetchInterventions,
  fetchEligibleRecipients,
  fetchRecipientFacts,
  fetchVehicleMovements,
  formatDuration,
  isOpenStatus,
  participationSeconds,
  publishIntervention,
  recordVehicleDeparture,
  recordVehicleReturn,
  rejectAttendance,
  setInterventionStatus,
  unconfirmAttendance,
  INTERVENTION_KINDS,
  SETTABLE_STATUSES,
  type AttendanceInterval,
  type AvailabilityRow,
  type Intervention,
  type InterventionKind,
  type EligibleRecipient,
  type RecipientFacts,
  type VehicleMovement,
} from '@/auth/operations';
import { loadRoster, loadVehicles, type RosterMember, type RosterVehicle } from '@/auth/roster';
import { OperationalGate, type OperationalContext } from '../components/OperationalGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Chip, EmptyState, Field, Notice, ScrollRegion } from '../components/primitives';
import {
  ATTENDANCE_SOURCE_LABEL,
  ATTENDANCE_STATE_LABEL,
  ATTENDANCE_STATE_SYMBOL,
  INTERVENTION_KIND_LABEL,
  INTERVENTION_STATUS_LABEL,
  JOURNEY_LABEL,
  JOURNEY_SYMBOL,
  SERVER_ANSWER_LABEL,
  SERVER_ANSWER_SYMBOL,
} from '@/i18n/labels';

type Tab = 'poziv' | 'pregled' | 'prisustvo' | 'vozila';

const TABS: { id: Tab; label: string }[] = [
  { id: 'poziv', label: 'Poziv' },
  { id: 'pregled', label: 'Pregled' },
  { id: 'prisustvo', label: 'Prisustvo' },
  { id: 'vozila', label: 'Vozila' },
];

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
};

function CommandConsole({ context }: { context: OperationalContext }) {
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

  const refresh = useCallback(
    async (keepId?: string | null) => {
      const ticket = ++generation.current;
      setLoading(true);
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
        const [recipients, attendance] = focusId
          ? await Promise.all([
              fetchRecipientFacts(focusId),
              fetchAttendance(
                focusId,
                new Map(members.map((m) => [m.id, m.fullName] as const)),
              ),
            ])
          : [[], []];
        if (!mounted.current || ticket !== generation.current) return;
        setData({
          interventions, members, eligible, vehicles, availability, movements, recipients, attendance,
        });
        setSelectedId(focusId);
      } catch (error) {
        if (!mounted.current || ticket !== generation.current) return;
        setLoadError(
          error instanceof Error && /permission/i.test(error.message)
            ? 'Server je odbio citanje. Provjerite da li vas nalog jos ima ulogu.'
            : 'Server trenutno nije dostupan. Prikaz nije osvjezen.',
        );
      } finally {
        if (mounted.current && ticket === generation.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const after = async (outcome: { ok: boolean; message?: string }, successText: string) => {
    if (outcome.ok) {
      setMessage({ tone: 'info', text: successText });
      await refresh(selectedId);
    } else {
      setMessage({ tone: 'error', text: outcome.message ?? 'Promjena nije sacuvana.' });
    }
  };

  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="Dijelovi komandnog ekrana">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`tabs__tab ${tab === t.id ? 'tabs__tab--on' : ''}`}
            data-testid={`cmd-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadError ? (
        <Notice tone="error">
          {loadError}{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void refresh(selectedId)}>
            Pokusaj ponovo
          </button>
        </Notice>
      ) : null}
      {message ? (
        <div role="status">
          <Notice tone={message.tone === 'error' ? 'error' : 'info'}>{message.text}</Notice>
        </div>
      ) : null}
      {loading ? <p role="status" className="muted small">Ucitavanje sa servera...</p> : null}

      <InterventionPicker
        interventions={data.interventions}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          void refresh(id);
        }}
      />

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="tabpanel"
      >
        {tab === 'poziv' ? (
          <CallOutTab
            data={data}
            selected={selected}
            onDone={after}
            onRefresh={() => void refresh(selectedId)}
          />
        ) : null}
        {tab === 'pregled' ? <OverviewTab data={data} selected={selected} /> : null}
        {tab === 'prisustvo' ? (
          <AttendanceTab data={data} selected={selected} onDone={after} context={context} />
        ) : null}
        {tab === 'vozila' ? <VehiclesTab data={data} selected={selected} onDone={after} /> : null}
      </div>
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
  if (interventions.length === 0) return null;
  return (
    <Field label="Intervencija" controlId="intervention-picker">
      {(props) => (
        <select
          {...props}
          data-testid="intervention-picker"
          value={selectedId ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {interventions.map((i) => (
            <option key={i.id} value={i.id}>
              {INTERVENTION_STATUS_LABEL[i.status] ?? i.status} - {i.title}
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
      await onDone({ ok: true }, 'Priprema poziva je sacuvana kao nacrt. Jos nije objavljena.');
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
      await onDone(
        result.ok ? { ok: true } : { ok: false, message: result.message },
        'Poziv je objavljen. Obavjestenja su STAVLJENA U RED - kanal za slanje jos ne postoji, pa niko nije stvarno obavijesten.',
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
        status === 'CLOSED' ? 'Intervencija je zatvorena.' : 'Intervencija je otkazana.',
      );
      setCloseReason('');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const isDraft = selected?.status === 'DRAFT';
  const openIntervals = data.attendance.filter((a) => a.endedAt === null).length;

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">Nova priprema poziva</h2>
        <p className="muted small">
          Nacrt vidi samo komanda. Niko nije pozvan dok ne pritisnete <strong>Objavi</strong>.
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Field label="Vrsta" required controlId="new-kind">
          {(props) => (
            <select
              {...props}
              data-testid="new-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as InterventionKind)}
            >
              {INTERVENTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INTERVENTION_KIND_LABEL[k] ?? k}
                </option>
              ))}
            </select>
          )}
        </Field>

        {kind === 'DRUGO' ? (
          <Field label="Kratak opis vrste" required controlId="new-other">
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

        <Field label="Naslov" required hint="Kratko, da se vidi na zakljucanom ekranu." controlId="new-title">
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
          label="Lokacija"
          required
          hint="Upisana adresa ili opis mjesta. Sama koordinata nije dovoljna u tri ujutru."
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

        <Field label="Mjesto okupljanja" controlId="new-assembly">
          {(props) => (
            <input
              {...props}
              data-testid="new-assembly"
              value={assembly}
              onChange={(e) => setAssembly(e.target.value)}
            />
          )}
        </Field>

        <Field label="Uputstvo ekipi" required controlId="new-instructions">
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
          {busy ? 'Cuvanje...' : 'Sacuvaj nacrt'}
        </button>
      </section>

      {selected ? (
        <section className="panel">
          <h2 className="panel__title">
            {selected.title}{' '}
            <Chip tone={isOpenStatus(selected.status) ? 'alert' : 'neutral'} symbol="#">
              {INTERVENTION_STATUS_LABEL[selected.status] ?? selected.status}
            </Chip>
          </h2>
          <dl className="facts">
            <dt>Vrsta</dt>
            <dd>
              {INTERVENTION_KIND_LABEL[selected.kind] ?? selected.kind}
              {selected.otherKindNote ? ` - ${selected.otherKindNote}` : ''}
            </dd>
            <dt>Lokacija</dt>
            <dd data-testid="selected-location">{selected.incidentLocation}</dd>
            <dt>Mjesto okupljanja</dt>
            <dd>{selected.assemblyPoint ?? 'Nije navedeno'}</dd>
            <dt>Uputstvo</dt>
            <dd>{selected.instructions}</dd>
          </dl>

          {isDraft ? (
            <>
              <h3>Kome se salje</h3>
              <p className="muted small">
                Spisak daje server: prikazani su samo clanovi koji zaista mogu da prime i otvore
                poziv - aktivan clan, aktivan nalog i popunjen profil. Clan kome je nalog ukinut se
                ne prikazuje i ne moze biti pozvan. Oznaka dostupnosti je opsta izjava clana, a ne
                odgovor na ovaj poziv.
              </p>
              {/*
                An empty picker with no explanation reads as a screen that has
                not finished loading. It has two entirely different causes and a
                commander must not have to guess which one they are looking at.
              */}
              {eligibleUnavailable ? (
                <Notice tone="error" testId="eligible-recipients-unavailable">
                  <strong>Spisak clanova nije procitan sa servera.</strong> Ovo nije podatak da
                  nema clanova - znaci da odgovor nije stigao. Osvjezite prikaz prije nego sto
                  objavite poziv.
                </Notice>
              ) : eligible.length === 0 ? (
                <Notice tone="warn" testId="no-eligible-recipients">
                  <strong>Nijedan clan trenutno ne moze da primi poziv.</strong> Poziv se moze
                  poslati samo clanu sa aktivnim nalogom i popunjenim profilom. Clan kome je nalog
                  ukinut se ovdje ne prikazuje.
                </Notice>
              ) : null}
              <ScrollRegion label="Spisak clanova za poziv" className="table-wrap table-wrap--tall">
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
                              {availability.available ? 'Dostupan' : 'Nije dostupan'}
                            </Chip>
                          ) : (
                            <Chip tone="unknown" symbol="?">
                              Nije izjasnjen
                            </Chip>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </ScrollRegion>
              <p className="muted small" data-testid="selected-recipient-count">
                Izabrano: {selectedMembers.size}
              </p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="publish"
                  disabled={busy || selectedMembers.size === 0}
                  onClick={() => setConfirming('PUBLISH')}
                >
                  Objavi poziv
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  data-testid="discard-draft"
                  disabled={busy}
                  onClick={() => setConfirming('CANCEL')}
                >
                  Odbaci nacrt
                </button>
              </div>
            </>
          ) : null}

          {isOpenStatus(selected.status) ? (
            <>
              <h3>Stanje intervencije</h3>
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
                        await onDone(result, `Stanje je promijenjeno u: ${INTERVENTION_STATUS_LABEL[status] ?? status}.`);
                        setBusy(false);
                      })()
                    }
                  >
                    {INTERVENTION_STATUS_LABEL[status] ?? status}
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
                  Zatvori intervenciju
                </button>
              </div>
            </>
          ) : null}

          {selected.closeReason ? (
            <p className="muted small">
              Zatvoreno: <strong>{selected.closeReason}</strong>
            </p>
          ) : null}
        </section>
      ) : (
        <EmptyState title="Nema nijedne intervencije">
          Napravite prvi nacrt gore. Dok ne objavite, niko ga ne vidi.
        </EmptyState>
      )}

      {confirming === 'PUBLISH' ? (
        <ConfirmDialog
          open
          title="Objaviti poziv?"
          confirmLabel="Objavi"
          onCancel={() => setConfirming(null)}
          onConfirm={() => void publish()}
        >
          <p>
            Poziv ide na <strong>{selectedMembers.size}</strong> clanova. Spisak se zamrzava u
            trenutku objave.
          </p>
          <p className="muted small">
            Obavjestenja se upisuju u red cekanja. Kanal za slanje jos ne postoji, pa{' '}
            <strong>niko nece biti stvarno obavijesten</strong> - ni porukom, ni pozivom.
          </p>
        </ConfirmDialog>
      ) : null}

      {confirming === 'CANCEL' || confirming === 'CLOSE' ? (
        <ConfirmDialog
          open
          title={confirming === 'CLOSE' ? 'Zatvoriti intervenciju?' : 'Odbaciti nacrt?'}
          confirmLabel={confirming === 'CLOSE' ? 'Zatvori' : 'Odbaci'}
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
                  await onDone(result, 'Nacrt je odbacen i ostaje zabiljezen kao otkazan.');
                  setCloseReason('');
                  setBusy(false);
                  setConfirming(null);
                })())
          }
        >
          <Field label="Razlog" required hint="Ostaje trajno na zapisu." controlId="close-reason">
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
              Jos <strong>{openIntervals}</strong> clanova je prijavljeno i nije se odjavilo. Ostaju
              otvoreni na zapisu - vrijeme im se nece izmisliti.
            </Notice>
          ) : null}
        </ConfirmDialog>
      ) : null}

      <p className="muted small">
        <button type="button" className="btn btn--ghost" onClick={onRefresh}>
          Osvjezi sa servera
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
  if (!selected) {
    return <EmptyState title="Izaberite intervenciju">Pregled prikazuje stanje jedne intervencije.</EmptyState>;
  }
  if (selected.status === 'DRAFT') {
    return (
      <EmptyState title="Nacrt jos nije objavljen">
        Niko nije pozvan, pa nema odziva za prikaz.
      </EmptyState>
    );
  }

  const attendanceBy = new Map<string, AttendanceInterval[]>();
  for (const interval of data.attendance) {
    const list = attendanceBy.get(interval.memberId) ?? [];
    list.push(interval);
    attendanceBy.set(interval.memberId, list);
  }

  const opened = data.recipients.filter((r) => r.acknowledgedAt !== null).length;
  const answered = data.recipients.filter((r) => r.answer !== null).length;
  const coming = data.recipients.filter(
    (r) => r.answer === 'DOLAZIM' || r.answer === 'DOLAZIM_KASNIJE',
  ).length;
  const onScene = data.recipients.filter((r) => r.journey === 'NA_LICU_MJESTA').length;
  // Still on the task right now: checked in and not yet checked out. NOT the
  // number of people who have reported attendance - a closed interval counts
  // towards the record and not towards who is standing on the ground.
  const onTask = data.attendance.filter((a) => a.endedAt === null && a.rejectedAt === null).length;
  const reported = new Set(
    data.attendance.filter((a) => a.rejectedAt === null).map((a) => a.memberId),
  ).size;
  const vehiclesOut = data.movements.filter(
    (m) => m.returnedAt === null && m.interventionId === selected.id,
  ).length;

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">Brojke</h2>
        <p className="muted small">
          Svaka brojka je svoja cinjenica. Ko je otvorio poziv nije ko je odgovorio, a ko je
          odgovorio nije ko je prisutan.
        </p>
        <div className="totals" data-testid="overview-totals">
          <Count label="Pozvano" value={data.recipients.length} testId="count-recipients" />
          <Count label="Otvorilo" value={opened} testId="count-opened" />
          <Count label="Odgovorilo" value={answered} testId="count-answered" />
          <Count label="Dolazi" value={coming} testId="count-coming" />
          <Count label="Na licu mjesta (izjava)" value={onScene} testId="count-onscene" />
          <Count label="Trenutno na zadatku" value={onTask} testId="count-present" />
          <Count label="Prijavilo prisustvo" value={reported} testId="count-reported" />
          <Count label="Vozila na terenu" value={vehiclesOut} testId="count-vehicles" />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Ko je gdje</h2>
        <ScrollRegion label="Pregled odziva po clanu" className="table-wrap table-wrap--cards">
          {/* Five facts per member is exactly the table a telephone cannot show
              side by side. Below 640px each row becomes a card - see
              `.table--cards` - rather than collapsing any of them into one
              status, which is the thing this screen exists not to do. */}
          <table className="table table--cards" data-testid="overview-table">
            <thead>
              <tr>
                <th scope="col">Clan</th>
                <th scope="col">Otvorio</th>
                <th scope="col">Odgovor</th>
                <th scope="col">Kretanje</th>
                <th scope="col">Prisustvo</th>
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
                    <td data-label="Otvorio">
                      {r.acknowledgedAt ? (
                        <Chip tone="yes" symbol="+">Otvorio</Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">Nije otvorio</Chip>
                      )}
                    </td>
                    <td data-label="Odgovor">
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
                          {SERVER_ANSWER_LABEL[r.answer] ?? r.answer}
                          {r.etaMinutes ? ` (${r.etaMinutes} min)` : ''}
                        </Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">Bez odgovora</Chip>
                      )}
                    </td>
                    <td data-label="Kretanje">
                      {r.journey ? (
                        <Chip
                          tone={r.journey === 'ODUSTAJEM' ? 'no' : 'accent'}
                          symbol={JOURNEY_SYMBOL[r.journey] ?? '?'}
                        >
                          {JOURNEY_LABEL[r.journey] ?? r.journey}
                        </Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">Nije javio</Chip>
                      )}
                    </td>
                    <td data-label="Prisustvo">
                      {open ? (
                        <Chip tone="alert" symbol="*">Prijavljen</Chip>
                      ) : confirmed.length > 0 ? (
                        <Chip tone="yes" symbol="+">
                          Potvrdjeno {formatDuration(
                            confirmed.reduce((sum, i) => sum + participationSeconds(i), 0),
                          )}
                        </Chip>
                      ) : intervals.length > 0 ? (
                        <Chip tone="later" symbol="~">Ceka potvrdu</Chip>
                      ) : (
                        <Chip tone="unknown" symbol="?">Nema zapisa</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
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
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reasonFor, setReasonFor] = useState<
    null | { id: string; action: 'REJECT' | 'UNCONFIRM' | 'CORRECT' }
  >(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!selected) {
    return <EmptyState title="Izaberite intervenciju">Prisustvo se vodi po intervenciji.</EmptyState>;
  }

  const pending = data.attendance.filter((a) => attendanceState(a) === 'PENDING');
  const confirmed = data.attendance.filter((a) => attendanceState(a) === 'CONFIRMED');
  const rejected = data.attendance.filter((a) => attendanceState(a) === 'REJECTED');
  const open = data.attendance.filter((a) => a.endedAt === null && a.rejectedAt === null);
  const officialSeconds = confirmed.reduce((sum, i) => sum + participationSeconds(i), 0);

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
          ? `Potvrdjeno zapisa: ${result.value.length}.`
          : `Potvrdjeno ${result.value.length - failures.length}, nije potvrdjeno ${failures.length}.`,
      );
      setPicked(new Set());
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">Zvanicno vrijeme ucesca</h2>
        <p className="big-number" data-testid="official-total">
          {formatDuration(officialSeconds)}
        </p>
        <p className="muted small">
          Racuna se <strong>samo potvrdjeno i zatvoreno</strong> prisustvo. Zapis koji ceka potvrdu
          ili je odbijen ne ulazi u ovu brojku - ni djelimicno.
        </p>
        {open.length > 0 ? (
          <Notice tone="warn">
            Jos <strong>{open.length}</strong> zapisa je otvoreno. Otvoren zapis nema trajanje dok se
            clan ne odjavi, pa se ne racuna.
          </Notice>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel__title">Ceka potvrdu ({pending.length})</h2>
        {pending.length === 0 ? (
          <EmptyState title="Nema zapisa koji cekaju" />
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
                {picked.size === pending.length ? 'Ponisti izbor' : 'Izaberi sve'}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="confirm-many"
                disabled={busy || picked.size === 0}
                onClick={() => void confirmPicked()}
              >
                Potvrdi izabrano ({picked.size})
              </button>
            </div>
            <p className="muted small">
              Potvrda <strong>ne trazi napomenu</strong>: trideset istih recenica ne bi bile zapis
              nego smece. Odbijanje i povlacenje potvrde trazе razlog, jer mijenjaju ono sto je clan
              rekao o sebi.
            </p>
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
                        {ATTENDANCE_SOURCE_LABEL[interval.source] ?? interval.source}
                      </Chip>
                    </span>
                  </label>
                  <p className="muted small">
                    {new Date(interval.startedAt).toLocaleString('sr-Latn')} -{' '}
                    {interval.endedAt
                      ? new Date(interval.endedAt).toLocaleString('sr-Latn')
                      : 'jos je prijavljen'}
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
                            'Prisustvo je potvrdjeno.',
                          );
                          setBusy(false);
                        })()
                      }
                    >
                      Potvrdi
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
                      Odbij
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
                      Ispravi vrijeme
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Potvrdjeno ({confirmed.length})</h2>
        {confirmed.length === 0 ? (
          <EmptyState title="Jos nista nije potvrdjeno" />
        ) : (
          <ul className="stack" data-testid="confirmed-list">
            {confirmed.map((interval) => (
              <li key={interval.id} className="card">
                <p>
                  <strong>{interval.memberName}</strong>{' '}
                  <Chip tone="yes" symbol={ATTENDANCE_STATE_SYMBOL.CONFIRMED ?? '+'}>
                    {ATTENDANCE_STATE_LABEL.CONFIRMED ?? 'Potvrdjeno'}
                  </Chip>{' '}
                  {formatDuration(participationSeconds(interval))}
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
                  Povuci potvrdu
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 ? (
        <section className="panel">
          <h2 className="panel__title">Odbijeno ({rejected.length})</h2>
          <p className="muted small">
            Odbijen zapis ostaje na evidenciji sa razlogom. Ne brise se - brisanje bi sakrilo da je
            neko tvrdio da je bio tu.
          </p>
          <ul className="stack" data-testid="rejected-list">
            {rejected.map((interval) => (
              <li key={interval.id} className="card">
                <p>
                  <strong>{interval.memberName}</strong>{' '}
                  <Chip tone="no" symbol={ATTENDANCE_STATE_SYMBOL.REJECTED ?? '-'}>
                    {ATTENDANCE_STATE_LABEL.REJECTED ?? 'Odbijeno'}
                  </Chip>
                </p>
                <p className="muted small">Razlog: {interval.rejectionReason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="panel__title">Upisi prisustvo za clana</h2>
        <p className="muted small">
          Zapis koji komanda upise nosi oznaku <strong>Upisala komanda</strong> i i dalje ceka
          potvrdu. "Zapisao sam" i "stojim iza toga" nisu ista tvrdnja.
        </p>
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
                        `${r.memberName}: odjava je zabiljezena.`,
                      );
                    } else {
                      const result = await checkIn(selected.id, r.memberId);
                      await onDone(
                        result.ok ? { ok: true } : { ok: false, message: result.message },
                        `${r.memberName}: prijava je zabiljezena i ceka potvrdu.`,
                      );
                    }
                    setBusy(false);
                  })()
                }
              >
                {openFor ? `Odjavi ${r.memberName}` : `Prijavi ${r.memberName}`}
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
              ? 'Odbiti zapis prisustva?'
              : reasonFor.action === 'UNCONFIRM'
                ? 'Povuci potvrdu?'
                : 'Ispraviti vrijeme?'
          }
          confirmLabel="Sacuvaj"
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
                  ? 'Zapis je odbijen i ostaje vidljiv sa razlogom.'
                  : action === 'UNCONFIRM'
                    ? 'Potvrda je povucena. Zapis je ponovo u cekanju.'
                    : 'Ispravka je zabiljezena sa razlogom.',
              );
              setReasonFor(null);
              setReason('');
              setBusy(false);
            })()
          }
        >
          <Field label="Razlog" required hint="Trajno ostaje uz zapis, sa vasim imenom i vremenom." controlId="attendance-reason">
            {(props) => (
              <input
                {...props}
                data-testid="attendance-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <p className="muted small">Odluku potpisuje: {context.fullName}</p>
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
  const [busy, setBusy] = useState(false);
  const openBy = new Map(
    data.movements.filter((m) => m.returnedAt === null).map((m) => [m.vehicleId, m] as const),
  );

  return (
    <div className="stack">
      <Notice tone="info">
        Izlazak vozila je svoja cinjenica. Ne prijavljuje nicije prisustvo i ne mijenja nicij
        odgovor.
      </Notice>

      {data.vehicles.length === 0 ? (
        <EmptyState title="Nema unesenih vozila">
          Vozila se unose na ekranu Evidencija drustva.
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
                    <Chip tone="no" symbol="-">Van upotrebe</Chip>
                  ) : out ? (
                    <Chip tone="accent" symbol="*">Na terenu</Chip>
                  ) : (
                    <Chip tone="neutral" symbol="=">U bazi</Chip>
                  )}
                </p>
                {out ? (
                  <p className="muted small">
                    Izaslo: {new Date(out.departedAt).toLocaleString('sr-Latn')}
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
                          `${vehicle.callsign}: povratak je zabiljezen.`,
                        );
                      } else {
                        const result = await recordVehicleDeparture(
                          vehicle.id,
                          selected && isOpenStatus(selected.status) ? selected.id : null,
                          selected && isOpenStatus(selected.status) ? selected.title : null,
                        );
                        await onDone(
                          result.ok ? { ok: true } : { ok: false, message: result.message },
                          `${vehicle.callsign}: izlazak je zabiljezen.`,
                        );
                      }
                      setBusy(false);
                    })()
                  }
                >
                  {out ? 'Zabiljezi povratak' : 'Zabiljezi izlazak'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
