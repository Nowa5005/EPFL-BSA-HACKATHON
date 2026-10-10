import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLocal, UnlockProvider } from './lib/hooks';
import { Card, DemoFooter } from './components/ui';
import { SqShell } from './sq/SqShell';
import SqHome from './sq/SqHome';
import SqMarkets from './sq/SqMarkets';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Send from './pages/Send';
import Asset from './pages/Asset';
import Settings from './pages/Settings';
import Inbox from './pages/Inbox';
import Dapps from './pages/Dapps';
import Recover from './pages/Recover';
import Admin from './pages/Admin';
import Attacker from './pages/Attacker';
import { MoreMenu, WalletShell } from './wallet/WalletShell';
import UnlockPage from './wallet/Unlock';
import Home from './wallet/Home';
import Transactions from './wallet/Transactions';
import TxDetail from './wallet/TxDetail';
import InfoPage from './wallet/Info';
import Swaplet from './wallet/Swaplet';
import Security from './wallet/Security';

/** My Wall pages: Swissquote session + a wallet on this device + unlocked (password + passkey). */
function WalletRoute({ children }: { children: ReactNode }) {
  const { device, session, unlocked } = useLocal();
  const loc = useLocation();
  if (!session) return <Navigate to="/login" replace />;
  if (!device?.safeAddress || device.clientId !== session.clientId) return <Navigate to="/onboarding" replace />;
  if (!unlocked) return <Navigate to="/wallet/unlock" state={{ from: loc.pathname + loc.search }} replace />;
  return <WalletShell>{children}</WalletShell>;
}

function SqRoute({ children }: { children: ReactNode }) {
  const { session } = useLocal();
  if (!session) return <Navigate to="/login" replace />;
  return <SqShell>{children}</SqShell>;
}

function OnboardingRoute() {
  const { session, device } = useLocal();
  if (!session) return <Navigate to="/login" replace />;
  if (device?.safeAddress && device.clientId === session.clientId) return <Navigate to="/wallet" replace />;
  return <Onboarding />;
}

function InboxRoute() {
  const { device, unlocked } = useLocal();
  if (device?.safeAddress && unlocked)
    return (
      <WalletShell>
        <Inbox />
      </WalletShell>
    );
  return (
    <div className="mw-page mx-auto max-w-[640px] px-4 pt-6">
      <Inbox />
      <DemoFooter />
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <Card className="mt-4 text-[14px] text-sq-muted">
      <b className="text-sq-ink">{title}</b> — section non reconstituée dans cette démo.
    </Card>
  );
}

export default function App() {
  return (
    <UnlockProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/sq" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/sq" element={<SqRoute><SqHome /></SqRoute>} />
        <Route path="/sq/markets" element={<SqRoute><SqMarkets /></SqRoute>} />
        <Route path="/sq/bank" element={<SqRoute><Placeholder title="Bank" /></SqRoute>} />
        <Route path="/sq/plan" element={<SqRoute><Placeholder title="Plan" /></SqRoute>} />
        <Route path="/onboarding" element={<OnboardingRoute />} />
        <Route path="/wallet/unlock" element={<UnlockPage />} />
        <Route path="/wallet" element={<WalletRoute><Home /></WalletRoute>} />
        <Route path="/wallet/transactions" element={<WalletRoute><Transactions /></WalletRoute>} />
        <Route path="/activity" element={<Navigate to="/wallet/transactions" replace />} />
        <Route path="/wallet/tx/:id" element={<WalletRoute><TxDetail /></WalletRoute>} />
        <Route path="/wallet/info" element={<WalletRoute><InfoPage /></WalletRoute>} />
        <Route path="/wallet/swaplet" element={<WalletRoute><Swaplet /></WalletRoute>} />
        <Route path="/wallet/security" element={<WalletRoute><Security /></WalletRoute>} />
        <Route path="/wallet/more" element={<WalletRoute><MoreMenu /></WalletRoute>} />
        <Route path="/send" element={<WalletRoute><Send /></WalletRoute>} />
        <Route path="/asset/:symbol" element={<WalletRoute><Asset /></WalletRoute>} />
        <Route path="/dapps" element={<WalletRoute><Dapps /></WalletRoute>} />
        <Route path="/settings" element={<WalletRoute><Settings /></WalletRoute>} />
        <Route path="/inbox" element={<InboxRoute />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/attacker" element={<Attacker />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </UnlockProvider>
  );
}
