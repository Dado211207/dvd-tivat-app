import { SOCIETY_PROFILE } from '@/config/society';
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
        <div><dt>Clanovi</dt><dd data-testid="overview-members">{state.members.length}</dd><dd className="station-overview__fact-note">probnih zapisa / potvrdjeno {SOCIETY_PROFILE.confirmedMemberCount}</dd></div>
        <div><dt>Okupljanje</dt><dd className="station-overview__fact-value">Baza</dd><dd className="station-overview__fact-note">po opremu prije izlaska</dd></div>
        <div><dt>Vozila u bazi</dt><dd data-testid="overview-vehicles">{inStation}<span> / {state.vehicles.length}</span></dd><dd className="station-overview__fact-note">rucno evidentirano</dd></div>
      </dl>
      <div className="station-overview__profile" data-testid="operating-profile">
        <span><strong>Rad:</strong> bez smjena, poziv iz kuce u bazu</span>
        <span><strong>Rezervni kanal:</strong> {SOCIETY_PROFILE.currentFallbackChannel}</span>
        <span><strong>Telefoni:</strong> {SOCIETY_PROFILE.supportedPhoneFamilies.join(' i ')}</span>
        <small>{SOCIETY_PROFILE.confirmation}</small>
      </div>
    </section>
  );
}
