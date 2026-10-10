// Reconstructed Swissquote app frame (demo reconstruction, fictitious data) with the two entry points
// into My Wall: the "Mon wallet" pull-up tab on touch/mobile and the "Mon wallet" button on desktop.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUp, Box, ChartColumn, CircleUser, CreditCard, House, LogOut, Search, Wallet, X } from 'lucide-react';
import { cosigner } from '../lib/api';
import { isUnlocked, lock, saveSession } from '../lib/device';
import { useLocal } from '../lib/hooks';
import { Button, cx, DemoFooter, ICON, IconButton, Logo, Spinner, useMedia } from '../components/ui';
import { ExistingWalletActions } from '../wallet/ExistingWallet';
import { UnlockForm } from '../wallet/Unlock';

const NAV = [
  { to: '/sq', label: 'Home', icon: House, end: true },
  { to: '/sq/markets', label: 'Trade', icon: ChartColumn },
  { to: '/sq/bank', label: 'Bank', icon: CreditCard },
  { to: '/sq/plan', label: 'Plan', icon: Box },
];

export function AccountButton() {
  const { session } = useLocal();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton label="Compte" onClick={() => setOpen((o) => !o)}>
        <CircleUser {...ICON} size={22} />
      </IconButton>
      {open && (
        <div className="mw-toast absolute right-0 top-12 z-40 w-60 rounded-[12px] border border-sq-line bg-white p-3 text-[14px] shadow-lg">
          <div className="px-2 py-1 font-semibold">{session?.profile?.name ?? 'Client'}</div>
          <div className="px-2 pb-2 text-[12px] text-sq-muted">{session?.clientId}</div>
          <button
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-sq-chip/60"
            onClick={() => {
              saveSession(null);
              lock();
              nav('/login');
            }}
          >
            <LogOut size={18} strokeWidth={1.75} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

/** Desktop: orange "Mon wallet" button placed just left of the account button. */
function WalletButton() {
  const nav = useNavigate();
  const { device } = useLocal();
  return (
    <button
      type="button"
      onClick={() => nav(device?.safeAddress ? (isUnlocked() ? '/wallet' : '/wallet/unlock') : '/wallet/unlock')}
      className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-sq-orange px-4 text-[15px] font-semibold text-white hover:bg-sq-orange-600"
    >
      <Wallet size={18} strokeWidth={1.75} />
      Mon wallet
    </button>
  );
}

export function SqShell({ children }: { children: ReactNode }) {
  const isDesktop = useMedia('(min-width: 1024px)');
  const coarse = useMedia('(pointer: coarse)');
  const loc = useLocation();
  const showTab = !isDesktop || coarse;

  return (
    <div className="min-h-screen bg-sq-bg">
      {isDesktop && (
        <header className="sticky top-0 z-30 border-b border-sq-line bg-white">
          <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-6">
            <Link to="/sq" className="flex items-center gap-2.5" aria-label="Accueil Swissquote">
              <Logo size={28} />
              <span className="text-[16px] font-semibold tracking-tight">Swissquote</span>
            </Link>
            <nav className="flex h-full gap-6">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) => cx('relative flex h-full items-center text-[15px]', isActive ? 'font-semibold text-sq-ink' : 'text-sq-muted hover:text-sq-ink')}
                >
                  {({ isActive }) => (
                    <>
                      {n.label}
                      <span className={cx('absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-sq-orange transition-transform duration-200', isActive ? 'scale-x-100' : 'scale-x-0')} />
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="flex-1" />
            <IconButton label="Rechercher" className="shadow-none">
              <Search {...ICON} />
            </IconButton>
            <WalletButton />
            <AccountButton />
          </div>
        </header>
      )}

      <main key={loc.pathname} className={cx('mw-page mx-auto px-4', isDesktop ? 'max-w-[1200px] px-6 pb-10 pt-8' : 'max-w-[720px] pb-44 pt-3')}>
        {children}
        <DemoFooter />
      </main>

      {!isDesktop && (
        <nav className="fixed inset-x-0 bottom-0 z-30 rounded-t-[16px] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_rgba(0,0,0,0.04)]" aria-label="Navigation Swissquote">
          <div className="mx-auto grid max-w-[720px] grid-cols-4">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px]', isActive ? 'font-medium text-sq-orange' : 'text-sq-ink-2')}>
                <n.icon size={24} strokeWidth={1.75} />
                {n.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      {showTab && <WalletTab aboveNav={!isDesktop} />}
    </div>
  );
}

/** Mobile header with the round search & account buttons (top right), like the references. */
export function SqMobileTop({ children }: { children?: ReactNode }) {
  const isDesktop = useMedia('(min-width: 1024px)');
  if (isDesktop) return children ? <>{children}</> : null;
  return (
    <div className="flex items-start gap-2 pb-2 pt-2">
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton label="Rechercher">
        <Search {...ICON} />
      </IconButton>
      <AccountButton />
    </div>
  );
}

// ───────────────────────── "Mon wallet" pull-up tab + panel ─────────────────────────
function WalletTab({ aboveNav }: { aboveNav: boolean }) {
  const [open, setOpen] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    // leave the bottom 20 px to the system gesture
    if (window.innerHeight - e.clientY < 20) return;
    start.current = { y: e.clientY, t: performance.now() };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = start.current.y - e.clientY;
    const v = dy / Math.max(1, performance.now() - start.current.t);
    if (dy > 60 || (dy > 15 && v > 0.5)) {
      start.current = null;
      setOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mywall-panel"
        onClick={() => setOpen(true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (start.current = null)}
        style={{ touchAction: 'none', bottom: aboveNav ? 'calc(60px + env(safe-area-inset-bottom))' : 'env(safe-area-inset-bottom)' }}
        className="fixed left-1/2 z-30 flex w-[200px] -translate-x-1/2 flex-col items-center gap-1.5 rounded-t-[12px] bg-white px-4 pb-2.5 pt-2 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      >
        <span className="h-1 w-9 rounded-full bg-sq-line" aria-hidden />
        <span className="flex items-center gap-2 text-[14px] font-semibold text-sq-ink">
          <Logo size={20} />
          Mon wallet
          <ArrowUp size={16} strokeWidth={2} className="text-sq-muted" />
        </span>
      </button>
      {open && <WalletPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function WalletPanel({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { device, session } = useLocal();
  const [hasRemoteWallet, setHasRemoteWallet] = useState<boolean | null>(null);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (device?.safeAddress && isUnlocked()) {
      const t = setTimeout(() => nav('/wallet'), 260);
      return () => clearTimeout(t);
    }
    if (!device && session) cosigner.get(`/clients/${session.clientId}`).then((c) => setHasRemoteWallet(!!c.safeAddress)).catch(() => setHasRemoteWallet(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div id="mywall-panel" role="dialog" aria-modal="true" aria-label="My Wall" className="mw-sheet-up fixed inset-0 z-50 flex flex-col bg-sq-bg">
      <div
        className="flex items-center justify-between px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => (start.current = e.clientY)}
        onPointerMove={(e) => {
          if (start.current !== null && e.clientY - start.current > 80) {
            start.current = null;
            onClose();
          }
        }}
        onPointerUp={() => (start.current = null)}
      >
        <span className="w-11" />
        <span className="h-1 w-9 rounded-full bg-sq-line" aria-hidden />
        <IconButton label="Revenir à Swissquote" onClick={onClose}>
          <X {...ICON} />
        </IconButton>
      </div>
      <div className="mx-auto w-full max-w-[440px] flex-1 overflow-y-auto px-5 pb-10">
        <div className="flex flex-col items-center pb-6 pt-6 text-center">
          <Logo size={56} />
          <h2 className="mt-4 text-[24px] font-semibold tracking-tight">My Wall</h2>
          <p className="mt-1 text-[14px] text-sq-muted">Votre wallet en self-custody, relié à votre compte Swissquote.</p>
        </div>
        {device?.safeAddress ? (
          isUnlocked() ? (
            <div className="flex justify-center py-8 text-sq-muted">Ouverture…</div>
          ) : (
            <UnlockForm onDone={() => nav('/wallet')} />
          )
        ) : session && hasRemoteWallet === null ? (
          <div className="flex justify-center py-8 text-sq-muted">
            <Spinner />
          </div>
        ) : hasRemoteWallet ? (
          <div className="space-y-3">
            <p className="text-center text-[14px] text-sq-ink-2">Votre wallet existe déjà, mais pas sur cet appareil : restaurez-le ici (ce n’est pas compté comme un appareil supplémentaire).</p>
            <ExistingWalletActions clientId={session!.clientId} onReset={onClose} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-[14px] text-sq-ink-2">Activez My Wall en quelques minutes. Vous gardez le contrôle de vos clés ; Swissquote sécurise sans jamais pouvoir déplacer vos fonds seul.</p>
            <Button onClick={() => nav('/onboarding')}>Activer My Wall</Button>
            <Button variant="ghost" onClick={() => nav('/recover')}>
              J'ai déjà un wallet — le restaurer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
