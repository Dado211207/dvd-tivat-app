/**
 * The duty officer's screen. This is what the application opens into.
 *
 * Two states: compose a call when nothing is open, or run the open exercise.
 * The composer never sends directly - "Pregledaj i posalji" opens a preview of
 * the exact message and the exact recipient list, and only the confirmation in
 * that dialog creates anything.
 */

import { useMemo, useState } from 'react';
import { composeMessage, KIND_LABEL } from '@/domain/message';
import { resolveRecipients } from '@/domain/reducer';
import {
  getActiveCall,
  getOpenExercise,
  getRecipientRows,
  getResponseTotals,
  isDeliveryUnattempted,
} from '@/domain/selectors';
import { OPEN_STATUSES, type ExerciseKind, type ExerciseStatus, type Id } from '@/domain/types';
import { ANSWER_LABEL, CITIZEN_REPORT_KIND_LABEL, DELIVERY_LABEL, formatTime, STATUS_LABEL, T } from '@/i18n/labels';
import { makeId, useApp, useStableCommandId } from '@/state/AppStateContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DeliveryNotice } from '../components/DeliveryNotice';
import { MapLink } from '../components/MapLink';
import { StationOverview } from '../components/StationOverview';
import {
  AnswerChip,
  Chip,
  EmptyState,
  Field,
  Notice,
  ScrollRegion,
  StatusChip,
  Total,
} from '../components/primitives';
import { readRouteParam } from '../router';

const KINDS: ExerciseKind[] = ['VJEZBA', 'TEST', 'SIMULIRANA_INTERVENCIJA'];

export function DispatcherView() {
  const { state } = useApp();
  const exercise = getOpenExercise(state);

  return (
    <>
      <h1 className="sr-only">{T.dispatcherTitle}</h1>
      <StationOverview />
      {exercise ? <ActiveExercise /> : <Composer />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer() {
  const { state, run, check, announce } = useApp();

  const reportId = readRouteParam('dojava');
  const sourceReport = state.citizenReports.find(
    (report) => report.id === reportId && report.status === 'PREGLEDANA_U_SIMULACIJI',
  );
  const sourceLocation = sourceReport?.incidentLocation || (sourceReport?.coordinates
    ? `${sourceReport.coordinates.latitude.toFixed(6)}, ${sourceReport.coordinates.longitude.toFixed(6)}`
    : '');

  const [kind, setKind] = useState<ExerciseKind>(sourceReport ? 'SIMULIRANA_INTERVENCIJA' : 'VJEZBA');
  const [title, setTitle] = useState(sourceReport ? `Dojava: ${CITIZEN_REPORT_KIND_LABEL[sourceReport.kind]}` : '');
  const [instructions, setInstructions] = useState(sourceReport?.description ?? '');
  const [incidentLocation, setIncidentLocation] = useState(sourceLocation);
  const [reporterLocation, setReporterLocation] = useState('');
  const [memberIds, setMemberIds] = useState<Id[]>([]);
  const [groupIds, setGroupIds] = useState<Id[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [preview, setPreview] = useState(false);
  /** Reset after a successful send so the next call gets a fresh id. */
  const [formGeneration, setFormGeneration] = useState(0);

  // One id per composed call. Confirming twice - a click and an Enter at the
  // same moment - applies the same command, and the repeat is a no-op.
  const commandId = useStableCommandId(formGeneration);

  const resolved = useMemo(
    () => resolveRecipients(state, memberIds, groupIds),
    [state, memberIds, groupIds],
  );

  const visibleMembers = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase('sr-Latn');
    return state.members.filter(
      (member) => member.active && (query === '' || member.name.toLocaleLowerCase('sr-Latn').includes(query)),
    );
  }, [memberQuery, state.members]);

  const messageText = composeMessage({ kind, title, instructions, incidentLocation, reporterLocation });

  const buildCommand = () =>
    ({
      type: 'CREATE_EXERCISE_AND_CALL',
      commandId,
      kind,
      title,
      instructions,
      incidentLocation,
      reporterLocation,
      memberIds,
      groupIds,
    }) as const;

  const toggle = (list: Id[], setList: (next: Id[]) => void, id: Id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function openPreview() {
    // Validated by the domain, not by a second copy of the rules living here.
    const result = check(buildCommand());
    if (!result.ok) {
      setError({ message: result.error.message, field: result.error.field });
      announce(result.error.message, 'error');
      if (result.error.field) {
        document.getElementById(`f-${result.error.field}`)?.focus();
      }
      return;
    }
    setError(null);
    setPreview(true);
  }

  function confirmSend() {
    const result = run(buildCommand());
    setPreview(false);
    if (!result.ok) {
      setError({ message: result.error.message, field: result.error.field });
      announce(result.error.message, 'error');
      return;
    }
    announce(`Poziv je upucen za ${resolved.length} clanova. Isporuka nije pokusana.`);
    setTitle('');
    setInstructions('');
    setIncidentLocation('');
    setReporterLocation('');
    setMemberIds([]);
    setGroupIds([]);
    setError(null);
    setFormGeneration((n) => n + 1);
  }

  const fieldError = (field: string) =>
    error?.field === field ? error.message : undefined;

  return (
    <div className="grid-2 composer-grid">
      <section className="card workflow-card" aria-labelledby="composer-h">
        <div className="card__head card__head--step">
          <span className="step-number" aria-hidden="true">01</span>
          <div>
            <p className="card__kicker">Detalji poziva</p>
            <h2 id="composer-h">{T.newExercise}</h2>
          </div>
        </div>

        {error && !error.field ? <Notice tone="error">{error.message}</Notice> : null}

        {sourceReport ? (
          <Notice tone="warn">
            Polja su unaprijed popunjena iz lokalno pregledane probne prijave. Provjerite svaki
            detalj i sami izaberite primaoce. Poziv jos nije kreiran niti poslat.
          </Notice>
        ) : reportId ? (
          <Notice tone="error">
            Probna prijava nije pronadjena ili jos nije oznacena kao pregledana. Nista nije kreirano.
          </Notice>
        ) : null}

        {/* No onSubmit: sending happens only from the preview dialog. */}
        <div>
          <Field label={T.fieldKind} required controlId="f-kind">
            {(a) => (
              <select {...a} value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label={T.fieldTitle} required error={fieldError('title')} controlId="f-title">
            {(a) => (
              <input
                {...a}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Kratak opis dogadjaja"
              />
            )}
          </Field>

          <Field
            label={T.fieldInstructions}
            required
            error={fieldError('instructions')}
            controlId="f-instructions"
          >
            {(a) => (
              <textarea
                {...a}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Sta clanovi treba da urade i sta da ponesu"
              />
            )}
          </Field>

          <Field
            label={T.fieldIncidentLocation}
            hint={T.fieldIncidentLocationHint}
            required
            error={fieldError('incidentLocation')}
            controlId="f-incidentLocation"
          >
            {(a) => (
              <input
                {...a}
                type="text"
                value={incidentLocation}
                onChange={(e) => setIncidentLocation(e.target.value)}
                placeholder="Mjesto na koje ekipa izlazi"
              />
            )}
          </Field>

          <Field
            label={T.fieldReporterLocation}
            hint={T.fieldReporterLocationHint}
            controlId="f-reporterLocation"
          >
            {(a) => (
              <input
                {...a}
                type="text"
                value={reporterLocation}
                onChange={(e) => setReporterLocation(e.target.value)}
                placeholder="Odakle je dojava stigla"
              />
            )}
          </Field>
        </div>
      </section>

      <section className="card workflow-card recipients-card" aria-labelledby="recipients-h">
        <div className="card__head card__head--step">
          <span className="step-number" aria-hidden="true">02</span>
          <div>
            <p className="card__kicker">Kome ide poziv</p>
            <h2 id="recipients-h">{T.recipients}</h2>
          </div>
          <p className="selected-count" data-testid="selected-count">
            {T.selectedCount}: <strong>{resolved.length}</strong>
          </p>
        </div>

        {fieldError('recipients') ? <Notice tone="error">{fieldError('recipients')}</Notice> : null}

        <fieldset>
          <legend>{T.recipientsGroups}</legend>
          <div className="check-list">
            {state.groups.map((group) => (
              <label className="check" key={group.id}>
                <input
                  type="checkbox"
                  checked={groupIds.includes(group.id)}
                  onChange={() => toggle(groupIds, setGroupIds, group.id)}
                />
                <span className="check__body check__name">
                  {group.name}
                  <span className="muted small">
                    {' '}
                    ({group.memberIds.length} {T.members})
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{T.recipientsIndividuals}</legend>
          <div className="recipient-search">
            <label htmlFor="member-search">Pretrazi probne clanove</label>
            <input
              id="member-search"
              type="search"
              value={memberQuery}
              placeholder="Ime ili oznaka clana"
              onChange={(event) => setMemberQuery(event.target.value)}
            />
            <p className="small muted" aria-live="polite">
              Prikazano {visibleMembers.length} od {state.members.filter((member) => member.active).length} aktivnih.
            </p>
          </div>
          <div className="check-list check-list--2 recipient-member-list" data-testid="recipient-member-list">
            {visibleMembers.map((member) => {
              const viaGroup = !memberIds.includes(member.id) && resolved.includes(member.id);
              return (
                <label className="check" key={member.id}>
                  <input
                    type="checkbox"
                    checked={memberIds.includes(member.id)}
                    onChange={() => toggle(memberIds, setMemberIds, member.id)}
                  />
                  <span className="check__body check__name">
                    {member.name}
                    {viaGroup ? <span className="muted small"> - vec u izabranoj grupi</span> : null}
                  </span>
                </label>
              );
            })}
            {visibleMembers.length === 0 ? (
              <p className="small muted recipient-search__empty">Nema aktivnog probnog clana za ovu pretragu.</p>
            ) : null}
          </div>
        </fieldset>

        <div className="composer-action">
          <p><strong>{resolved.length}</strong> izabranih primalaca</p>
          <button type="button" className="btn btn--primary" onClick={openPreview}>
            {T.reviewAndSend}
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={preview}
        title={T.previewTitle}
        confirmLabel={T.confirmSend}
        onConfirm={confirmSend}
        onCancel={() => setPreview(false)}
      >
        <div className="stack">
          <DeliveryNotice />
          <div>
            <h3>{T.previewMessage}</h3>
            <p className="pre" data-testid="preview-message">
              {messageText}
            </p>
          </div>
          <div>
            <h3>
              {T.previewRecipients} ({resolved.length})
            </h3>
            <ul className="stack" data-testid="preview-recipients">
              {resolved.map((id) => {
                const member = state.members.find((m) => m.id === id);
                return (
                  <li key={id}>
                    {member?.name ?? id}{' '}
                    <span className="muted small">({member?.contactLabel})</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active exercise
// ---------------------------------------------------------------------------

function ActiveExercise() {
  const { state, run, announce } = useApp();
  const exercise = getOpenExercise(state);
  const call = getActiveCall(state);

  const [closing, setClosing] = useState<'CLOSE' | 'CANCEL' | null>(null);
  const [cancellingCall, setCancellingCall] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  if (!exercise) return null;

  const totals = call
    ? getResponseTotals(state, call.id)
    : { recipients: 0, dolazim: 0, kasnije: 0, neMogu: 0, bezOdgovora: 0, direktnoNaLokaciju: 0 };
  const rows = call ? getRecipientRows(state, call.id) : [];

  function changeStatus(status: ExerciseStatus) {
    if (!exercise) return;
    const result = run({
      type: 'SET_EXERCISE_STATUS',
      commandId: makeId(),
      exerciseId: exercise.id,
      status,
    });
    if (!result.ok) {
      announce(result.error.message, 'error');
      return;
    }
    announce(`Status vjezbe je promijenjen na: ${STATUS_LABEL[status]}.`);
  }

  function finish() {
    if (!exercise || !closing) return;
    if (reason.trim() === '') {
      setReasonError('Unesite kratak razlog.');
      return;
    }
    const result = run({
      type: closing === 'CLOSE' ? 'CLOSE_EXERCISE' : 'CANCEL_EXERCISE',
      commandId: makeId(),
      exerciseId: exercise.id,
      reason,
    });
    if (!result.ok) {
      setReasonError(result.error.message);
      return;
    }
    announce(closing === 'CLOSE' ? 'Vjezba je zatvorena.' : 'Vjezba je otkazana.');
    setClosing(null);
    setReason('');
    setReasonError(undefined);
  }

  function doCancelCall() {
    if (!call) return;
    const result = run({ type: 'CANCEL_CALL', commandId: makeId(), callId: call.id });
    setCancellingCall(false);
    announce(
      result.ok ? 'Poziv je otkazan. Ranije dati odgovori ostaju u evidenciji.' : result.error.message,
      result.ok ? 'info' : 'error',
    );
  }

  return (
    <>
      <section className="card card--alert" aria-labelledby="active-h">
        <div className="card__head">
          <h2 id="active-h">{T.activeExercise}</h2>
          <div className="btn-row">
            <Chip tone="alert" symbol="!">
              {KIND_LABEL[exercise.kind]}
            </Chip>
            <StatusChip status={exercise.status} />
          </div>
        </div>

        <div className="stack">
          <p style={{ fontSize: '1.2rem', fontWeight: 700 }} data-testid="active-title">
            {exercise.title}
          </p>
          <p>
            <span className="muted small">{T.instructions}: </span>
            {exercise.instructions}
          </p>
          <p>
            <span className="muted small">{T.fieldIncidentLocation}: </span>
            <strong data-testid="incident-location">{exercise.incidentLocation}</strong>
          </p>
          {exercise.reporterLocation ? (
            <p className="small muted">
              {T.fieldReporterLocation}: {exercise.reporterLocation}
            </p>
          ) : null}
          <div className="btn-row">
            <MapLink query={exercise.incidentLocation} />
          </div>
          <p className="small muted">
            Kreirano: {formatTime(exercise.createdAt)} - {' '}
            {state.members.find((m) => m.id === exercise.createdBy)?.name ?? '-'}
          </p>
        </div>
      </section>

      <section className="card" aria-labelledby="status-h">
        <div className="card__head">
          <h2 id="status-h">{T.changeStatus}</h2>
        </div>
        <p className="small muted">
          Status mijenja samo ovlasteno lice. Ne mijenja se automatski na osnovu odziva clanova ni
          izlaska vozila.
        </p>
        <div className="btn-row" style={{ marginTop: 'var(--sp-3)' }}>
          {OPEN_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`btn ${exercise.status === status ? 'btn--primary' : ''}`}
              aria-pressed={exercise.status === status}
              onClick={() => changeStatus(status)}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 'var(--sp-4)' }}>
          <button type="button" className="btn" onClick={() => setClosing('CLOSE')}>
            {T.closeExercise}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setClosing('CANCEL')}>
            {T.cancelExercise}
          </button>
          {call ? (
            <button type="button" className="btn" onClick={() => setCancellingCall(true)}>
              {T.cancelCall}
            </button>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="responses-h">
        <div className="card__head">
          <h2 id="responses-h">{T.responses}</h2>
          {call ? (
            <p className="small muted">
              {T.total} primalaca: {totals.recipients}
            </p>
          ) : null}
        </div>

        {!call ? (
          <EmptyState title="Poziv je otkazan">
            Vjezba je i dalje otvorena, ali aktivni poziv ne postoji.
          </EmptyState>
        ) : (
          <>
            {isDeliveryUnattempted(state, call.id) ? <DeliveryNotice /> : null}

            <div className="totals">
              <Total tone="yes" value={totals.dolazim} label={ANSWER_LABEL.DOLAZIM} />
              <Total tone="later" value={totals.kasnije} label={ANSWER_LABEL.DOLAZIM_KASNIJE} />
              <Total tone="no" value={totals.neMogu} label={ANSWER_LABEL.NE_MOGU} />
              <Total tone="unknown" value={totals.bezOdgovora} label="Bez odgovora" />
            </div>

            <p className="small muted" style={{ marginTop: 'var(--sp-3)' }}>
              Clanovi koji dolaze prvo se okupljaju u bazi DVD Tivat radi preuzimanja opreme.
            </p>

            <ScrollRegion label="Primaoci poziva, stanje isporuke i dati odgovori">
              <table>
                <caption className="sr-only">
                  Primaoci poziva, stanje isporuke i dati odgovori
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{T.member}</th>
                    <th scope="col">{T.delivery}</th>
                    <th scope="col">{T.answer}</th>
                    <th scope="col">{T.time}</th>
                  </tr>
                </thead>
                <tbody data-testid="recipient-rows">
                  {rows.map((row) => (
                    <tr key={row.member.id}>
                      <th scope="row">{row.member.name}</th>
                      <td className="small muted">
                        {row.delivery ? DELIVERY_LABEL[row.delivery.state] : '-'}
                      </td>
                      <td>
                        <AnswerChip response={row.response} />
                      </td>
                      <td className="small muted">
                        {row.response ? formatTime(row.response.updatedAt) : '-'}
                        {row.response && row.response.revision > 1
                          ? ` (izmjena ${row.response.revision})`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </>
        )}
      </section>

      <ConfirmDialog
        open={closing !== null}
        title={closing === 'CANCEL' ? T.cancelExercise : T.closeExercise}
        confirmLabel={T.confirm}
        confirmTone={closing === 'CANCEL' ? 'danger' : 'primary'}
        onConfirm={finish}
        onCancel={() => {
          setClosing(null);
          setReason('');
          setReasonError(undefined);
        }}
      >
        <div className="stack">
          <p>
            {closing === 'CANCEL'
              ? 'Vjezba se oznacava kao otkazana. Clanovi vise nece moci da odgovore, a dosadasnja evidencija ostaje sacuvana.'
              : 'Vjezba se oznacava kao zavrsena i prelazi u istoriju. Odgovori i evidencija vozila ostaju sacuvani.'}
          </p>
          <Field label={T.reason} required error={reasonError} controlId="f-reason">
            {(a) => (
              <input
                {...a}
                type="text"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(undefined);
                }}
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancellingCall}
        title={T.cancelCall}
        confirmLabel={T.confirm}
        confirmTone="danger"
        onConfirm={doCancelCall}
        onCancel={() => setCancellingCall(false)}
      >
        <p>
          Poziv se oznacava kao otkazan i clanovi vise ne mogu da odgovore na njega. Vjezba ostaje
          otvorena. Vec dati odgovori ostaju u evidenciji.
        </p>
      </ConfirmDialog>
    </>
  );
}
