/**
 * Minimal hash router.
 *
 * Hash routing keeps the build a plain static folder - no server rewrite rules,
 * so the app works on a local HTTP server or static host. Operational views stay
 * deep-linkable, which browser tests and a live demonstration both need.
 */

import { useEffect, useState } from 'react';

export const ROUTES = [
  // Real, server-backed operational screens.
  'poziv',
  'mobilizacija',
  'arhiva',
  'evidencija',
  'nalozi',
  // This device's own settings. No server, and deliberately no role check: the
  // person most in need of a refusal message they can read is the one who has
  // been refused, so the language cannot sit behind the gate.
  'podesavanja',
  // The local prototype. Device-local fictional state, no server, no authority.
  'dojava',
  'dezurni',
  'clan',
  'vozila',
  'prikaz',
  'clanovi',
  'istorija',
] as const;
export type Route = (typeof ROUTES)[number];

/**
 * The application opens into the commander's real console, not a landing page
 * and not the simulation.
 *
 * Somebody who is not signed in lands on a screen that says so and offers the
 * way in, which is the correct first screen for a real tool. Opening into the
 * local prototype instead would put a fictional actor selector in front of a
 * person before anything has established who they are.
 */
export const DEFAULT_ROUTE: Route = 'poziv';

/** Historical simulation is available only in explicitly opted-in review builds. */
export const prototypeEnabled = (): boolean => import.meta.env.VITE_PROTOTYPE_ENABLED === 'true';

export const PROTOTYPE_ROUTES: readonly Route[] = [
  'dojava', 'dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija',
];

export function resolveRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (!(ROUTES as readonly string[]).includes(raw)) return DEFAULT_ROUTE;
  if (!prototypeEnabled() && PROTOTYPE_ROUTES.includes(raw as Route)) return DEFAULT_ROUTE;
  return raw as Route;
}

/** Reads a non-secret draft hint from the hash. It is never an authority check. */
export function readRouteParam(name: string): string | null {
  const query = window.location.hash.split('?')[1];
  return new URLSearchParams(query ?? '').get(name);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => resolveRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(resolveRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export const hrefFor = (route: Route): string => `#/${route}`;
