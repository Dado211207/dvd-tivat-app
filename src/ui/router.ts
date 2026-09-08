/**
 * Minimal hash router.
 *
 * Hash routing keeps the build a plain static folder - no server rewrite rules,
 * so the prototype works on a local HTTP server or static host. Views stay
 * deep-linkable, which browser tests and a live demonstration both need.
 */

import { useEffect, useState } from 'react';

export const ROUTES = ['dojava', 'dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija'] as const;
export type Route = (typeof ROUTES)[number];

/** The application opens into the duty officer's working screen, not a landing page. */
export const DEFAULT_ROUTE: Route = 'dezurni';

function readHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : DEFAULT_ROUTE;
}

/** Reads a non-secret draft hint from the hash. It is never an authority check. */
export function readRouteParam(name: string): string | null {
  const query = window.location.hash.split('?')[1];
  return new URLSearchParams(query ?? '').get(name);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => readHash());

  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export const hrefFor = (route: Route): string => `#/${route}`;
