import { getOpenExercise, getVehicleBoard } from '@/domain/selectors';
import { STATUS_LABEL } from '@/i18n/labels';
import { useApp } from '@/state/AppStateContext';

/** Counts describe fictional records, never readiness or real availability. */
export function StationOverview() {
  const { state } = useApp();
  const exercise = getOpenExercise(state);
  const inStation = getVehicleBoard(state).filter((row) => row.state === 'U_DOMU').length;

  return (
    <section className="station-overview" aria-label="Pregled DVD Tivat demonstracije">
      <div className="station-overview__intro">
        <div className="station-overview__copy">
          <p className="eyebrow">OPERATIVNI PREGLED</p>
          <h2>{exercise ? exercise.title : 'Spremni za novu vjezbu'}</h2>
          <p className="station-overview__description">
            {exercise
              ? 'Odzivi i statusi se osvjezavaju iz podataka zabiljezenih u ovom pregledacu.'
              : 'Pripremite poziv, izaberite primaoce i provjerite poruku prije potvrde.'}
          </p>
        </div>
        <span className={`station-overview__status ${exercise ? 'station-overview__status--active' : ''}`}>
          <span aria-hidden="true" />
          {exercise ? STATUS_LABEL[exercise.status] : 'Mirno stanje'}
        </span>
      </div>
      <dl className="station-overview__facts">
        <div><dt>Clanovi</dt><dd data-testid="overview-members">{state.members.length}</dd><span>u demonstraciji</span></div>
        <div><dt>Grupe</dt><dd>{state.groups.length}</dd><span>probnih grupa</span></div>
        <div><dt>Vozila u domu</dt><dd data-testid="overview-vehicles">{inStation}<span> / {state.vehicles.length}</span></dd><span>rucno evidentirano</span></div>
      </dl>
    </section>
  );
}
