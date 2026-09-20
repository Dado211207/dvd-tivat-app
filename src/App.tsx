/**
 * Application shell.
 *
 * ---------------------------------------------------------------------------
 * THE NAVIGATION IS ORGANISED BY TASK, NOT BY TABLE
 * ---------------------------------------------------------------------------
 *
 * It used to be three labelled groups - Operativa, Evidencija drustva, Prototip
 * (simulacija) - which for a firefighter meant three headings standing over a
 * total of three links, each heading taking as much vertical space as the link
 * it introduced. A group of one is not a group; it is a caption.
 *
 * Two groups now, named after what somebody came here to do:
 *
 *   RAD       - the call-out and its record. Everything an incident touches.
 *   DRUSTVO   - the society's own books: members, vehicles, accounts, settings.
 *
 * and the simulation is no longer among them at all - see below.
 *
 * ---------------------------------------------------------------------------
 * THE SIMULATION IS NOT IN THE NAVIGATION
 * ---------------------------------------------------------------------------
 *
 * It used to sit in the same rail as the real screens, under a group label
 * reading "Prototip (simulacija)". A label is not a separation: during a
 * demonstration it is one tap from a real call-out to a fictional one, and the
 * two look alike enough that afterwards nobody can say which they were looking
 * at.
 *
 * The prototype screens are reached from Settings now - deliberately somewhere
 * nobody passes through while running an intervention. Routes and code are
 * untouched: an old link still resolves, and every one of those screens still
 * opens on its own notice saying what it is. Deleting reviewed work to tidy a
 * menu would be a worse answer than not offering it.
 *
 * Citizen reporting is the same decision for a stronger reason. `dojava` is an
 * abandoned research prototype, and this application must never read as a way
 * to report a fire - the official emergency telephone number is the only one
 * that is. The route resolves and refuses; the destination is not offered.
 */

import type { RoleId } from '@/domain/types';
import { lazy, Suspense, useEffect, useRef, type ComponentType } from 'react';
import { ROLE_LABEL } from '@/i18n/labels';
import { useText } from '@/i18n/useText';
import { accessObstacle } from '@/auth/access';
import { isOfferedTo, landingRouteFor } from '@/access/navigation';
import { useAccess } from '@/auth/AccessProvider';
import { makeId, useApp } from '@/state/AppStateContext';
import { ConnectionBar } from './ui/components/ConnectionBar';
import { LiveRegion, VisibleNotice } from './ui/components/LiveRegion';
import { Notice } from './ui/components/primitives';
import { NavIcon } from './ui/components/NavIcon';
import { DEFAULT_ROUTE, hrefFor, useRoute, type Route } from './ui/router';
import { DispatcherView } from './ui/views/DispatcherView';
import { DisplayView } from './ui/views/DisplayView';
import { HistoryView } from './ui/views/HistoryView';
import { MemberView } from './ui/views/MemberView';
import { RosterView } from './ui/views/RosterView';
import { SettingsView } from './ui/views/SettingsView';
import { VehiclesView } from './ui/views/VehiclesView';

const CitizenReportView = lazy(() =>
  import('./ui/views/CitizenReportView').then((module) => ({ default: module.CitizenReportView })),
);
const AccountsView = lazy(() =>
  import('./ui/views/AccountsView').then((module) => ({ default: module.AccountsView })),
);
const OrganisationView = lazy(() =>
  import('./ui/views/OrganisationView').then((module) => ({ default: module.OrganisationView })),
);
const CommandView = lazy(() =>
  import('./ui/views/CommandView').then((module) => ({ default: module.CommandView })),
);
const MobilisationView = lazy(() =>
  import('./ui/views/MobilisationView').then((module) => ({ default: module.MobilisationView })),
);
const ArchiveView = lazy(() =>
  import('./ui/views/ArchiveView').then((module) => ({ default: module.ArchiveView })),
);

const VIEWS: Record<Route, ComponentType> = {
  poziv: CommandView,
  mobilizacija: MobilisationView,
  arhiva: ArchiveView,
  podesavanja: SettingsView,
  dojava: CitizenReportView,
  dezurni: DispatcherView,
  clan: MemberView,
  vozila: VehiclesView,
  prikaz: DisplayView,
  clanovi: RosterView,
  evidencija: OrganisationView,
  nalozi: AccountsView,
  istorija: HistoryView,
};

/** What the deployed application offers, grouped by the task somebody came to do. */
export const NAV_GROUPS: { key: 'work' | 'society'; routes: Route[] }[] = [
  { key: 'work', routes: ['poziv', 'mobilizacija', 'arhiva'] },
  { key: 'society', routes: ['evidencija', 'nalozi', 'podesavanja'] },
];

/**
 * Routes that exist and resolve, but are deliberately not offered here.
 *
 * Kept as a named list rather than as an absence, so that the reasons above are
 * attached to something a test can assert against - and so that adding a route
 * without deciding whether it belongs in the navigation fails that test rather
 * than quietly appearing in the rail.
 */
export const ROUTES_NOT_OFFERED: readonly Route[] = [
  'dojava',
  'dezurni',
  'clan',
  'vozila',
  'prikaz',
  'clanovi',
  'istorija',
];

/**
 * Which screens are real, and which are still the local simulation.
 *
 * The operational slice is server-backed: a call-out, a firefighter's answer,
 * attendance and the archive all read and write the real database behind real
 * authentication. What remains simulated is the earlier prototype, and the
 * interface has to say so on every one of those screens rather than letting a
 * demonstration imply that a server is involved.
 *
 * Settings is neither. It changes nothing on a server and pretends nothing: it
 * is this browser's own state, so it carries no badge of either kind.
 */
const ROUTE_BACKING: Record<Route, 'SERVER' | 'SIMULATED' | 'DEVICE'> = {
  poziv: 'SERVER',
  mobilizacija: 'SERVER',
  arhiva: 'SERVER',
  nalozi: 'SERVER',
  evidencija: 'SERVER',
  podesavanja: 'DEVICE',
  dojava: 'SIMULATED',
  dezurni: 'SIMULATED',
  clan: 'SIMULATED',
  vozila: 'SIMULATED',
  prikaz: 'SIMULATED',
  clanovi: 'SIMULATED',
  istorija: 'SIMULATED',
};

/**
 * The real signed-in account, shown next to - and deliberately unlike - the
 * simulation control beside it. One of them is a server-confirmed identity; the
 * other switches which fictional person the local prototype pretends to be. They
 * must never look like the same kind of thing.
 */
function SignedInIdentity() {
  const t = useText();
  const { access } = useAccess();
  const obstacle = accessObstacle(access);

  if (obstacle === 'NOT_CONFIGURED') {
    return <span className="local-pill"><span aria-hidden="true" /> {t.shell.identityNotConfigured}</span>;
  }
  if (obstacle === 'LOADING') {
    return <span className="identity-pill" role="status">{t.shell.identityLoading}</span>;
  }
  if (access.kind === 'SIGNED_IN') {
    return (
      <a className="identity-pill identity-pill--in" href={hrefFor('nalozi')}>
        <span className="identity-pill__who">{access.fullName ?? access.email}</span>
        <span className="identity-pill__role">
          {access.role
            ? (t.vocabulary.role[access.role] ?? access.role)
            : obstacle === 'SUSPENDED' ? t.shell.identitySuspended : t.shell.identityNoRole}
        </span>
      </a>
    );
  }
  return (
    <a className="identity-pill" href={hrefFor('nalozi')}>
      {obstacle === 'SERVER_UNREACHABLE' ? t.shell.identityServerUnreachable : t.shell.identityNotSignedIn}
    </a>
  );
}

export function App() {
  const t = useText();
  const route = useRoute();
  const { state, run, storageWarning } = useApp();
  const { access } = useAccess();
  const View = VIEWS[route];
  const mainRef = useRef<HTMLElement>(null);

  const current = state.members.find((m) => m.id === state.simulation.actorId);
  const backing = ROUTE_BACKING[route];
  const simulated = backing === 'SIMULATED';

  /**
   * The navigation identity, kept distinct from server authority.
   *
   * A loaded signed-in account with no DVD role is a limited citizen. Null is
   * reserved for signed out, loading or unreachable states, where shrinking
   * the menu before the server answers would make the interface flicker.
   */
  const navigationRole =
    access.kind === 'SIGNED_IN' ? (access.role ?? 'CITIZEN') : null;

  /**
   * Open into a screen the person can actually use.
   *
   * A firefighter used to land on the commander's console and be refused by it,
   * which was the first thing they saw. This only acts when NO route was asked
   * for - an empty hash - so a shared link, the back button and a reload all
   * keep their route.
   */
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || navigationRole === null) return;
    landed.current = true;
    const asked = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
    if (asked !== '') return;
    const landing = landingRouteFor(navigationRole);
    if (landing !== DEFAULT_ROUTE) window.location.replace(hrefFor(landing));
  }, [navigationRole]);

  const groupLabel = { work: t.nav.groupWork, society: t.nav.groupSociety };
  const navGroups = NAV_GROUPS.map((group) => ({
    label: groupLabel[group.key],
    routes: group.routes.filter((r) => isOfferedTo(r, navigationRole)),
  })).filter((group) => group.routes.length > 0);

  function switchActor(memberId: string) {
    const member = state.members.find((m) => m.id === memberId);
    if (!member) return;
    run({
      type: 'SET_SIMULATED_ACTOR',
      commandId: makeId(),
      memberId,
      viewRole: member.roleProposed as RoleId,
    });
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(event) => {
        // A fragment navigation would also change our hash route. Move focus
        // without changing the URL or discarding the current view's draft.
        event.preventDefault();
        mainRef.current?.focus();
        mainRef.current?.scrollIntoView({ block: 'start' });
      }}>
        {t.nav.skipToContent}
      </a>

      <aside className="station-rail" aria-label={t.nav.workspace}>
        <div className="masthead__identity">
          <div className="masthead__mark" aria-hidden="true">
            <img src="./icons/boka-operativa.svg" alt="" />
          </div>
          <div>
            <div className="masthead__name">{t.app.name}</div>
            <div className="masthead__sub">{t.app.subtitle}</div>
          </div>
        </div>
        <nav className="nav" aria-label={t.nav.main}>
          {navGroups.map((group) => (
            <div className="nav__group" key={group.label}>
              <p className="nav__label">{group.label}</p>
              <div className="nav__items">
                {group.routes.map((r) => (
                  <a key={r} className="nav__link" href={hrefFor(r)}
                    aria-current={route === r ? 'page' : undefined} data-testid={`nav-${r}`}>
                    <span className="nav__icon"><NavIcon route={r} /></span>
                    <span className="nav__link__text">{t.routes[r].name}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <header className="masthead">
        <div className="workspace-heading">
          <img src="./icons/boka-operativa.svg" alt="" />
          <p className="workspace-heading__title">{t.app.name}</p>
        </div>
        <div className="masthead__tools">
          <SignedInIdentity />
          {/* Strict isolation, not a disabled control: on a server-backed route
              the actor selector is not rendered at all. It cannot be tabbed to,
              read by a screen reader, or found by a script, and no screen there
              reads `state.simulation`. A selector that merely looked inactive
              beside a real signed-in identity would still invite the reading
              that choosing a person is how you become them. */}
          {simulated ? (
            <div className="actor-switch">
              <label htmlFor="actor-select">
                {t.shell.simulatedActor}
                <span className="sr-only"> - {t.shell.simulatedActorHint}</span>
              </label>
              <select
                id="actor-select"
                data-testid="actor-select"
                value={state.simulation.actorId}
                onChange={(e) => switchActor(e.target.value)}
              >
                {state.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} - {ROLE_LABEL[member.roleProposed]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </header>

      {/*
        Shown only where it says something. The strip used to appear on every
        screen, including one reading "LOKALNA SIMULACIJA - bez stvarnih poziva
        i obavjestenja" in the rail while the badge two elements below it said
        the screen was running on real data. A banner that contradicts itself
        teaches people to ignore banners.

        The simulation warning stays, because it is the one that prevents a
        fictional call-out being mistaken for a real one. The server badge is
        gone from the top of every screen: on a screen that IS the real product,
        saying so on arrival every time is noise, and the footer still says it
        for anybody who wants to check.
      */}
      {simulated ? (
        <div className="sim-bar">
          <span className="sim-bar__tag">{t.shell.simulationBadge}</span>
          <span className="sim-bar__text">{t.shell.simulationBadgeText}</span>
        </div>
      ) : null}

      <LiveRegion />

      <main ref={mainRef} tabIndex={-1} className={route === 'prikaz' ? 'main main--wide' : 'main'} id="main">
        {/*
          One `<h1>` per page, for the document structure, costing no pixels.
          
          A screen reader and an outline tool both want exactly one top-level
          heading naming the page. A sighted person does not need it: the rail
          already marks where they are, and on the firefighter's screen the thing
          that should look largest is the incident, not the word "Moj poziv".
          Heading LEVEL and visual size are separate questions, and this is the
          answer that gets both right.
        */}
        <h1 className="sr-only">{t.routes[route].name}</h1>
        <ConnectionBar />
        {storageWarning ? <Notice tone="error">{storageWarning}</Notice> : null}
        <VisibleNotice />
        {/* A member form contains an unsent local draft. Remount only this view
            when the simulated person changes so one member can never inherit
            another member's answer, ETA, destination, error or edit state. */}
        {simulated ? (
          <Notice tone="warn">
            {t.shell.simulationNotice} {t.shell.simulationBackToWork}
          </Notice>
        ) : null}
        <Suspense fallback={<p role="status">{t.shell.loadingView}</p>}>
          <View key={route === 'clan' ? state.simulation.actorId : route} />
        </Suspense>
      </main>

      <footer className="foot">
        <p>
          {t.app.name} - {t.app.subtitle}.
          {simulated
            ? ` ${t.shell.simulatedActor}: ${current?.name ?? '-'} (${ROLE_LABEL[state.simulation.viewRole]}).`
            : backing === 'SERVER' ? ` ${t.shell.footerServer}` : ''}
        </p>
        <p>
          {simulated
            ? t.shell.footerLocalData
            : backing === 'SERVER' ? t.shell.footerServerData : t.settings.lead}
        </p>
      </footer>
    </div>
  );
}
