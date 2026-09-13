/**
 * What each role is offered, and the one thing that must never drift.
 *
 * The navigation table duplicates the `allow` prop of every gated screen. That
 * duplication is the point - the navigation has to make the same decision the
 * gate does - but a duplicate that can silently disagree is worse than no
 * duplicate at all. So the last test here reads the gates out of the source and
 * compares them, and it fails if anybody changes one without the other.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATIONAL_ROLES, type OperationalRole } from '@/auth/access';
import { ROUTES, type Route } from '@/ui/router';
import { isOfferedTo, landingRouteFor, ROUTE_AUDIENCE } from './navigation';

describe('what a firefighter is offered', () => {
  it('is not offered the commander console', () => {
    // The device test: a firefighter could see and open "Poziv", and was then
    // refused by it. Showing a destination and rejecting it reads as a fault.
    expect(isOfferedTo('poziv', 'FIREFIGHTER')).toBe(false);
  });

  it('is not offered the society records screen', () => {
    expect(isOfferedTo('evidencija', 'FIREFIGHTER')).toBe(false);
  });

  it('keeps their own call-out, the archive and their own account', () => {
    expect(isOfferedTo('mobilizacija', 'FIREFIGHTER')).toBe(true);
    expect(isOfferedTo('arhiva', 'FIREFIGHTER')).toBe(true);
    // Their own account information lives here, and so does signing in.
    expect(isOfferedTo('nalozi', 'FIREFIGHTER')).toBe(true);
  });

  it('opens into their own call-out rather than a screen that refuses them', () => {
    expect(landingRouteFor('FIREFIGHTER')).toBe('mobilizacija');
  });
});

describe('what command is offered', () => {
  it.each(['OWNER', 'ADMIN', 'COMMANDER'] as const)('%s gets the console', (role) => {
    expect(isOfferedTo('poziv', role)).toBe(true);
    expect(landingRouteFor(role)).toBe('poziv');
  });

  it('only the owner and administrator get the society records', () => {
    expect(isOfferedTo('evidencija', 'OWNER')).toBe(true);
    expect(isOfferedTo('evidencija', 'ADMIN')).toBe(true);
    expect(isOfferedTo('evidencija', 'COMMANDER')).toBe(false);
  });

  it('command turns out too, so they keep the call-out screen', () => {
    // The same decision the eligibility rule makes on the server: in a
    // volunteer society the commander attends incidents like everybody else.
    for (const role of ['OWNER', 'ADMIN', 'COMMANDER'] as const) {
      expect(isOfferedTo('mobilizacija', role)).toBe(true);
    }
  });
});

describe('when the server has not said who you are', () => {
  it('offers everything rather than a shrinking menu', () => {
    // Null is "not signed in, still loading, or unreachable" - never "no
    // access". A navigation that appears and disappears while a session is
    // checked is worse than one that explains itself at the gate, and somebody
    // signing in for the first time has to be able to see these screens exist.
    for (const route of ROUTES) {
      expect(isOfferedTo(route, null), route).toBe(true);
    }
  });
});

describe('the table stays in step with the gates', () => {
  it('has an entry for every route', () => {
    // A route added without a decision here would default to invisible or
    // visible depending on how the lookup was written. Neither is a decision.
    for (const route of ROUTES) {
      expect(ROUTE_AUDIENCE[route], route).toBeDefined();
    }
    expect(Object.keys(ROUTE_AUDIENCE).sort()).toEqual([...ROUTES].sort());
  });

  /**
   * The real check: every gated screen's `allow` prop, read from its source.
   *
   * `OperationalGate allow={[...]}` and `RequireRole allow={[...]}` are both
   * matched, because `nalozi` uses the second one for its owner-only section.
   */
  it('offers exactly what each screen will actually accept', () => {
    const GATED: Record<string, Route> = {
      'CommandView.tsx': 'poziv',
      'MobilisationView.tsx': 'mobilizacija',
      'ArchiveView.tsx': 'arhiva',
      'OrganisationView.tsx': 'evidencija',
    };

    const checked: string[] = [];
    for (const [file, route] of Object.entries(GATED)) {
      const source = readFileSync(resolve(process.cwd(), 'src/ui/views', file), 'utf8');
      const match = /allow=\{\[([^\]]*)\]\}/.exec(source);
      expect(match, `${file} must pass an allow list`).not.toBeNull();

      const gateRoles = [...(match?.[1] ?? '').matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
      const audience = ROUTE_AUDIENCE[route];
      expect(
        audience === 'ANY' ? 'ANY' : [...audience].sort(),
        `the navigation offers ${route} to a different set than ${file} accepts`,
      ).toEqual([...gateRoles].sort());
      checked.push(file);
    }

    // If the regular expression ever stops matching, every comparison above
    // becomes a comparison of two empty lists and passes while proving nothing.
    expect(checked, 'every gated screen must have been read').toHaveLength(4);
  });

  it('never offers a role something outside the four the server knows', () => {
    for (const route of ROUTES) {
      const audience = ROUTE_AUDIENCE[route];
      if (audience === 'ANY') continue;
      for (const role of audience) {
        expect(OPERATIONAL_ROLES as readonly OperationalRole[]).toContain(role);
      }
    }
  });

  it('leaves a route nobody can reach impossible to create by accident', () => {
    // Every route must be offered to at least one role, or it is dead code
    // behind a live URL.
    for (const route of ROUTES as readonly Route[]) {
      const reachable = OPERATIONAL_ROLES.some((role) => isOfferedTo(route, role));
      expect(reachable, `${route} is offered to nobody`).toBe(true);
    }
  });
});
