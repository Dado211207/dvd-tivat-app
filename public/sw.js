/*
 * Service worker for Boka Operativa.
 *
 * ONE RULE ABOVE ALL: this never caches an answer from the server.
 *
 * Every request that is not same-origin is passed straight through, untouched
 * and unrecorded. That covers the whole Supabase API - the call-out, the
 * answers, the attendance, who holds which role. Serving any of that from a
 * cache would put yesterday's roster or a closed intervention in front of
 * somebody at an incident, and a stale answer read as current is worse than an
 * empty screen. The application already says so on its own error states; this
 * file must not quietly contradict it.
 *
 * What it does cache is the shell: the HTML document, the hashed JavaScript and
 * CSS, the icons. Those make the application open instantly on a phone with one
 * bar of signal, and they carry no facts about anybody.
 *
 * The other rule: a new version never swaps itself in under a running page. A
 * commander halfway through publishing a call-out must not have the code
 * change beneath them. The waiting worker sits until the page asks it to take
 * over, which the page only does when the person presses "Osvjezi".
 */

// Bump on any change to this file or to what it caches.
const VERSION = 'v6';
const SHELL = `dvd-tivat-shell-${VERSION}`;

self.addEventListener('install', (event) => {
  // The document is fetched so the application can start from cache next time;
  // everything else arrives through `fetch` as it is actually used.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(new Request('./', { cache: 'reload' })))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('dvd-tivat-shell-') && name !== SHELL)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // Sent by the page when the person presses "Osvjezi", never on our own.
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Push carries no incident detail. A locked phone may be visible to anybody;
// location, title and instructions are fetched only after the app opens and
// the server re-checks the signed-in account.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const interventionId =
    typeof data.interventionId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.interventionId)
      ? data.interventionId
      : null;
  const route = interventionId
    ? `./#/mobilizacija?intervention=${encodeURIComponent(interventionId)}`
    : './#/mobilizacija';

  event.waitUntil(
    self.registration.showNotification('OPERATIVNI POZIV - Boka Operativa', {
      body: 'Nova intervencija. Potvrdite prijem odmah.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: interventionId ? `dvd-call-${interventionId}` : 'dvd-call',
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [400, 150, 400, 150, 700],
      timestamp: typeof data.publishedAt === 'number' ? data.publishedAt : Date.now(),
      data: { route },
      actions: [{ action: 'open', title: 'Otvori poziv' }],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route ?? './#/mobilizacija';
  const destination = new URL(route, self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // ONE window is taken to the call-out, not all of them. Navigating every
      // open tab would yank a commander's console away from what they were
      // doing on the same device. `navigate()` resolves to the client that
      // ended up on the destination, and that is the one to focus - the
      // original reference can be stale afterwards in some browsers.
      const [client] = clients;
      if (client) {
        const moved =
          typeof client.navigate === 'function'
            ? await client.navigate(destination).catch(() => null)
            : null;
        const target = moved ?? client;
        if (typeof target.focus === 'function') return target.focus();
        return undefined;
      }
      return self.clients.openWindow(destination);
    }),
  );
});

/** A document, offline, with nothing cached. It states what it does not know. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="sr-Latn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; style-src 'unsafe-inline'; form-action 'self'">
<meta name="referrer" content="no-referrer">
<title>Boka Operativa - nema veze</title>
<style>
  body { margin:0; padding:2rem 1.25rem; font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
         color:#12202d; background:#edf3f6; }
  main { max-width:32rem; margin:0 auto; background:#fff; padding:1.25rem;
         border:1px solid #dce5eb; border-radius:16px; }
  h1 { font-size:1.15rem; margin:0 0 .5rem; }
  p { margin:0 0 .75rem; }
  button { min-height:44px; padding:.6rem 1rem; font:inherit; font-weight:650; color:#fff;
           background:#077687; border:2px solid #077687; border-radius:10px; cursor:pointer; }
</style></head>
<body><main>
  <h1>Nema veze sa mrezom</h1>
  <p>Aplikacija nije mogla da se ucita jer uredjaj trenutno nema internet.</p>
  <p><strong>Ovo nije kanal za hitne slucajeve.</strong> Kod pozara ili nesrece
     odmah pozovite zvanicnu vatrogasnu sluzbu telefonom.</p>
  <form method="get"><button type="submit">Pokusaj ponovo</button></form>
</main></body></html>`;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Everything the server knows is somebody else's origin. Hands off.
  if (url.origin !== self.location.origin) return;

  // The document: network first, so a deployment is picked up on the next
  // load rather than on the load after that.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put('./', response.clone());
          return response;
        } catch {
          const cached = (await caches.match('./')) ?? (await caches.match(request));
          return (
            cached ??
            new Response(OFFLINE_PAGE, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  // Hashed build assets: the URL changes whenever the bytes do, so a hit is
  // always correct and never stale.
  const hashed = url.pathname.includes('/assets/');
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached && hashed) return cached;

      const network = fetch(request)
        .then(async (response) => {
          if (response.ok && response.type === 'basic') {
            const cache = await caches.open(SHELL);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      // Anything else same-origin - icons, the manifest - is served from cache
      // while a fresh copy is fetched for next time.
      return cached ?? (await network) ?? Response.error();
    })(),
  );
});
