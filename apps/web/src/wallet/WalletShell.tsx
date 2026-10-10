import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeftRight, CalendarClock, ChevronLeft, Ellipsis, FileText, House, Info, KeySquare, Mail, Palette, ShieldCheck, Sparkles } from 'lucide-react';
import { cosigner } from '../lib/api';
import { useLocal } from '../lib/hooks';
import { setPrefs, themeStyle, usePrefs } from '../lib/prefs';
import { ConfirmationLayer } from '../components/Confirm';
import { cx, DemoFooter, Logo } from '../components/ui';
import { AccountButton } from '../sq/SqShell';
import { useIsDesktopLayout } from '../lib/platform';
import { tr } from '../lib/i18n';
import { useTheme } from '../lib/theme';

const CompactCtx = createContext<(v: string | null) => void>(() => {});
/** Home publishes "My Wall · 1'234.56 CHF" here once the content sheet covers the balances. */
export const useCompactBar = () => useContext(CompactCtx);

const DESKTOP_TABS = [
  { to: '/wallet', label: tr('Home', 'Accueil'), end: true },
  { to: '/wallet/transactions', label: 'Transactions' },
  { to: '/wallet/swaplet', label: 'Swaplet' },
  { to: '/wallet/info', label: tr('Information', 'Informations') },
  { to: '/wallet/security', label: tr('Security', 'Sécurité') },
  { to: '/wallet/more', label: tr('More', 'Plus') },
];

const MOBILE_TABS = [
  { to: '/wallet', label: tr('Home', 'Accueil'), icon: House, end: true },
  { to: '/wallet/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/wallet/swaplet', label: 'Swaplet', icon: FileText },
  { to: '/wallet/more', label: tr('More', 'Plus'), icon: Ellipsis, also: ['/wallet/info', '/wallet/security', '/dapps', '/settings', '/inbox', '/wallet/approvals', '/wallet/scheduled', '/wallet/plans'] },
];

export function WalletShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const isDesktop = useIsDesktopLayout(); // always false in app mode (native app / app preview)
  const loc = useLocation();
  const [compact, setCompact] = useState<string | null>(null);
  const { device } = useLocal();
  const { prefs } = usePrefs();
  const { resolved } = useTheme();
  useEffect(() => {
    if (device?.clientId) cosigner.get(`/clients/${device.clientId}`).then((c) => setPrefs(c.preferences)).catch(() => undefined);
  }, [device?.clientId]);

  return (
    <CompactCtx.Provider value={setCompact}>
      <div className={cx('min-h-screen bg-sq-bg', prefs.highlight && 'mw-highlight')} style={themeStyle(prefs, resolved === 'dark')}>
        <ConfirmationLayer />
        {isDesktop ? (
          <header className="sticky top-0 z-30 border-b border-sq-line bg-sq-surface">
            <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-6">
              <Link to="/wallet" className="flex items-center gap-2.5">
                <Logo size={28} />
                <span className="text-[16px] font-semibold tracking-tight">My Wall</span>
              </Link>
              <nav className="flex h-full gap-6" aria-label="My Wall">
                {DESKTOP_TABS.map((t) => (
                  <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('relative flex h-full items-center text-[15px]', isActive ? 'font-semibold text-sq-ink' : 'text-sq-muted hover:text-sq-ink')}>
                    {({ isActive }) => (
                      <>
                        {t.label}
                        <span className={cx('absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-sq-orange transition-transform duration-200', isActive ? 'scale-x-100' : 'scale-x-0')} />
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
              <div className="flex-1" />
              {compact && <span className="num mw-toast text-[14px] font-medium text-sq-ink-2">{compact}</span>}
              <Link to="/sq" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-sq-ink-2 hover:text-sq-ink">
                <ChevronLeft size={18} strokeWidth={1.75} /> Swissquote
              </Link>
              <Link to="/inbox" aria-label={tr('Inbox (simulated)', 'Boîte de réception (simulée)')} className="flex size-11 items-center justify-center rounded-full hover:bg-sq-chip/60">
                <Mail size={20} strokeWidth={1.75} />
              </Link>
              <Link to="/wallet/plans" className="inline-flex min-h-11 items-center text-[14px] font-semibold text-sq-orange-600 hover:underline">
                {tr('Plans', 'Abonnements')}
              </Link>
              <AccountButton />
            </div>
          </header>
        ) : (
          <header className="sticky top-0 z-30 bg-sq-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur">
            <div className="mx-auto flex h-14 max-w-[720px] items-center gap-2 px-3">
              <Link to="/sq" className="inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-[14px] font-medium text-sq-ink-2" aria-label={tr('Back to Swissquote', 'Retour à Swissquote')}>
                <ChevronLeft size={20} strokeWidth={1.75} /> Swissquote
              </Link>
              <div className="flex flex-1 items-center justify-center gap-2">
                {compact ? (
                  <span className="num mw-toast text-[15px] font-semibold">{compact}</span>
                ) : (
                  <>
                    <Logo size={24} />
                    <span className="whitespace-nowrap text-[16px] font-semibold">My Wall</span>
                  </>
                )}
              </div>
              <Link to="/wallet/plans" className="inline-flex min-h-11 items-center px-1 text-[13px] font-semibold text-sq-orange-600">
                {tr('Plans', 'Abonnements')}
              </Link>
              <Link to="/inbox" aria-label={tr('Inbox (simulated)', 'Boîte de réception (simulée)')} className="flex size-11 items-center justify-center rounded-full hover:bg-sq-chip/60">
                <Mail size={20} strokeWidth={1.75} />
              </Link>
            </div>
          </header>
        )}

        <main key={['/send', '/dapps'].includes(loc.pathname) ? loc.key : loc.pathname} className={cx('mw-page mx-auto px-4', isDesktop ? (wide ? 'max-w-[1200px] px-6 pt-6' : 'max-w-[1200px] px-6 pt-6') : 'max-w-[720px] pb-28 pt-2')}>
          {children}
          <DemoFooter />
        </main>

        {!isDesktop && (
          <nav className="fixed inset-x-0 bottom-0 z-30 rounded-t-[16px] bg-sq-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_rgba(0,0,0,0.04)]" aria-label={tr('My Wall navigation', 'Navigation My Wall')}>
            <div className="mx-auto grid max-w-[720px] grid-cols-4">
              {MOBILE_TABS.map((t) => {
                const extra = 'also' in t && t.also?.some((p) => loc.pathname.startsWith(p));
                return (
                  <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px]', isActive || extra ? 'font-medium text-sq-orange' : 'text-sq-ink-2')}>
                    <t.icon size={24} strokeWidth={1.75} />
                    {t.label}
                  </NavLink>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </CompactCtx.Provider>
  );
}

/** Mobile "Plus" menu. */
export function MoreMenu() {
  const items = [
    { to: '/wallet/info', label: tr('Information', 'Informations'), desc: tr('Your transactions, crypto market, what’s new', 'Vos transactions, marché crypto, nouveautés'), icon: Info },
    { to: '/wallet/security', label: tr('Keys & security', 'Clés et sécurité'), desc: tr('Address, device key, recovery code, backup', 'Adresse, clé de l’appareil, code de récupération, sauvegarde'), icon: ShieldCheck },
    { to: '/wallet/approvals', label: tr('Authorised apps', 'Applications autorisées'), desc: tr('Spending approvals granted, revocation', 'Autorisations de dépense accordées, révocation'), icon: KeySquare },
    { to: '/wallet/scheduled', label: tr('Scheduled payments & reminders', 'Dépenses planifiées et rappels'), desc: tr('To confirm at the due date, never sent automatically', 'À confirmer à l’échéance, jamais envoyées automatiquement'), icon: CalendarClock },
    { to: '/wallet/plans', label: tr('Plans & fees', 'Abonnements et frais'), desc: tr('Free, Plus, Pro — cost comparison', 'Gratuit, Plus, Pro — comparateur de coût'), icon: Sparkles },
    { to: '/dapps', label: 'dApps', desc: tr('Apps approved by Swissquote', 'Applications approuvées par Swissquote'), icon: ArrowLeftRight },
    { to: '/settings', label: tr('Settings', 'Paramètres'), desc: tr('Profile, devices, privacy, personalisation', 'Profil, appareils, confidentialité, personnalisation'), icon: Palette },
    { to: '/inbox', label: tr('Inbox', 'Boîte de réception'), desc: tr('Emails and text messages (simulated)', 'Emails et SMS (simulés)'), icon: Mail },
  ];
  return (
    <div>
      <h1 className="mb-4 text-[22px] font-semibold tracking-tight">{tr('More', 'Plus')}</h1>
      <ul className="overflow-hidden rounded-[12px] bg-sq-surface">
        {items.map((it) => (
          <li key={it.to} className="border-b border-sq-line last:border-0">
            <Link to={it.to} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-sq-bg/60">
              <it.icon size={22} strokeWidth={1.75} className="text-sq-ink-2" />
              <span className="flex-1">
                <span className="block text-[15px] font-medium">{it.label}</span>
                <span className="block text-[12px] text-sq-muted">{it.desc}</span>
              </span>
              <ChevronLeft size={18} strokeWidth={1.75} className="rotate-180 text-sq-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-4 text-[13px] text-sq-muted">
        <Link to="/admin" className="underline underline-offset-4">
          {tr('Swissquote console (simulated)', 'Console Swissquote (simulée)')}
        </Link>
        <Link to="/attacker" className="underline underline-offset-4">
          {tr('Attacker demo', 'Démo attaquant')}
        </Link>
        <Link to="/about" className="underline underline-offset-4">
          {tr('About this prototype', 'À propos de ce prototype')}
        </Link>
        <Link to="/emergency" className="underline underline-offset-4">
          {tr('Emergency mode', 'Mode urgence')}
        </Link>
      </div>
    </div>
  );
}
