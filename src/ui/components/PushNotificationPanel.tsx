import { useEffect, useState } from 'react';
import {
  currentPushSubscription,
  disableWebPush,
  enableWebPush,
  pushCapability,
  repairWebPushRegistration,
  type PushCapability,
} from '@/notifications/push';
import { Notice } from './primitives';

type State = 'CHECKING' | 'OFF' | 'ON' | 'BUSY' | 'DENIED' | 'ERROR';

export function PushNotificationPanel() {
  const [capability, setCapability] = useState<PushCapability>('UNSUPPORTED');
  const [state, setState] = useState<State>('CHECKING');

  useEffect(() => {
    let active = true;
    const detected = pushCapability();
    setCapability(detected);
    if (detected !== 'AVAILABLE') {
      setState('OFF');
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        // Repair only re-registers a subscription this browser already holds.
        // It cannot create one, so opening this screen never turns the alarm
        // on for somebody who turned it off - see `repairWebPushRegistration`.
        await repairWebPushRegistration();
        const subscription = await currentPushSubscription();
        if (active) setState(subscription ? 'ON' : Notification.permission === 'denied' ? 'DENIED' : 'OFF');
      } catch {
        if (active) setState('ERROR');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const enable = async () => {
    setState('BUSY');
    try {
      await enableWebPush();
      setState('ON');
    } catch (error) {
      setState(String(error).includes('PERMISSION_DENIED') ? 'DENIED' : 'ERROR');
    }
  };

  const disable = async () => {
    setState('BUSY');
    try {
      await disableWebPush();
      setState('OFF');
    } catch {
      setState('ERROR');
    }
  };

  return (
    <section className="panel push-panel" aria-labelledby="push-panel-title">
      <div className="push-panel__head">
        <div>
          <p className="eyebrow">OPERATIVNA UZBUNA</p>
          <h2 className="panel__title" id="push-panel-title">Notifikacije za novi poziv</h2>
        </div>
        {/* Announced: the button that changes this state is pressed by
            somebody who may not be able to see the chip change colour. */}
        <span
          role="status"
          data-testid="push-state"
          className={`push-panel__state push-panel__state--${state.toLowerCase()}`}
        >
          {state === 'ON' ? 'Ukljucene' : state === 'BUSY' || state === 'CHECKING' ? 'Provjera...' : 'Iskljucene'}
        </span>
      </div>

      {capability === 'INSTALL_ON_IOS' ? (
        <Notice tone="info">
          Na iPhoneu prvo izaberite <strong>Podijeli - Dodaj na pocetni ekran</strong>, otvorite
          DVD Tivat sa te ikone, pa ovdje ukljucite notifikacije.
        </Notice>
      ) : capability === 'UNSUPPORTED' ? (
        <Notice tone="warn">Ovaj pregledac ne podrzava pouzdane Web Push notifikacije.</Notice>
      ) : capability === 'NOT_CONFIGURED' ? (
        <Notice tone="warn">Push servis jos nije povezan sa ovom objavljenom verzijom.</Notice>
      ) : state === 'DENIED' ? (
        <Notice tone="warn">
          Notifikacije su odbijene u podesavanjima telefona. Dozvolite ih za DVD Tivat, pa otvorite
          aplikaciju ponovo.
        </Notice>
      ) : state === 'ERROR' ? (
        <Notice tone="error">Notifikacija nije podesena. Provjerite vezu i pokusajte ponovo.</Notice>
      ) : state === 'ON' ? (
        <Notice tone="info">
          Ovaj uredjaj je prijavljen za <strong>OPERATIVNI POZIV</strong>. Sistem ce pokusati da
          prikaze upozorenje i kada aplikacija nije otvorena. Zvuk zavisi od podesavanja telefona.
        </Notice>
      ) : (
        <p className="muted small">
          Upozorenje ne otkriva lokaciju na zakljucanom ekranu. Otvaranje notifikacije vodi u
          prijavljenu aplikaciju i konkretan poziv.
        </p>
      )}

      {capability === 'AVAILABLE' ? (
        <button
          type="button"
          className={state === 'ON' ? 'btn btn--ghost' : 'btn btn--primary btn--big'}
          disabled={state === 'BUSY' || state === 'CHECKING' || state === 'DENIED'}
          onClick={() => void (state === 'ON' ? disable() : enable())}
        >
          {state === 'ON' ? 'Iskljuci na ovom uredjaju' : 'Ukljuci operativne notifikacije'}
        </button>
      ) : null}
    </section>
  );
}

