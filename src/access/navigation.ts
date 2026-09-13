/**
 * Which destinations to OFFER, and where to land.
 *
 * Display only, like the rest of `src/access/`. Every screen sits behind
 * `OperationalGate` and every command behind a `security definer` function that
 * asks the server again, so nothing here keeps anybody out of anything - a
 * browser that lies about its role still gets refused by PostgreSQL.
 *
 * What it is for is not offering a firefighter the commander's console. Showing
 * somebody a destination and then refusing it is worse than not showing it: it
 * reads as a fault in the application, it wastes a tap during an incident, and
 * during a demonstration it makes the interface look like it does not know who
 * is using it.
 *
 * The lists below MIRROR the `allow` prop each screen passes to its gate. That
 * duplication is deliberate and pinned by a test: if the two ever disagree, the
 * navigation is either hiding something a person may use or offering something
 * they may not, and both are defects.
 */

import type { OperationalRole } from '@/auth/access';
import { ROUTES, type Route } from '@/ui/router';

/**
 * Roles a route is FOR, or 'ANY' for a route that has no role requirement.
 *
 * `nalozi` is 'ANY' on purpose: it holds the sign-in form and the person's own
 * account information. The owner-only account directory inside it is hidden
 * separately, by the screen. Somebody with no role at all has to be able to
 * reach that route or they can never sign in.
 *
 * The prototype routes are 'ANY' because they are a local simulation with no
 * server behind them and no authority of any kind.
 */
export const ROUTE_AUDIENCE: Record<Route, readonly OperationalRole[] | 'ANY'> = {
  // Real, server-backed screens. Each list is its gate's `allow` prop.
  poziv: ['OWNER', 'ADMIN', 'COMMANDER'],
  mobilizacija: ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'],
  arhiva: ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'],
  evidencija: ['OWNER', 'ADMIN'],
  nalozi: 'ANY',

  // The local prototype.
  dojava: 'ANY',
  dezurni: 'ANY',
  clan: 'ANY',
  vozila: 'ANY',
  prikaz: 'ANY',
  clanovi: 'ANY',
  istorija: 'ANY',
};

/**
 * Whether a destination should be offered.
 *
 * A NULL role means the server has not told us one - not signed in, still
 * loading, or unreachable. Everything is offered then, deliberately: a screen
 * that vanishes and reappears while a session is checked is worse than one that
 * explains itself, and somebody who is not signed in needs to be able to see
 * that these screens exist before they can decide to ask for access.
 */
export function isOfferedTo(route: Route, role: OperationalRole | null): boolean {
  if (role === null) return true;
  const audience = ROUTE_AUDIENCE[route];
  return audience === 'ANY' || audience.includes(role);
}

/**
 * The screen to open into.
 *
 * A firefighter opening the application landed on the commander's console and
 * was refused by it, which is the first thing anybody saw. They land on their
 * own call-out screen instead. Command roles keep the console, which is what
 * they open the application to do.
 */
export function landingRouteFor(role: OperationalRole | null): Route {
  return role === 'FIREFIGHTER' ? 'mobilizacija' : 'poziv';
}

/** Every route, in declaration order. Used by the test that pins the table. */
export const ALL_ROUTES: readonly Route[] = ROUTES;
