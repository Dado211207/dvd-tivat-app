/**
 * What a called member sees on their own phone.
 *
 * The answer buttons are the largest controls in the application on purpose:
 * they are pressed by someone who has just been woken up. Nothing here is
 * confirmed by a server, and the screen says so rather than implying it.
 */

import { useState } from 'react';
import { KIND_LABEL } from '@/domain/message';
import { getActiveCallForMember, getExerciseById, getResponse } from '@/domain/selectors';
import { ETA_OPTIONS, type EtaMinutes, type ResponseAnswer } from '@/domain/types';
import { ANSWER_LABEL, ANSWER_SYMBOL, formatTime, T } from '@/i18n/labels';
import { makeId, useApp } from '@/state/AppStateContext';
import { MapLink } from '../components/MapLink';
import { AnswerChip, Chip, EmptyState, Notice, StatusChip } from '../components/primitives';

const TONE: Record<ResponseAnswer, 'yes' | 'later' | 'no'> = {
  DOLAZIM: 'yes',
  DOLAZIM_KASNIJE: 'later',
  NE_MOGU: 'no',
};

export function MemberView() {
  const { state, run, announce } = useApp();
  const memberId = state.simulation.actorId;
  const member = state.members.find((m) => m.id === memberId);
  const call = getActiveCallForMember(state, memberId);
  const exercise = call ? getExerciseById(state, call.exerciseId) : undefined;
  const existing = call ? getResponse(state, call.id, memberId) : undefined;

  // Local draft: what the member has tapped but not yet sent.
  const [draft, setDraft] = useState<ResponseAnswer | null>(null);
  const [eta, setEta] = useState<EtaMinutes>(30);
  const [direct, setDirect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const showForm = !existing || editing;

  function submit(answer: ResponseAnswer) {
    if (!call) return;
    const result = run({
      type: 'SUBMIT_RESPONSE',
      commandId: makeId(),
      callId: call.id,
      memberId,
      answer,
      etaMinutes: answer === 'DOLAZIM_KASNIJE' ? eta : null,
      directToLocation: answer === 'NE_MOGU' ? false : direct,
    });

    if (!result.ok) {
      setError(result.error.message);
      announce(result.error.message, 'error');
      return;
    }

    setError(null);
    setEditing(false);
    setDraft(null);
    announce(`Odgovor "${ANSWER_LABEL[answer]}" je zabiljezen u ovom pregledacu.`);
  }

  return (
    <>
      <h1 className="sr-only">{T.memberTitle}</h1>

      <section className="card card--muted" aria-labelledby="sim-h">
        <div className="card__head">
          <h2 id="sim-h">{T.simulateMember}</h2>
        </div>
        <p className="small muted">{T.simulateMemberHint}</p>
        <p style={{ marginTop: 'var(--sp-2)' }}>
          Trenutno: <strong data-testid="current-member">{member?.name ?? '-'}</strong>
        </p>
        <p className="small muted">Clana mijenjate u traci na vrhu stranice.</p>
      </section>

      {!call || !exercise ? (
        <EmptyState title={T.noCallForYou}>{T.noCallForYouHint}</EmptyState>
      ) : (
        <>
          <section className="card card--alert" aria-labelledby="call-h">
            <div className="card__head">
              <h2 id="call-h">{T.yourCall}</h2>
              <div className="btn-row">
                <Chip tone="alert" symbol="!">
                  {KIND_LABEL[exercise.kind]}
                </Chip>
                <StatusChip status={exercise.status} />
              </div>
            </div>

            <div className="stack">
              <p style={{ fontSize: '1.25rem', fontWeight: 750 }} data-testid="member-call-title">
                {exercise.title}
              </p>
              <p>
                <span className="muted small">{T.instructions}: </span>
                {exercise.instructions}
              </p>
              <p>
                <span className="muted small">{T.fieldIncidentLocation}: </span>
                <strong>{exercise.incidentLocation}</strong>
              </p>
              {exercise.reporterLocation ? (
                <p className="small muted">
                  {T.fieldReporterLocation}: {exercise.reporterLocation}
                </p>
              ) : null}
              <div className="btn-row">
                <MapLink query={exercise.incidentLocation} />
              </div>
              <p className="small muted">Poziv upucen: {formatTime(call.createdAt)}</p>
            </div>
          </section>

          <section className="card" aria-labelledby="answer-h">
            <div className="card__head">
              <h2 id="answer-h">{T.yourAnswer}</h2>
            </div>
            <p className="small muted">{T.answerHint}</p>

            {error ? <Notice tone="error">{error}</Notice> : null}

            {existing && !editing ? (
              <div className="stack">
                <p data-testid="current-answer">
                  <AnswerChip response={existing} />
                </p>
                <p className="small muted">
                  {formatTime(existing.updatedAt)}
                  {existing.revision > 1 ? ` - izmjena ${existing.revision}` : ''}. {T.answerRecorded}
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditing(true);
                    setDraft(existing.answer);
                    setEta(existing.etaMinutes ?? 30);
                    setDirect(existing.directToLocation);
                  }}
                >
                  {T.changeAnswer}
                </button>
              </div>
            ) : null}

            {showForm ? (
              <div className="stack">
                <div className="answer-grid" role="group" aria-label={T.yourAnswer}>
                  {(['DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU'] as ResponseAnswer[]).map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      className={`answer-btn answer-btn--${TONE[answer]}`}
                      aria-pressed={draft === answer}
                      data-testid={`answer-${answer}`}
                      onClick={() => {
                        setDraft(answer);
                        if (answer === 'NE_MOGU') setDirect(false);
                      }}
                    >
                      <span className="answer-btn__sym" aria-hidden="true">
                        {ANSWER_SYMBOL[answer]}
                      </span>
                      {ANSWER_LABEL[answer]}
                    </button>
                  ))}
                </div>

                {draft !== null && draft !== 'NE_MOGU' ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={direct}
                      data-testid="direct-to-location"
                      onChange={(e) => setDirect(e.target.checked)}
                    />
                    <span className="check__body check__name">{T.directToLocation}</span>
                  </label>
                ) : null}

                {draft === 'DOLAZIM_KASNIJE' ? (
                  <div>
                    <p className="field__label" id="eta-h">
                      {T.etaQuestion}
                    </p>
                    <div className="eta-row" role="group" aria-labelledby="eta-h">
                      {ETA_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="eta-btn"
                          aria-pressed={eta === option}
                          data-testid={`eta-${option}`}
                          onClick={() => setEta(option)}
                        >
                          {option} {T.etaMinutes}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {draft !== null ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    data-testid="submit-response"
                    onClick={() => submit(draft)}
                  >
                    {T.sendAnswer}
                  </button>
                ) : null}

                {editing ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditing(false);
                      setDraft(null);
                    }}
                  >
                    {T.cancel}
                  </button>
                ) : null}
              </div>
            ) : null}

            <Notice tone="warn">
              <p data-testid="response-storage-note">
                {editing
                  ? 'Izmjena jos nije zabiljezena. Prethodni odgovor ostaje dok ne posaljete izmjenu.'
                  : existing
                    ? 'Odgovor je zabiljezen samo u ovom pregledacu.'
                    : 'Odgovor jos nije zabiljezen. Izaberite ga, pa pritisnite Posalji odgovor.'}
                {' '}Nema potvrde servera niti sinhronizacije sa drugim uredjajima.
              </p>
            </Notice>
          </section>
        </>
      )}
    </>
  );
}
