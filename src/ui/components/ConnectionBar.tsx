/**
 * Two things the person needs to know about the application itself, rather
 * than about the intervention: the device has no connection, and a new version
 * is waiting.
 *
 * Both are stated where they cannot be missed and in words that say what it
 * means for the work in hand. "Offline" on its own is a status; "what you enter
 * now will not reach the server" is the fact somebody at an incident needs.
 */

import { useAppUpdate, useOnline } from '@/pwa';
import { useText } from '@/i18n/useText';
import { Notice } from './primitives';

export function ConnectionBar() {
  const t = useText();
  const online = useOnline();
  const { updateReady, applyUpdate } = useAppUpdate();

  if (!online) {
    return (
      <div data-testid="offline-bar">
        <Notice tone="error">
          <strong>{t.connection.offlineTitle}</strong> {t.connection.offlineText}
        </Notice>
      </div>
    );
  }

  if (updateReady) {
    return (
      <div data-testid="update-bar">
        <Notice tone="info">
          <strong>{t.connection.updateTitle}</strong> {t.connection.updateText}{' '}
          <button type="button" className="btn btn--primary" onClick={applyUpdate}>
            {t.connection.updateAction}
          </button>
        </Notice>
      </div>
    );
  }

  return null;
}
