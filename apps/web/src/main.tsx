import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getDevice, getSession, saveDevice, saveSession } from './lib/device';
import { cosigner, ApiError } from './lib/api';

// After `npm run reset-demo` the services forget the client: forget the local wallet too.
// (Only with the matching Swissquote session: the services require the client's own session token.)
const d = getDevice();
if (d && getSession()?.clientId === d.clientId) {
  cosigner.get(`/clients/${d.clientId}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) {
      saveDevice(null);
      saveSession(null);
      try {
        localStorage.removeItem('mw:pending-recovery');
        localStorage.removeItem('mw:read');
        localStorage.removeItem('mw:unlock-fails');
        Object.keys(localStorage).filter((k) => k.startsWith('mw:draft:')).forEach((k) => localStorage.removeItem(k));
      } catch {
        /* ignore */
      }
    }
  });
}

// Logged in without a local wallet: if the services were reset, re-register the client silently
// (POST /clients is idempotent) so activation does not fail with "Client inconnu".
const s = getSession();
if (!d && s?.clientId && s.profile) {
  cosigner.get(`/clients/${s.clientId}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404)
      cosigner.post('/clients', { clientId: s.clientId, name: s.profile.name ?? s.clientId, email: s.profile.email ?? `${s.clientId}@example.ch` }).catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
