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
import { Notice } from './primitives';

export function ConnectionBar() {
  const online = useOnline();
  const { updateReady, applyUpdate } = useAppUpdate();

  if (!online) {
    return (
      <div data-testid="offline-bar">
        <Notice tone="error">
          <strong>Uredjaj nije na mrezi.</strong> Operativni ekrani ne mogu da procitaju stanje sa
          servera, a sve sto sada unesete nece biti sacuvano. Cim se veza vrati, pokusajte ponovo.
        </Notice>
      </div>
    );
  }

  if (updateReady) {
    return (
      <div data-testid="update-bar">
        <Notice tone="info">
          <strong>Nova verzija je spremna.</strong> Primjenjuje se tek kada vi to zatrazite, da se
          aplikacija ne bi promijenila usred rada.{' '}
          <button type="button" className="btn btn--primary" onClick={applyUpdate}>
            Osvjezi aplikaciju
          </button>
        </Notice>
      </div>
    );
  }

  return null;
}
