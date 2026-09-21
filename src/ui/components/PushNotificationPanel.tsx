/**
 * Turning the alarm on for one device, and saying honestly what that buys.
 *
 * Two shapes. `full` is the whole panel, with its own heading: Settings, and the
 * firefighter's screen when no call-out is running. `compact` is one line with
 * the current state and a way through to Settings, used whenever a call-out IS
 * running - because a fire is not the moment to configure notifications, and
 * five lines about notification setup between a firefighter and the incident is
 * what this replaced.
 *
 * Nothing is hidden by that. The full panel is one tap away in Settings, and the
 * compact line still says whether alerts are on.
 */

import { useEffect, useState } from 'react';
import type { Strings } from '@/i18n/strings.me';
import { useText } from '@/i18n/useText';
import {
  currentPushSubscription,
  disableWebPush,
  enableWebPush,
  pushCapability,
  repairWebPushRegistration,
  type PushCapability,
  type PushFailure,
} from '@/notifications/push';
import { hrefFor } from '../router';
import { Notice } from './primitives';

type State = 'CHECKING' | 'OFF' | 'ON' | 'BUSY' | 'DENIED' | 'ERROR';

/** Checked longest-first so PUSH_SERVER_REFUSED never shadows a real reason. */
const PUSH_FAILURES: readonly PushFailure[] = [
  'PUSH_MEMBER_REQUIRED',
  'PUSH_ACCESS_REQUIRED',
  'PUSH_SUBSCRIPTION_CONFLICT',
  'PUSH_DEVICE_REJECTED',
  'PUSH_SERVER_REFUSED',
  'PUSH_UNREACHABLE',
];

/** One sentence per reason, so nobody is sent to check a working connection. */
function failureText(t: Strings, failure: PushFailure | null): string {
  switch (failure) {
    case 'PUSH_MEMBER_REQUIRED':
      return t.push.memberRequired;
    case 'PUSH_ACCESS_REQUIRED':
      return t.push.accessRequired;
    case 'PUSH_SUBSCRIPTION_CONFLICT':
      return t.push.subscriptionConflict;
    case 'PUSH_DEVICE_REJECTED':
      return t.push.deviceRejected;
    case 'PUSH_SERVER_REFUSED':
      return t.push.serverRefused;
    case 'PUSH_UNREACHABLE':
      return t.push.unreachable;
    default:
      return t.push.failed;
  }
}

export interface PushNotificationPanelProps {
  readonly variant?: 'full' | 'compact';
}

export function PushNotificationPanel({ variant = 'full' }: PushNotificationPanelProps) {
  const t = useText();
  const [capability, setCapability] = useState<PushCapability>('UNSUPPORTED');
  const [state, setState] = useState<State>('CHECKING');
  const [failure, setFailure] = useState<PushFailure | null>(null);

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
    setFailure(null);
    try {
      await enableWebPush();
      setState('ON');
    } catch (error) {
      const reason = String(error);
      if (reason.includes('PERMISSION_DENIED')) {
        setState('DENIED');
        return;
      }
      // An unrecognised throw is not evidence of anything in particular, so it
      // keeps the old wording rather than inventing a cause.
      setFailure(PUSH_FAILURES.find((value) => reason.includes(value)) ?? null);
      setState('ERROR');
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

  /*
   * Compact means COMPACT, whatever the state.
   *
   * This used to collapse only when push was already on - so on a device where
   * push is unsupported or not yet configured, which is most devices most of
   * the time, the full five-line panel rendered anyway. The caller asks for
   * compact when a call-out is running, and a running call-out is never the
   * moment to set up notifications. The state is still shown, and the whole
   * panel is one tap away in Settings.
   */
  if (variant === 'compact') {
    return (
      <p className="push-line" data-testid="push-compact">
        <span className="push-line__label">{t.push.title}</span>
        <span
          role="status"
          data-testid="push-state"
          className={`push-panel__state push-panel__state--${state.toLowerCase()}`}
        >
          {stateText}
        </span>
        <a className="push-line__link" href={hrefFor('podesavanja')}>{t.push.openSettings}</a>
      </p>
    );
  }

  return (
    <section className="push-panel" data-testid="push-panel" aria-labelledby="push-panel-title">
      <div className="push-panel__head">
        {/* The panel owns its heading wherever it appears, so no caller has to
            supply one and no caller can accidentally supply a second. */}
        <div>
          <p className="eyebrow">{t.push.eyebrow}</p>
          <h2 className="panel__subtitle" id="push-panel-title">{t.push.title}</h2>
        </div>
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
        <Notice tone="error" testId="push-failure">
          {failureText(t, failure)}
        </Notice>
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
    </section>
  );
}
