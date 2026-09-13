/**
 * Installing the service worker, and telling the page when a new version is
 * waiting.
 *
 * The worker is never allowed to take over on its own. `useAppUpdate` reports
 * that one is waiting; the person presses a button; only then does the page ask
 * it to activate and reload. Swapping the code under somebody halfway through
 * publishing a call-out is not a risk worth the convenience.
 *
 * Registration is best-effort by design. An unsupported browser, a private
 * window, a blocked worker - all of it leaves the application working exactly
 * as it does today, just without an offline shell.
 */

import { useEffect, useState } from 'react';

let waitingWorker: ServiceWorker | null = null;
const listeners = new Set<(waiting: boolean) => void>();

/**
 * Whether the person has asked for the waiting version.
 *
 * This is the difference between the two reasons a controller can change. The
 * FIRST worker takes control by calling `clients.claim()` during its own
 * activation, which happens moments after the very first visit - reloading
 * there would throw away whatever the person had already typed, for no reason
 * at all, on their first ever use of the application. Only a controller change
 * that follows a deliberate "Osvjezi aplikaciju" is worth a reload.
 */
let updateRequested = false;

function announce(worker: ServiceWorker | null): void {
  waitingWorker = worker;
  for (const listener of listeners) listener(worker !== null);
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // A dev server serves modules the worker has no business caching, and a
  // stale worker there is a debugging trap rather than a feature.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    // Relative to the document, so this works under a sub-path such as a
    // project page, not only at a domain root.
    const url = new URL('sw.js', window.location.href.split('#')[0]);

    void navigator.serviceWorker
      .register(url, { updateViaCache: 'none' })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          announce(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (installing === null) return;
          installing.addEventListener('statechange', () => {
            // A worker that reaches `installed` with no controller is the FIRST
            // one: there is nothing to update from, so there is nothing to say.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing);
            }
          });
        });
      })
      .catch(() => {
        // Nothing to recover: the application works without it.
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateRequested || reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

/** Whether a new version is waiting, and the one action that takes it. */
export function useAppUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const [updateReady, setUpdateReady] = useState(waitingWorker !== null);

  useEffect(() => {
    listeners.add(setUpdateReady);
    return () => {
      listeners.delete(setUpdateReady);
    };
  }, []);

  return {
    updateReady,
    applyUpdate: () => {
      if (waitingWorker === null) return;
      updateRequested = true;
      // The page reloads on `controllerchange`, not here: reloading before the
      // new worker has taken control would just load the old version again.
      waitingWorker.postMessage('SKIP_WAITING');
    },
  };
}

/**
 * Whether the device believes it is online.
 *
 * `navigator.onLine` is famously optimistic - it reports a connected Wi-Fi with
 * no route to anywhere as online - so this is only ever used to explain a
 * failure that has already happened, never to decide whether to try.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
