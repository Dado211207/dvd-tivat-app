/**
 * The other way the screen could throw away what somebody had typed.
 *
 * `src/ui/components/resume-stability.test.tsx` covers the React half of the
 * reported "it reloads when I come back": a silent remount inside the
 * application. This file covers the half that would be a REAL reload, and it
 * has to tell apart the two moments a controller can change:
 *
 *   A FRESH VISIT. The very first service worker calls `clients.claim()` during
 *   its own activation, moments after the first ever page load. That fires
 *   `controllerchange` with nobody having asked for anything. Reloading there
 *   discards whatever the person has already typed, on their first use of the
 *   application, and loads the same version again - there is nothing newer,
 *   because that worker IS the first version.
 *
 *   AN ALREADY-CONTROLLED CLIENT. A second worker is waiting, the person
 *   presses "Osvjezi aplikaciju", it skips waiting and takes control. That
 *   controller change was asked for, and reloading is the point of it.
 *
 * The guard between them is one module-level flag - exactly the sort of thing a
 * later refactor removes as redundant. Both directions are asserted, because a
 * test that only checked the fresh visit would pass on a module that never
 * reloads at all.
 *
 * TWO AWKWARD FACTS about the environment, worked around rather than papered
 * over, because both changed how this file is written:
 *
 *   `location.reload` is not configurable in jsdom, so it cannot be spied on.
 *   The whole `window` has to be substituted to observe a reload at all.
 *
 *   React needs the real `window`. So `useAppUpdate` is rendered FIRST, with
 *   the real one, and its `applyUpdate` is kept - it closes over module state
 *   and reads it when called, so it still works after the substitution. That
 *   ordering is the only reason this file looks the way it does.
 *
 * AND ONE TRAP, caught while writing this. `registerServiceWorker` returns
 * immediately when `import.meta.env.DEV` is true - which it is under Vitest by
 * default. The first version of this file therefore registered nothing, and the
 * two "does not reload" tests passed for the worst possible reason: there was
 * no handler to reload. `vi.stubEnv('DEV', false)` fixes it, and
 * `expectItActuallyRegistered()` makes the vacuous version fail loudly if the
 * early return ever comes back.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Waiting {
  postMessage: ReturnType<typeof vi.fn>;
}

interface Registration {
  waiting: Waiting | null;
  installing: null;
  addEventListener: ReturnType<typeof vi.fn>;
}

let registration: Registration;
let controllerChangeHandlers: (() => void)[];
let loadHandlers: (() => void)[];
let reload: ReturnType<typeof vi.fn>;

/**
 * Substitutes the service worker container and the reload.
 *
 * `controller` is what decides everything: null is a first visit, an object is
 * a client a worker is already controlling.
 */
function install(controller: object | null, waiting: Waiting | null): void {
  controllerChangeHandlers = [];
  loadHandlers = [];
  registration = { waiting, installing: null, addEventListener: vi.fn() };
  reload = vi.fn();

  vi.stubGlobal('navigator', {
    onLine: true,
    serviceWorker: {
      controller,
      register: vi.fn(async () => registration),
      addEventListener: (type: string, handler: () => void) => {
        if (type === 'controllerchange') controllerChangeHandlers.push(handler);
      },
    },
  });
  vi.stubGlobal('window', {
    location: { href: 'https://example.invalid/dvd-tivat-app/', reload },
    addEventListener: (type: string, handler: () => void) => {
      if (type === 'load') loadHandlers.push(handler);
    },
    removeEventListener: () => {},
  });
}

/** The page finishes loading, and the module's registration settles. */
async function pageLoads(): Promise<void> {
  for (const handler of loadHandlers) handler();
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

/** A worker takes control, for whatever reason. */
function controllerChanges(): void {
  for (const handler of controllerChangeHandlers) handler();
}

/**
 * Renders `useAppUpdate` and keeps the one action it exposes.
 *
 * Must be called BEFORE the globals are substituted, because React needs the
 * real `window`. The returned function closes over module state and reads it
 * when called, so pressing it later - after the substitution, and after the
 * module has learnt about a waiting worker - still does the right thing.
 *
 * Driven through a render rather than reaching into the module because this is
 * exactly how the interface uses it: a change that broke the wiring between the
 * button and the worker would fail here too.
 */
function captureTheUpdateButton(useAppUpdate: () => { applyUpdate: () => void }): () => void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let apply: (() => void) | null = null;

  function Probe() {
    apply = useAppUpdate().applyUpdate;
    return null;
  }

  act(() => root.render(createElement(Probe)));
  act(() => root.unmount());
  host.remove();

  if (apply === null) throw new Error('useAppUpdate did not render');
  return apply;
}

beforeEach(() => {
  vi.resetModules();
  // Without this the module returns before registering anything, and every
  // assertion below becomes "nothing happened, so nothing bad happened".
  vi.stubEnv('DEV', false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Proof that there was something to observe in the first place. */
function expectItActuallyRegistered(): void {
  expect(
    controllerChangeHandlers.length,
    'the module registered no controllerchange handler, so this test proves nothing',
  ).toBeGreaterThan(0);
}

describe('a fresh visit', () => {
  it('does not reload when the first worker claims the page', async () => {
    // No controller: somebody's first ever visit. The worker installs,
    // activates, calls `clients.claim()`, and the page is suddenly controlled -
    // through no action of the person sitting in front of it.
    const { registerServiceWorker } = await import('./pwa');
    install(null, null);
    registerServiceWorker();
    await pageLoads();
    expectItActuallyRegistered();

    controllerChanges();

    expect(
      reload,
      'reloading here discards a half-typed call-out on a first visit, to load the same version again',
    ).not.toHaveBeenCalled();
  });

  it('does not reload even if the update button is somehow pressed', async () => {
    // A worker that installs with no controller is the FIRST one, so nothing
    // is announced as waiting and `applyUpdate` has nobody to ask. Pressing it
    // must therefore be inert rather than arming a reload for the next
    // controller change.
    const pwa = await import('./pwa');
    const press = captureTheUpdateButton(pwa.useAppUpdate);

    install(null, null);
    pwa.registerServiceWorker();
    await pageLoads();
    expectItActuallyRegistered();

    press();
    controllerChanges();

    expect(reload, 'there is no newer version to load').not.toHaveBeenCalled();
  });
});

describe('a client a worker is already controlling', () => {
  it('reloads only after the person asks for the waiting version', async () => {
    const pwa = await import('./pwa');
    const press = captureTheUpdateButton(pwa.useAppUpdate);

    const postMessage = vi.fn();
    install({}, { postMessage });
    pwa.registerServiceWorker();
    await pageLoads();
    expectItActuallyRegistered();

    // A controller change BEFORE anybody asked - a second tab taking the
    // update, say - must still not reload this one out from under its user.
    controllerChanges();
    expect(reload, 'nobody asked yet').not.toHaveBeenCalled();

    press();
    expect(postMessage, 'the waiting worker is told to take over').toHaveBeenCalledWith(
      'SKIP_WAITING',
    );
    // Pressing the button does not reload by itself: reloading before the new
    // worker has control would just load the old version again.
    expect(reload).not.toHaveBeenCalled();

    controllerChanges();
    expect(reload, 'the reload is the point of having asked').toHaveBeenCalledTimes(1);
  });

  it('reloads once, not once per controller change', async () => {
    const pwa = await import('./pwa');
    const press = captureTheUpdateButton(pwa.useAppUpdate);

    install({}, { postMessage: vi.fn() });
    pwa.registerServiceWorker();
    await pageLoads();
    expectItActuallyRegistered();
    press();

    controllerChanges();
    controllerChanges();
    controllerChanges();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no waiting worker to ask', async () => {
    const pwa = await import('./pwa');
    const press = captureTheUpdateButton(pwa.useAppUpdate);

    install({}, null);
    pwa.registerServiceWorker();
    await pageLoads();
    expectItActuallyRegistered();

    press();
    controllerChanges();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('a browser without service workers', () => {
  it('registers nothing and breaks nothing', async () => {
    const { registerServiceWorker } = await import('./pwa');
    vi.stubGlobal('navigator', { onLine: true });
    expect(() => registerServiceWorker()).not.toThrow();
  });
});
