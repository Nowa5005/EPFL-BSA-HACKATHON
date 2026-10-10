import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getDevice, saveDevice, saveSession } from './lib/device';
import { cosigner, ApiError } from './lib/api';

// After `npm run reset-demo` the services forget the client: forget the local wallet too.
const d = getDevice();
if (d) {
  cosigner.get(`/clients/${d.clientId}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) {
      saveDevice(null);
      saveSession(null);
      try {
        localStorage.removeItem('mw:pending-recovery');
        localStorage.removeItem('mw:read');
        localStorage.removeItem('mw:unlock-fails');
      } catch {
        /* ignore */
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
