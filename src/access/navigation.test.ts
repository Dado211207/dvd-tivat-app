/**
 * What each role is offered, and the one thing that must never drift.
 *
 * The navigation table duplicates the `allow` prop of every gated screen. That
 * duplication is the point - the navigation has to make the same decision the
 * gate does - but a duplicate that can silently disagree is worse than no
 * duplicate at all. So the last test here reads the gates out of the source and
 * compares them, and it fails if anybody changes one without the other.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATIONAL_ROLES, type OperationalRole } from '@/auth/access';
import { ROUTES, type Route } from '@/ui/router';
import { NAV_GROUPS, ROUTES_NOT_OFFERED } from '@/App';
import { isOfferedTo, landingRouteFor, ROUTE_AUDIENCE } from './navigation';

/** The routes that read and write the real database behind real authentication. */
const SERVER_BACKED: readonly Route[] = ['poziv', 'mobilizacija', 'arhiva', 'evidencija', 'nalozi'];

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

// ---------------------------------------------------------------------------

/**
 * What the deployed sidebar actually offers.
 *
 * `ROUTE_AUDIENCE` above answers "may this role use it". This block answers the
 * separate question the hosted review asked: "is it in the menu at all" - and
 * the two are not the same. `dojava` was offered to everybody by the audience
 * table AND listed in the sidebar under a heading saying it was unused, which
 * is how a destination this product promises not to have reached a public
 * deployment.
 */
describe('the deployed navigation', () => {
  it('does not offer citizen reporting anywhere', () => {
    const offered = NAV_GROUPS.flatMap((group) => group.routes);
    expect(offered, 'Prijava gradjana must not be a destination').not.toContain('dojava');
    // Not by relegating it to a heading either. "Nije u upotrebi" was exactly
    // that, and somebody still tapped it - which is also why the groups are now
    // keyed by task rather than named after a state a destination is in.
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(['work', 'society']);
  });

  it('keeps the route resolvable rather than deleting the screen', () => {
    // The distinction the brief insists on: not offered is not the same as
    // removed. An old link must still land somewhere that explains itself
    // instead of on a blank page, and the reviewed work stays in the tree.
    expect(ROUTES as readonly Route[]).toContain('dojava');
    expect(existsSync(resolve(process.cwd(), 'src/ui/views/CitizenReportView.tsx'))).toBe(true);
  });

  it('says on that screen that it is not an emergency channel', () => {
    // The only reason it is safe to leave the route reachable.
    const source = readFileSync(
      resolve(process.cwd(), 'src/ui/views/CitizenReportView.tsx'),
      'utf8',
    );
    expect(source).toMatch(/nije kanal za hitne slucajeve/i);
  });

  it('never mixes a simulation into the operational group', () => {
    const operational = NAV_GROUPS.find((group) => group.key === 'work');
    expect(operational, 'the operational group must exist').toBeDefined();
    for (const route of operational?.routes ?? []) {
      expect(
        SERVER_BACKED,
        `${route} is offered as operational but is not server-backed`,
      ).toContain(route);
    }
  });

  it('offers no simulation at all in the main navigation', () => {
    /*
     * Stronger than the rule it replaces, and for a reason.
     *
     * The old arrangement kept the station display in the rail on the argument
     * that it duplicated nothing server-backed. True, and beside the point: a
     * group label is not a separation, so during a demonstration it was one tap
     * from a real call-out to a fictional screen, and afterwards nobody could
     * say which they had been looking at.
     *
     * Every simulation now lives behind a closed disclosure on Settings -
     * routes intact, code intact, each screen still announcing itself - which
     * is somewhere nobody passes through while running an intervention.
     */
    const offered = NAV_GROUPS.flatMap((group) => group.routes);
    for (const route of ['dezurni', 'clan', 'vozila', 'clanovi', 'istorija', 'prikaz'] as Route[]) {
      expect(offered, `${route} is a simulation and must not be in the rail`).not.toContain(route);
    }
  });

  it('still leads to the simulation from settings rather than deleting it', () => {
    // Not offered is not the same as removed. Reviewed work stays in the tree
    // and stays reachable; what changed is how deliberate reaching it has to be.
    const settings = readFileSync(
      resolve(process.cwd(), 'src/ui/views/SettingsView.tsx'),
      'utf8',
    );
    for (const route of ['prikaz', 'dezurni', 'clan', 'clanovi', 'vozila', 'istorija']) {
      expect(settings, `${route} must stay reachable from settings`).toContain(`'${route}'`);
    }
    // With the one exception, for the one reason that outranks completeness.
    expect(settings, 'citizen reporting must not be offered anywhere').not.toContain("'dojava'");
  });

  it('accounts for every route exactly once', () => {
    // A route added without a decision is the failure mode this catches: it
    // would be neither offered nor listed as deliberately withheld, and the
    // sums below would not add up.
    const offered = NAV_GROUPS.flatMap((group) => group.routes);
    const accounted = [...offered, ...ROUTES_NOT_OFFERED].sort();
    expect(accounted).toEqual([...ROUTES].sort());
    expect(new Set(accounted).size, 'no route may be listed twice').toBe(ROUTES.length);
  });

  it('leaves server authorization untouched by any of this', () => {
    // The navigation is display only. Every one of these routes still sits
    // behind its gate and every command behind a `security definer` function,
    // so withholding a menu entry changes what is OFFERED and nothing about
    // what is ALLOWED.
    for (const route of ROUTES_NOT_OFFERED) {
      expect(ROUTE_AUDIENCE[route], `${route} keeps its audience entry`).toBeDefined();
    }
    expect(ROUTE_AUDIENCE.poziv).toEqual(['OWNER', 'ADMIN', 'COMMANDER']);
  });
});
