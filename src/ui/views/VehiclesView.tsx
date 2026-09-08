/**
 * Vehicle departures and returns.
 *
 * Deliberately its own screen with its own explicit actions. A member answering
 * "Dolazim" must never imply that a vehicle has left the station, and no code
 * path here reads a response.
 */

import { useState } from 'react';
import { getOpenExercise, getVehicleBoard } from '@/domain/selectors';
import type { Id } from '@/domain/types';
import { formatTime, T } from '@/i18n/labels';
import { makeId, useApp } from '@/state/AppStateContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, Field, Notice, ScrollRegion, VehicleChip } from '../components/primitives';

export function VehiclesView() {
  const { state, run, announce } = useApp();
  const exercise = getOpenExercise(state);
  const board = getVehicleBoard(state);

  const [departing, setDeparting] = useState<Id | null>(null);
  const [purpose, setPurpose] = useState('');

  function confirmDeparture() {
    if (!exercise || !departing) return;
    const vehicle = state.vehicles.find((v) => v.id === departing);
    const result = run({
      type: 'DEPART_VEHICLE',
      commandId: makeId(),
      exerciseId: exercise.id,
      vehicleId: departing,
      purpose,
    });
    setDeparting(null);
    setPurpose('');
    announce(
      result.ok
        ? `Vozilo ${vehicle?.callsign ?? ''} je evidentirano kao izaslo.`
        : result.error.message,
      result.ok ? 'info' : 'error',
    );
  }

  function returnVehicle(vehicleId: Id) {
    const vehicle = state.vehicles.find((v) => v.id === vehicleId);
    const result = run({ type: 'RETURN_VEHICLE', commandId: makeId(), vehicleId });
    announce(
      result.ok
        ? `Vozilo ${vehicle?.callsign ?? ''} je evidentirano kao vraceno.`
        : result.error.message,
      result.ok ? 'info' : 'error',
    );
  }

  return (
    <>
      <h1 className="sr-only">{T.vehiclesTitle}</h1>

      <section className="card" aria-labelledby="vehicles-h">
        <div className="card__head">
          <h2 id="vehicles-h">{T.vehiclesTitle}</h2>
        </div>

        <Notice tone="info">{T.vehiclesNote}</Notice>

        {!exercise ? (
          <p className="small muted" style={{ marginBottom: 'var(--sp-3)' }}>
            Nema otvorene vjezbe, pa izlazak vozila nije moguce evidentirati. Povratak vec izaslog
            vozila je i dalje moguc.
          </p>
        ) : null}

        <ScrollRegion label="Stanje vozila i evidencija izlaska">
          <table>
            <caption className="sr-only">Stanje vozila i evidencija izlaska</caption>
            <thead>
              <tr>
                <th scope="col">{T.vehicle}</th>
                <th scope="col">{T.status}</th>
                <th scope="col">{T.detail}</th>
                <th scope="col">Akcija</th>
              </tr>
            </thead>
            <tbody data-testid="vehicle-rows">
              {board.map((row) => (
                <tr key={row.vehicle.id}>
                  <th scope="row">
                    <span className="mono">{row.vehicle.callsign}</span>
                    <br />
                    <span className="small muted">{row.vehicle.name}</span>
                  </th>
                  <td data-testid={`vehicle-state-${row.vehicle.callsign}`}>
                    <VehicleChip state={row.state} />
                  </td>
                  <td className="small muted">
                    {row.currentMovement
                      ? `Izaslo ${formatTime(row.currentMovement.departedAt)}${
                          row.currentMovement.purpose ? ` - ${row.currentMovement.purpose}` : ''
                        }`
                      : '-'}
                  </td>
                  <td>
                    {row.state === 'U_DOMU' ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={!exercise}
                        data-testid={`depart-${row.vehicle.callsign}`}
                        onClick={() => setDeparting(row.vehicle.id)}
                      >
                        {T.departVehicle}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        data-testid={`return-${row.vehicle.callsign}`}
                        onClick={() => returnVehicle(row.vehicle.id)}
                      >
                        {T.returnVehicle}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      {state.vehicleMovements.length === 0 ? (
        <EmptyState title="Nema evidentiranih izlazaka vozila." />
      ) : (
        <section className="card" aria-labelledby="movements-h">
          <div className="card__head">
            <h2 id="movements-h">Evidencija izlazaka</h2>
          </div>
          <ScrollRegion label="Istorija izlazaka i povrataka vozila">
            <table>
              <caption className="sr-only">Istorija izlazaka i povrataka vozila</caption>
              <thead>
                <tr>
                  <th scope="col">{T.vehicle}</th>
                  <th scope="col">Izlazak</th>
                  <th scope="col">Povratak</th>
                  <th scope="col">Svrha</th>
                </tr>
              </thead>
              <tbody>
                {state.vehicleMovements.map((movement) => {
                  const vehicle = state.vehicles.find((v) => v.id === movement.vehicleId);
                  return (
                    <tr key={movement.id}>
                      <th scope="row" className="mono">
                        {vehicle?.callsign ?? '-'}
                      </th>
                      <td className="small">{formatTime(movement.departedAt)}</td>
                      <td className="small">
                        {movement.returnedAt ? formatTime(movement.returnedAt) : 'jos nije vraceno'}
                      </td>
                      <td className="small muted">{movement.purpose || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      )}

      <ConfirmDialog
        open={departing !== null}
        title={T.departVehicle}
        confirmLabel={T.confirm}
        onConfirm={confirmDeparture}
        onCancel={() => {
          setDeparting(null);
          setPurpose('');
        }}
      >
        <div className="stack">
          <p>
            Izlazak se evidentira rucno. Ovo je zaseban podatak od odziva clanova i ne mijenja status
            vjezbe.
          </p>
          <Field label={T.purpose} controlId="f-purpose">
            {(a) => (
              <input
                {...a}
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="npr. dovoz opreme"
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}
