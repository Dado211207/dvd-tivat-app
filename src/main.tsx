import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccessProvider } from './auth/AccessProvider';
import { AppStateProvider } from './state/AppStateContext';
import './styles/global.css';
import './styles/workspace.css';
import 'leaflet/dist/leaflet.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    {/* Access wraps the application state, not the other way round: the server
        decides who you are, and the local prototype state is only what one
        browser has been playing with. */}
    <AccessProvider>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </AccessProvider>
  </StrictMode>,
);
