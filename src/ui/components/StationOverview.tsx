import { getOpenExercise, getVehicleBoard } from '@/domain/selectors';
import { useApp } from '@/state/AppStateContext';

/** Counts describe fictional records, never readiness or real availability. */
export function StationOverview() {
  const { state } = useApp();
  const exercise = getOpenExercise(state);
  const inStation = getVehicleBoard(state).filter((row) => row.state === 'U_DOMU').length;

  return (
    <section className="station-overview" aria-label="Pregled DVD Tivat demonstracije">
      <div className="station-overview__intro">
        <div>
          <p className="eyebrow">DVD TIVAT / ZAJEDNO ZA NAS GRAD</p>
          <h2>Ljudi. Oprema.<br />Jedan tim.</h2>
          <p className="station-overview__description">Pripremite vjezbu, pratite odzive i vodite evidenciju svog drustva.</p>
          <span className="station-overview__status">{exercise ? 'Otvorena probna vjezba' : 'Nema otvorene vjezbe'}</span>
        </div>
        {/* Abstract Adriatic lines, not a map or an official society emblem. */}
        <svg className="station-overview__art" viewBox="0 0 280 180" fill="none" aria-hidden="true" focusable="false">
          <circle cx="158" cy="82" r="60" /><circle cx="158" cy="82" r="77" />
          <path d="M129 94V68l29-15 29 15v26c0 22-29 35-29 35s-29-13-29-35Z" />
          <path d="M158 73v35m-17-17h34M5 139c30-19 44 19 74 0s44 19 74 0 44 19 74 0 44 19 74 0M5 155c30-19 44 19 74 0s44 19 74 0 44 19 74 0 44 19 74 0" />
        </svg>
      </div>
      <dl className="station-overview__facts">
        <div><dt>Izmisljeni clanovi</dt><dd data-testid="overview-members">{state.members.length}</dd></div>
        <div><dt>Probne grupe</dt><dd>{state.groups.length}</dd></div>
        <div><dt>Probna vozila u domu</dt><dd data-testid="overview-vehicles">{inStation}<span> / {state.vehicles.length}</span></dd></div>
      </dl>
    </section>
  );
}
