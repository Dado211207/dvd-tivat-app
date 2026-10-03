import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyStoredLanguage } from './i18n/language';
import { migrateLegacyStorageKeys } from './storage/legacyKeyMigration';
import { AccessProvider } from './auth/AccessProvider';
import { CallOutAlarm } from './notifications/CallOutAlarm';
import { registerServiceWorker } from './pwa';
import { AppStateProvider } from './state/AppStateContext';
import './styles/global.css';
import './styles/workspace.css';
import 'leaflet/dist/leaflet.css';

// Before anything reads a stored key: move this device's call-out draft,
// acting-service, alarm-sound and language off the legacy `dvd-tivat` prefix (P8),
// so an upgrading member keeps all of them under the neutral name.
migrateLegacyStorageKeys();

// Before the first render, so nothing paints in one language and re-paints in
// the other, and so `<html lang>` is right for a screen reader from the start.
applyStoredLanguage();

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    {/* Access wraps the application state, not the other way round: the server
        decides who you are, and the local prototype state is only what one
        browser has been playing with. */}
    <AccessProvider>
      <AppStateProvider>
        {/* The call-out alarm listens above the router, so a newly-arrived
            call-out for the signed-in member can sound on any route - not only
            while the "Moj poziv" screen is mounted. Headless; renders nothing. */}
        <CallOutAlarm />
        <App />
      </AppStateProvider>
    </AccessProvider>
  </StrictMode>,
);

// After the first render, never before: an offline shell is a convenience and
// must not delay the screen somebody is waiting on.
registerServiceWorker();
