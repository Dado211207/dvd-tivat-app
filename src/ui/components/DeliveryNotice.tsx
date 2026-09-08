/**
 * The honesty notice.
 *
 * This is not boilerplate. A convincing demonstration invites exactly one wrong
 * conclusion - that the phones rang - and the only defence is to say plainly, on
 * the screen showing the call, that nothing was sent.
 */

import { Notice } from './primitives';

export function DeliveryNotice() {
  return (
    <Notice tone="warn">
      <strong>Isporuka nije pokusana.</strong> Prototip nema servis za obavjestenja: nijedna poruka,
      SMS ni poziv nisu poslati. Odzivi ispod postoje samo ako ih neko unese kroz simulaciju clana.
    </Notice>
  );
}
