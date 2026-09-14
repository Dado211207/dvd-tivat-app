/**
 * The service worker's one promise, tested by running it.
 *
 * `public/sw.js` may never cache an answer from the Supabase API. If it ever
 * did, a phone could show yesterday's roster, a closed intervention, or a role
 * somebody no longer holds, and show it as if it were current - at an incident,
 * to somebody deciding what to do. Every other nicety in that file is worth
 * losing before this one.
 *
 * It is asserted by loading the real file into a fake worker scope and pushing
 * events through it, rather than by reading the source and hoping. A reviewer
 * changing that file will find out here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

const ORIGIN = 'https://example.test';

interface FetchEvent {
  request: Request;
  respondWith: (response: unknown) => void;
}

/** A minimal worker global, enough for the handlers the file registers. */
function loadWorker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const cachePut = vi.fn();
  const cacheAdd = vi.fn();
  const showNotification = vi.fn(
    async (
      _title: string,
      _options: NotificationOptions & {
        renotify?: boolean;
        silent?: boolean;
        data?: { route?: string };
      },
    ) => undefined,
  );

  const scope = {
    location: new URL(`${ORIGIN}/app/`),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers.set(type, handler);
    },
    skipWaiting: vi.fn(),
    registration: { scope: `${ORIGIN}/app/`, showNotification },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    caches: {
      open: vi.fn(async () => ({ put: cachePut, add: cacheAdd })),
      match: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    },
    fetch: vi.fn(async () => new Response('ok', { status: 200 })),
  };

  // The file is written against `self`; give it one and nothing else.
  const run = new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', SW_SOURCE);
  run(scope, scope.caches, scope.fetch, Request, Response, URL);

  return { handlers, scope, cachePut, cacheAdd, showNotification };
}

function fetchEvent(
  url: string,
  init: RequestInit & { navigate?: boolean } = {},
): FetchEvent & { responded: boolean } {
  const { navigate, ...rest } = init;
  const request = new Request(url, rest);
  // Only a browser may construct a request with mode "navigate", so a document
  // request is made by overriding the property the worker actually reads.
  if (navigate === true) Object.defineProperty(request, 'mode', { value: 'navigate' });

  const event = {
    request,
    responded: false,
    respondWith(_response: unknown) {
      event.responded = true;
    },
  };
  return event;
}

describe('the service worker never caches what the server said', () => {
  let worker: ReturnType<typeof loadWorker>;

  beforeEach(() => {
    worker = loadWorker();
  });

  it('registers the handlers it is meant to', () => {
    expect([...worker.handlers.keys()].sort()).toEqual(
      ['activate', 'fetch', 'install', 'message', 'notificationclick', 'push'].sort(),
    );
  });

  it.each([
    'https://abcdefgh.supabase.co/rest/v1/interventions?select=*',
    'https://abcdefgh.supabase.co/auth/v1/token?grant_type=password',
    'https://abcdefgh.supabase.co/rest/v1/rpc/attendance_totals',
    'https://tile.openstreetmap.org/12/2000/1000.png',
  ])('does not even answer a cross-origin request: %s', (url) => {
    const event = fetchEvent(url);
    worker.handlers.get('fetch')!(event);

    // Not "answered from the network" - not answered at all. The worker steps
    // out of the way entirely, so there is no path by which it could store it.
    expect(event.responded).toBe(false);
    expect(worker.cachePut).not.toHaveBeenCalled();
  });

  it('does not handle a same-origin write either', () => {
    const event = fetchEvent(`${ORIGIN}/app/anything`, { method: 'POST' });
    worker.handlers.get('fetch')!(event);
    expect(event.responded).toBe(false);
  });

  it('does answer for its own shell', () => {
    const asset = fetchEvent(`${ORIGIN}/app/assets/index-abc123.js`);
    worker.handlers.get('fetch')!(asset);
    expect(asset.responded).toBe(true);

    const document_ = fetchEvent(`${ORIGIN}/app/`, { navigate: true });
    worker.handlers.get('fetch')!(document_);
    expect(document_.responded).toBe(true);
  });

  it('takes over only when the page asks', () => {
    worker.handlers.get('message')!({ data: 'ANYTHING_ELSE' });
    expect(worker.scope.skipWaiting).not.toHaveBeenCalled();

    worker.handlers.get('message')!({ data: 'SKIP_WAITING' });
    expect(worker.scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('says what it cannot know when it has nothing cached', () => {
    // The offline document must not imply the application is usable, and must
    // point at the telephone rather than at itself.
    expect(SW_SOURCE).toMatch(/nije kanal za hitne slucajeve/i);
    expect(SW_SOURCE).toMatch(/pozovite zvanicnu vatrogasnu sluzbu/i);
  });

  it('shows an urgent but privacy-safe notification for a pushed call-out', async () => {
    let work: Promise<unknown> | undefined;
    worker.handlers.get('push')!({
      data: {
        json: () => ({
          interventionId: '11111111-1111-4111-8111-111111111111',
          publishedAt: 1_800_000_000_000,
          title: 'must not appear',
          location: 'must not appear',
        }),
      },
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    await work;

    expect(worker.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = worker.showNotification.mock.calls[0]!;
    expect(title).toBe('OPERATIVNI POZIV - DVD Tivat');
    expect(options.body).toBe('Nova intervencija. Potvrdite prijem odmah.');
    expect(JSON.stringify(options)).not.toMatch(/must not appear/);
    expect(options.data.route).toContain('11111111-1111-4111-8111-111111111111');
    expect(options.renotify).toBe(true);
    expect(options.silent).toBe(false);
  });

  it('opens the exact protected call-out when the notification is pressed', async () => {
    const route = './#/mobilizacija?intervention=11111111-1111-4111-8111-111111111111';
    let work: Promise<unknown> | undefined;
    const close = vi.fn();
    worker.handlers.get('notificationclick')!({
      notification: { close, data: { route } },
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    await work;

    expect(close).toHaveBeenCalledTimes(1);
    expect(worker.scope.clients.openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/app/#/mobilizacija?intervention=11111111-1111-4111-8111-111111111111`,
    );
  });
});
