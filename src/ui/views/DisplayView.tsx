/**
 * The wall display for the station.
 *
 * Read only, no actions at all, readable from across a room. It shows exactly
 * what the simulation contains and never invents a live indicator: no fake
 * "connected" dot, no fake arrival estimate, no delivery status it does not
 * have. Where nothing is known, it says so.
 */

import { KIND_LABEL } from '@/domain/message';
import {
  getActiveCall,
  getOpenExercise,
  getRecipientRows,
  getResponseTotals,
  getVehicleBoard,
} from '@/domain/selectors';
import { ANSWER_LABEL, formatClock, NO_ANSWER_LABEL, STATUS_LABEL, T } from '@/i18n/labels';
import { useApp } from '@/state/AppStateContext';
import { AnswerChip, Total, VehicleChip } from '../components/primitives';

export function DisplayView() {
  const { state } = useApp();
  const exercise = getOpenExercise(state);
  const call = getActiveCall(state);
  const vehicles = getVehicleBoard(state);
  const out = vehicles.filter((v) => v.state === 'NA_ZADATKU');

  const totals = call
    ? getResponseTotals(state, call.id)
    : { recipients: 0, dolazim: 0, kasnije: 0, neMogu: 0, bezOdgovora: 0, direktnoNaLokaciju: 0 };
  const rows = call ? getRecipientRows(state, call.id) : [];

  return (
    <div className="display">
      <h1 className="sr-only">{T.displayTitle}</h1>

      {!exercise ? (
        <div className="display__alert" style={{ borderColor: 'var(--c-line-strong)' }}>
          <p className="display__kicker" style={{ color: 'var(--c-ink-faint)' }}>
            <span aria-hidden="true">=</span> Stanje mirno
          </p>
          <p className="display__title">{T.noActiveExercise}</p>
          <p className="display__line muted">{T.displayNote}</p>
        </div>
      ) : (
        <>
          <div
            className={`display__alert ${exercise.status === 'OTVORENA' ? 'display__alert--live' : ''}`}
          >
            <p className="display__kicker">
              <span aria-hidden="true">!</span>
              <span>{KIND_LABEL[exercise.kind]}</span>
              <span aria-hidden="true">/</span>
              <span>{STATUS_LABEL[exercise.status]}</span>
            </p>
            <p className="display__title" data-testid="display-title">
              {exercise.title}
            </p>
            <p className="display__label">{T.fieldIncidentLocation}</p>
            <p className="display__line">
              <strong>{exercise.incidentLocation}</strong>
            </p>
            {exercise.reporterLocation ? (
              <>
                <p className="display__label" style={{ marginTop: 'var(--sp-2)' }}>
                  {T.fieldReporterLocation}
                </p>
                <p className="display__line">{exercise.reporterLocation}</p>
              </>
            ) : null}
            <p className="display__label" style={{ marginTop: 'var(--sp-3)' }}>
              {T.instructions}
            </p>
            <p className="display__line">{exercise.instructions}</p>
          </div>

          <div className="display__totals">
            <Total
              className="display__total"
              tone="yes"
              value={totals.dolazim}
              label={ANSWER_LABEL.DOLAZIM}
            />
            <Total
              className="display__total"
              tone="later"
              value={totals.kasnije}
              label={ANSWER_LABEL.DOLAZIM_KASNIJE}
            />
            <Total
              className="display__total"
              tone="no"
              value={totals.neMogu}
              label={ANSWER_LABEL.NE_MOGU}
            />
            <Total
              className="display__total"
              tone="unknown"
              value={totals.bezOdgovora}
              label={NO_ANSWER_LABEL}
            />
          </div>

          <div className="display__cols">
            <section aria-labelledby="d-responses">
              <h2 className="display__label" id="d-responses">
                {T.responses} ({totals.recipients})
              </h2>
              <ul className="display__list" data-testid="display-responses">
                {rows.map((row) => (
                  <li key={row.member.id}>
                    <span className="display__name">{row.member.name}</span>
                    <span>
                      <AnswerChip response={row.response} />
                      {row.response ? (
                        <span className="muted small"> {formatClock(row.response.updatedAt)}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="d-vehicles">
              <h2 className="display__label" id="d-vehicles">
                {T.vehiclesTitle}
              </h2>
              <ul className="display__list" data-testid="display-vehicles">
                {vehicles.map((row) => (
                  <li key={row.vehicle.id}>
                    <span className="display__name mono">{row.vehicle.callsign}</span>
                    <span>
                      <VehicleChip state={row.state} />
                      {row.currentMovement ? (
                        <span className="muted small">
                          {' '}
                          {formatClock(row.currentMovement.departedAt)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="small muted" style={{ marginTop: 'var(--sp-3)' }}>
                Izaslo vozila: <strong>{out.length}</strong>. Stanje vozila se evidentira zasebno i
                ne proizlazi iz odziva clanova.
              </p>
            </section>
          </div>
        </>
      )}

      <p className="small muted" style={{ marginTop: 'var(--sp-5)' }}>
        Simulacija. Prikazuje samo podatke unesene u ovaj pregledac. Isporuka obavjestenja nije
        pokusana.
      </p>
    </div>
  );
}
