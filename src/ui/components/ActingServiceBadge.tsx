/**
 * "Acting as DVD / SZS", on the operational screens (P6, D14).
 *
 * A person who serves in - or, as the installation owner, administers - more than
 * one service does everything operational for ONE service at a time. Which one is
 * chosen in Settings; this badge is the reminder, on the screen where it matters,
 * of which service the call-out, the roster and the record in front of them belong
 * to. A commander must not publish an SZS call-out believing they are in DVD, and a
 * firefighter must know which service's call-outs they are being shown.
 *
 * It appears ONLY when there is a genuine choice - `canSwitchService`, i.e. more
 * than one available service. A single-service member has no ambiguity to resolve,
 * and adding "acting as DVD" to every one of their screens would be exactly the
 * density this interface has worked to remove. The change link goes to Settings,
 * the one deliberate place a switch is made; this badge never flips the service
 * itself, because D14 requires the switch to be an explicit act, never a side
 * effect of arriving on a screen.
 */

import { useAccess } from '@/auth/AccessProvider';
import { useText } from '@/i18n/useText';
import { hrefFor } from '../router';

export function ActingServiceBadge() {
  const t = useText();
  const { actingService, canSwitchService } = useAccess();

  // Nothing to say to somebody who can act in only one service.
  if (!canSwitchService || actingService === null) return null;

  return (
    <p className="acting-service-badge muted small" data-testid="acting-service-badge">
      <span className="acting-service-badge__dot" aria-hidden="true" />
      {t.settings.actingServiceCurrent.replace(
        '{service}',
        t.accounts.organizationLabel[actingService],
      )}{' '}
      <a className="acting-service-badge__change" href={hrefFor('podesavanja')}>
        {t.settings.actingServiceChange}
      </a>
    </p>
  );
}
