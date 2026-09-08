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
import { hrefFor, ROUTES, useRoute, type Route } from './ui/router';
import { DispatcherView } from './ui/views/DispatcherView';
import { DisplayView } from './ui/views/DisplayView';
import { HistoryView } from './ui/views/HistoryView';
import { MemberView } from './ui/views/MemberView';
import { RosterView } from './ui/views/RosterView';
import { VehiclesView } from './ui/views/VehiclesView';

const VIEWS: Record<Route, () => JSX.Element> = {
  dezurni: DispatcherView,
  clan: MemberView,
  vozila: VehiclesView,
  prikaz: DisplayView,
  clanovi: RosterView,
  istorija: HistoryView,
};

export function App() {
  const route = useRoute();
  const { state, run, storageWarning } = useApp();
  const View = VIEWS[route];

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
      <a className="skip-link" href="#main">
        Preskoci na sadrzaj
      </a>

      {/* Always visible, on every screen, including the station display. */}
      <div className="sim-bar">
        <span className="sim-bar__tag">{SIM_BANNER_TITLE}</span>
        <span className="sim-bar__text">{SIM_BANNER_TEXT}</span>
      </div>

      <header className="masthead">
        <div className="masthead__identity">
          {/* Provisional text identity. No official logo is used. */}
          <div className="masthead__mark" aria-hidden="true">
            DVD
          </div>
          <div>
            <div className="masthead__name">{APP_NAME}</div>
            <div className="masthead__sub">{APP_SUBTITLE}</div>
          </div>
        </div>

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
      </header>

      <nav className="nav" aria-label="Glavna navigacija">
        {ROUTES.map((r) => (
          <a
            key={r}
            className="nav__link"
            href={hrefFor(r)}
            aria-current={route === r ? 'page' : undefined}
            data-testid={`nav-${r}`}
          >
            {NAV[r]}
          </a>
        ))}
      </nav>

      <LiveRegion />

      <main className={route === 'prikaz' ? 'main main--wide' : 'main'} id="main">
        {storageWarning ? <Notice tone="error">{storageWarning}</Notice> : null}
        <VisibleNotice />
        {/* A member form contains an unsent local draft. Remount only this view
            when the simulated person changes so one member can never inherit
            another member's answer, ETA, destination, error or edit state. */}
        <View key={route === 'clan' ? state.simulation.actorId : route} />
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
