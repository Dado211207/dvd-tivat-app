/**
 * History, the timestamped activity log, and the demo reset.
 *
 * Closed and cancelled exercises stay here with their responses intact - a
 * record that can be read afterwards is half the point of the product. The reset
 * is confirmed, and it clears only this prototype's own storage key.
 */

import { useState } from 'react';
import { KIND_LABEL } from '@/domain/message';
import { getHistory, getResponseTotals } from '@/domain/selectors';
import { ACTIVITY_LABEL, formatTime, T } from '@/i18n/labels';
import { makeId, useApp } from '@/state/AppStateContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, Notice, ScrollRegion, StatusChip } from '../components/primitives';

export function HistoryView() {
  const { state, run, announce } = useApp();
  const [confirming, setConfirming] = useState(false);
  const history = getHistory(state);

  function reset() {
    const result = run({ type: 'RESET_DEMO_DATA', commandId: makeId() });
    setConfirming(false);
    announce(
      result.ok
        ? 'Probni podaci ovog pregledaca su vraceni na pocetno stanje.'
        : result.error.message,
      result.ok ? 'info' : 'error',
    );
  }

  return (
    <>
      <h1 className="sr-only">{T.historyTitle}</h1>

      <section className="card" aria-labelledby="history-h">
        <div className="card__head">
          <h2 id="history-h">{T.historyTitle}</h2>
          <p className="small muted">{T.historyNote}</p>
        </div>

        {history.length === 0 ? (
          <EmptyState title={T.noHistory} />
        ) : (
          <ScrollRegion label="Zavrsene i otkazane vjezbe">
            <table>
              <caption className="sr-only">Zavrsene i otkazane vjezbe</caption>
              <thead>
                <tr>
                  <th scope="col">Vjezba</th>
                  <th scope="col">{T.status}</th>
                  <th scope="col">Odzivi</th>
                  <th scope="col">Zatvoreno</th>
                </tr>
              </thead>
              <tbody data-testid="history-rows">
                {history.map((exercise) => {
                  const call = state.calls.find((c) => c.exerciseId === exercise.id);
                  const totals = call
                    ? getResponseTotals(state, call.id)
                    : { recipients: 0, dolazim: 0, kasnije: 0, neMogu: 0, bezOdgovora: 0, direktnoNaLokaciju: 0 };
                  return (
                    <tr key={exercise.id}>
                      <th scope="row">
                        {exercise.title}
                        <br />
                        <span className="small muted">
                          {KIND_LABEL[exercise.kind]} - {exercise.incidentLocation}
                        </span>
                      </th>
                      <td>
                        <StatusChip status={exercise.status} />
                      </td>
                      <td className="small">
                        {totals.dolazim} / {totals.kasnije} / {totals.neMogu} / {totals.bezOdgovora}
                        <br />
                        <span className="muted">dolazi / kasnije / ne moze / bez odgovora</span>
                      </td>
                      <td className="small muted">
                        {exercise.closedAt ? formatTime(exercise.closedAt) : '-'}
                        {exercise.closeReason ? (
                          <>
                            <br />
                            {exercise.closeReason}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      <section className="card" aria-labelledby="activity-h">
        <div className="card__head">
          <h2 id="activity-h">{T.activityLog}</h2>
          <p className="small muted">
            Svaka promjena ima vrijeme i simuliranog ucesnika koji ju je napravio.
          </p>
        </div>
        <ScrollRegion label="Hronologija promjena">
          <table>
            <caption className="sr-only">Hronologija promjena</caption>
            <thead>
              <tr>
                <th scope="col">{T.time}</th>
                <th scope="col">{T.actor}</th>
                <th scope="col">{T.event}</th>
                <th scope="col">{T.detail}</th>
              </tr>
            </thead>
            <tbody data-testid="activity-rows">
              {state.activity.map((entry) => (
                <tr key={entry.id}>
                  <td className="small mono">{formatTime(entry.at)}</td>
                  <td className="small">{entry.actorName}</td>
                  <td className="small">
                    <strong>{ACTIVITY_LABEL[entry.kind]}</strong>
                  </td>
                  <td className="small muted">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <section className="card" aria-labelledby="reset-h">
        <div className="card__head">
          <h2 id="reset-h">{T.resetData}</h2>
        </div>
        <Notice tone="warn">{T.resetConfirmText}</Notice>
        <button
          type="button"
          className="btn btn--danger"
          data-testid="reset-button"
          onClick={() => setConfirming(true)}
        >
          {T.resetData}
        </button>
      </section>

      <ConfirmDialog
        open={confirming}
        title={T.resetConfirmTitle}
        confirmLabel={T.resetData}
        confirmTone="danger"
        onConfirm={reset}
        onCancel={() => setConfirming(false)}
      >
        <p>{T.resetConfirmText}</p>
      </ConfirmDialog>
    </>
  );
}
