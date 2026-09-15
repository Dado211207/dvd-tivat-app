/**
 * Turning the alarm on for one device, and saying honestly what that buys.
 *
 * Two shapes, one behaviour. `full` is the whole panel, used on Settings where
 * somebody has come to change something. `compact` is for the firefighter's
 * operational screen, and it collapses to a single line ONLY when notifications
 * are already on - because then there is nothing to do, and a paragraph
 * explaining a thing that is already working is just something between a
 * firefighter and their call-out. When there IS an action to take, `compact`
 * shows the same panel as `full`: hiding the button behind a second screen would
 * be tidiness bought with somebody not being woken up.
 */

import { useEffect, useState } from 'react';
import { useText } from '@/i18n/useText';
import {
  currentPushSubscription,
  disableWebPush,
  enableWebPush,
  pushCapability,
  repairWebPushRegistration,
  type PushCapability,
} from '@/notifications/push';
import { hrefFor } from '../router';
import { Notice } from './primitives';

type State = 'CHECKING' | 'OFF' | 'ON' | 'BUSY' | 'DENIED' | 'ERROR';

export interface PushNotificationPanelProps {
  readonly variant?: 'full' | 'compact';
}

export function PushNotificationPanel({ variant = 'full' }: PushNotificationPanelProps) {
  const t = useText();
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

  const stateText =
    state === 'ON' ? t.push.stateOn
      : state === 'BUSY' || state === 'CHECKING' ? t.push.stateChecking
      : t.push.stateOff;

  // Settled and working: one line, and a way through to the whole thing.
  if (variant === 'compact' && state === 'ON') {
    return (
      <p className="push-line" data-testid="push-compact">
        <span className="push-line__label">{t.push.title}</span>
        <span
          role="status"
          data-testid="push-state"
          className="push-panel__state push-panel__state--on"
        >
          {stateText}
        </span>
        <a className="push-line__link" href={hrefFor('podesavanja')}>{t.push.openSettings}</a>
      </p>
    );
  }

  return (
    <div className="push-panel" data-testid="push-panel">
      <div className="push-panel__head">
        {/* Settings already puts a heading above this panel; the operational
            screen does not, so the compact variant brings its own. */}
        {variant === 'compact' ? (
          <div>
            <p className="eyebrow">{t.push.eyebrow}</p>
            <h3 className="panel__subtitle">{t.push.title}</h3>
          </div>
        ) : null}
        {/* Announced: the button that changes this state is pressed by somebody
            who may not be able to see the chip change colour. */}
        <span
          role="status"
          data-testid="push-state"
          className={`push-panel__state push-panel__state--${state.toLowerCase()}`}
        >
          {stateText}
        </span>
      </div>

      {capability === 'INSTALL_ON_IOS' ? (
        <Notice tone="info">{t.push.installOnIos}</Notice>
      ) : capability === 'UNSUPPORTED' ? (
        <Notice tone="warn">{t.push.unsupported}</Notice>
      ) : capability === 'NOT_CONFIGURED' ? (
        <Notice tone="warn">{t.push.notConfigured}</Notice>
      ) : state === 'DENIED' ? (
        <Notice tone="warn">{t.push.denied}</Notice>
      ) : state === 'ERROR' ? (
        <Notice tone="error">{t.push.failed}</Notice>
      ) : state === 'ON' ? (
        <Notice tone="info">{t.push.enabledExplanation}</Notice>
      ) : (
        <p className="muted small">{t.push.privacyExplanation}</p>
      )}

      {capability === 'AVAILABLE' ? (
        <button
          type="button"
          className={state === 'ON' ? 'btn btn--ghost' : 'btn btn--primary btn--big'}
          disabled={state === 'BUSY' || state === 'CHECKING' || state === 'DENIED'}
          onClick={() => void (state === 'ON' ? disable() : enable())}
        >
          {state === 'ON' ? t.push.disable : t.push.enable}
        </button>
      ) : null}

      {/* Push is best-effort and opt-in. The approved telephone fallback is the
          thing a real alarm still rests on, and this screen is where somebody
          decides how much to rely on the phone in their hand. */}
      <p className="muted small">{t.push.fallbackReminder}</p>
    </div>
  );
}
