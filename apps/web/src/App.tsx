import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLocal, UnlockProvider } from './lib/hooks';
import { Shell, TabBar } from './components/ui';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import WalletHome from './pages/WalletHome';
import Asset from './pages/Asset';
import Send from './pages/Send';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import Inbox from './pages/Inbox';
import Dapps from './pages/Dapps';
import Recover from './pages/Recover';
import Admin from './pages/Admin';
import Attacker from './pages/Attacker';

/** Pages of the client wallet: need a Swissquote session + a wallet on this device. */
function WalletRoute({ children }: { children: ReactNode }) {
  const { device, session } = useLocal();
  const loc = useLocation();
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (!device?.safeAddress || device.clientId !== session.clientId) return <Navigate to="/onboarding" replace />;
  return (
    <Shell>
      {/* key: re-clicking a tab (e.g. Send after a payment) starts a fresh screen */}
      <div key={loc.key}>{children}</div>
      <TabBar />
    </Shell>
  );
}

function Home() {
  const { device, session } = useLocal();
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={device?.safeAddress ? '/wallet' : '/onboarding'} replace />;
}

function OnboardingRoute() {
  const { session } = useLocal();
  if (!session) return <Navigate to="/login" replace />;
  return <Onboarding />;
}

export default function App() {
  return (
    <UnlockProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<OnboardingRoute />} />
        <Route path="/wallet" element={<WalletRoute><WalletHome /></WalletRoute>} />
        <Route path="/asset/:symbol" element={<WalletRoute><Asset /></WalletRoute>} />
        <Route path="/send" element={<WalletRoute><Send /></WalletRoute>} />
        <Route path="/activity" element={<WalletRoute><Activity /></WalletRoute>} />
        <Route path="/settings" element={<WalletRoute><Settings /></WalletRoute>} />
        <Route path="/dapps" element={<WalletRoute><Dapps /></WalletRoute>} />
        <Route path="/inbox" element={<Shell><Inbox /></Shell>} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/attacker" element={<Attacker />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </UnlockProvider>
  );
}
