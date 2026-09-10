/**
 * Application shell.
 *
 * Opens directly into the duty officer's working screen - there is no landing
 * page, because the point of the prototype is to be driven, not read.
 *
 * The simulation bar is deliberately styled as a warning strip rather than an
 * account menu. During a demonstration it must be impossible to mistake the
 * actor selector for a login.
 */

import type { RoleId } from '@/domain/types';
import { lazy, Suspense, useRef, type ComponentType } from 'react';
import {
  APP_NAME,
  APP_SUBTITLE,
  LOCAL_DATA_NOTE,
  NAV,
  ROLE_LABEL,
  SIM_BANNER_TEXT,
  SIM_BANNER_TITLE,
  T,
} from '@/i18n/labels';
import { makeId, useApp } from '@/state/AppStateContext';
import { LiveRegion, VisibleNotice } from './ui/components/LiveRegion';
import { Notice } from './ui/components/primitives';
import { NavIcon } from './ui/components/NavIcon';
import { hrefFor, useRoute, type Route } from './ui/router';
import { DispatcherView } from './ui/views/DispatcherView';
import { DisplayView } from './ui/views/DisplayView';
import { HistoryView } from './ui/views/HistoryView';
import { MemberView } from './ui/views/MemberView';
import { RosterView } from './ui/views/RosterView';
import { VehiclesView } from './ui/views/VehiclesView';

const CitizenReportView = lazy(() =>
  import('./ui/views/CitizenReportView').then((module) => ({ default: module.CitizenReportView })),
);
const AccountsView = lazy(() =>
  import('./ui/views/AccountsView').then((module) => ({ default: module.AccountsView })),
);

const VIEWS: Record<Route, ComponentType> = {
  dojava: CitizenReportView,
  dezurni: DispatcherView,
  clan: MemberView,
  vozila: VehiclesView,
  prikaz: DisplayView,
  clanovi: RosterView,
  nalozi: AccountsView,
  istorija: HistoryView,
};

/**
 * Navigation order follows the owner's decision of 9 September 2026: this is an
 * INTERNAL mobilisation and intervention-record system. Citizen reporting is no
 * longer part of the product promise, so it is not in the operational groups and
 * is never the first thing the application offers. It stays reachable only under
 * an explicitly experimental heading, because deleting it would discard reviewed
 * work that may still be reused - but it must never read as a way to report a
 * fire. Nobody may be encouraged to use this instead of calling the official
 * emergency service.
 */
const NAV_GROUPS: { label: string; routes: Route[] }[] = [
  { label: 'Operacije', routes: ['dezurni', 'clan', 'vozila', 'prikaz'] },
  { label: 'Evidencija', routes: ['clanovi', 'nalozi', 'istorija'] },
  { label: 'Istrazivanje (nije u upotrebi)', routes: ['dojava'] },
];

const ROUTE_DESCRIPTION: Record<Route, string> = {
  dojava: 'Napusteni istrazivacki prototip. Nije kanal za prijavu hitnih slucajeva',
  dezurni: 'Priprema poziva i pracenje odziva ekipe',
  clan: 'Poziv i odgovor iz ugla izabranog clana',
  vozila: 'Rucna evidencija izlaska i povratka vozila',
  prikaz: 'Pregled stanja namijenjen ekranu u bazi',
  clanovi: 'Clanovi, uloge, grupe i osposobljenosti',
  nalozi: 'Registracija, potvrda emaila i vlasnicka dodjela pristupa',
  istorija: 'Zavrsene vjezbe i hronologija promjena',
};

export function App() {
  const route = useRoute();
  const { state, run, storageWarning } = useApp();
  const View = VIEWS[route];
  const mainRef = useRef<HTMLElement>(null);

  const current = state.members.find((m) => m.id === state.simulation.actorId);

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
        Preskoci na sadrzaj
      </a>

      <aside className="station-rail" aria-label="DVD Tivat radni prostor">
        <div className="masthead__identity">
          {/* Provisional text identity. No official logo is used. */}
          <div className="masthead__mark" aria-hidden="true">
            D
          </div>
          <div>
            <div className="masthead__name">{APP_NAME}</div>
            <div className="masthead__sub">Operativni prototip</div>
          </div>
        </div>
        <nav className="nav" aria-label="Glavna navigacija">
          {NAV_GROUPS.map((group) => (
            <div className="nav__group" key={group.label}>
              <p className="nav__label">{group.label}</p>
              <div className="nav__items">
                {group.routes.map((r) => (
                  <a key={r} className="nav__link" href={hrefFor(r)}
                    aria-current={route === r ? 'page' : undefined} data-testid={`nav-${r}`}>
                    <span className="nav__icon"><NavIcon route={r} /></span>
                    <span>{NAV[r]}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="rail-note">
          <span className="rail-note__status" aria-hidden="true" />
          <div>
            <span className="rail-note__label">LOKALNA SIMULACIJA</span>
            <p className="rail-note__detail">Bez stvarnih poziva i obavjestenja</p>
          </div>
        </div>
      </aside>

      <header className="masthead">
        <div className="workspace-heading">
          <p className="eyebrow">DVD TIVAT</p>
          <p className="workspace-heading__title">{NAV[route]}</p>
          <p className="workspace-heading__description">{ROUTE_DESCRIPTION[route]}</p>
        </div>

        <div className="masthead__tools">
          <span className="local-pill"><span aria-hidden="true" /> Lokalni prototip</span>
          <div className="actor-switch">
            <label htmlFor="actor-select">
              Simulirani ucesnik
              <span className="sr-only"> - {T.simulateMemberHint}</span>
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
        </div>
      </header>

      {/* Always visible, including the station display. This is not a login. */}
      <div className="sim-bar">
        <span className="sim-bar__tag">{SIM_BANNER_TITLE}</span>
        <span className="sim-bar__text">{SIM_BANNER_TEXT}</span>
      </div>

      <LiveRegion />

      <main ref={mainRef} tabIndex={-1} className={route === 'prikaz' ? 'main main--wide' : 'main'} id="main">
        {storageWarning ? <Notice tone="error">{storageWarning}</Notice> : null}
        <VisibleNotice />
        {/* A member form contains an unsent local draft. Remount only this view
            when the simulated person changes so one member can never inherit
            another member's answer, ETA, destination, error or edit state. */}
        <Suspense fallback={<p role="status">Ucitavanje prikaza...</p>}>
          <View key={route === 'clan' ? state.simulation.actorId : route} />
        </Suspense>
      </main>

      <footer className="foot">
        <p>
          {APP_NAME} - {APP_SUBTITLE}. Simulirani ucesnik: {current?.name ?? '-'} (
          {ROLE_LABEL[state.simulation.viewRole]}).
        </p>
        <p>{LOCAL_DATA_NOTE}</p>
      </footer>
    </div>
  );
}
