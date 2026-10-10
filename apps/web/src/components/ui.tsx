import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { PolicyCheck } from '@sq/shared';
import { MOCK_USDC_CHF } from '@sq/shared';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function MockBadge({ label = 'MOCK', className }: { label?: string; className?: string }) {
  return (
    <span
      title="Simulated in this prototype — see the Real vs Mock table in the README"
      className={cx('inline-flex items-center rounded border border-dashed border-warn-600/60 bg-warn-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn-600', className)}
    >
      {label}
    </span>
  );
}

export function RealBadge({ label = 'On-chain', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded bg-ok-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ok-600', className)}>{label}</span>
  );
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cx('rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(11,31,58,0.06),0_8px_24px_rgba(11,31,58,0.05)]', className)}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-navy-900 text-white hover:bg-navy-800',
    secondary: 'bg-navy-100 text-navy-900 hover:bg-navy-100/70',
    danger: 'bg-bad-600 text-white hover:bg-bad-600/90',
    ghost: 'bg-transparent text-navy-800 hover:bg-navy-100',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx('inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40', styles, className)}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-navy-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-700/70">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-navy-100 bg-white px-3.5 py-3 text-[15px] outline-none transition placeholder:text-navy-700/40 focus:border-navy-700 focus:ring-2 focus:ring-navy-100';

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; title?: ReactNode; children?: ReactNode }) {
  const t = {
    info: 'bg-navy-50 text-navy-900 border-navy-100',
    ok: 'bg-ok-50 text-ok-600 border-ok-600/20',
    warn: 'bg-warn-50 text-warn-600 border-warn-600/20',
    bad: 'bg-bad-50 text-bad-600 border-bad-600/20',
  }[tone];
  return (
    <div className={cx('rounded-xl border p-3.5 text-sm', t)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cx(!!title && 'mt-1', 'text-navy-900/80')}>{children}</div>}
    </div>
  );
}

export function Why({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-navy-50 p-3 text-[13px] leading-relaxed text-navy-800">
      <span aria-hidden>🛡️</span>
      <span>{children}</span>
    </p>
  );
}

export function Checks({ checks }: { checks: PolicyCheck[] }) {
  return (
    <ul className="divide-y divide-navy-100">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-3 py-2.5 text-sm">
          <span
            className={cx(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
              c.status === 'pass' ? 'bg-ok-600' : c.status === 'step-up' ? 'bg-warn-600' : 'bg-bad-600',
            )}
          >
            {c.status === 'pass' ? '✓' : c.status === 'step-up' ? '!' : '✕'}
          </span>
          <span>
            <span className="font-medium">{c.label}</span>
            {c.detail && <span className="block text-xs text-navy-700/70">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map((s, i) => (
        <div key={s} className={cx('h-1 flex-1 rounded-full', i <= current ? 'bg-navy-900' : 'bg-navy-100')} title={s} />
      ))}
    </div>
  );
}

export function ProgressList({ items }: { items: { label: string; state: 'todo' | 'doing' | 'done' | 'error'; detail?: ReactNode }[] }) {
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.label} className="flex items-start gap-3 text-sm">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            {it.state === 'doing' ? (
              <Spinner className="text-navy-700" />
            ) : it.state === 'done' ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-ok-600 text-[11px] text-white">✓</span>
            ) : it.state === 'error' ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-bad-600 text-[11px] text-white">✕</span>
            ) : (
              <span className="size-2 rounded-full bg-navy-100" />
            )}
          </span>
          <span className={cx(it.state === 'todo' && 'text-navy-700/50')}>
            {it.label}
            {it.detail && <span className="block text-xs text-navy-700/70">{it.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const chf = (n: number) =>
  new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace('CHF', 'CHF ');
export const usdcToChf = (n: number) => n * MOCK_USDC_CHF;
export const fmt = (n: number, d = 2) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

export function Addr({ a, full }: { a?: string; full?: boolean }) {
  if (!a) return null;
  return <span className="font-mono text-[13px]">{full ? a : `${a.slice(0, 6)}…${a.slice(-4)}`}</span>;
}

export function TxLink({ hash, children }: { hash?: string; children?: ReactNode }) {
  if (!hash) return null;
  return (
    <a className="inline-flex items-center gap-1 font-medium text-accent-500 underline-offset-2 hover:underline" href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
      {children ?? 'View on Etherscan'} ↗
    </a>
  );
}

export function PageHeader({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {back && (
        <Link to={back} className="-ml-2 rounded-lg px-2 py-1 text-xl text-navy-800 hover:bg-navy-100" aria-label="Back">
          ‹
        </Link>
      )}
      <h1 className="flex-1 text-xl font-semibold tracking-tight">{title}</h1>
      {right}
    </div>
  );
}

export function useCountdown(until?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-navy-100 bg-white/85 backdrop-blur">
        <div className={cx('mx-auto flex h-14 items-center gap-3 px-4', wide ? 'max-w-6xl' : 'max-w-md')}>
          <Link to="/wallet" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-navy-900 text-xs font-bold text-white">SQ</span>
            <span className="text-[15px] font-semibold tracking-tight">SQ Wallet</span>
          </Link>
          <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-navy-700">Hackathon prototype</span>
          <div className="flex-1" />
          <Link to="/inbox" className="relative rounded-lg px-2 py-1 text-sm text-navy-800 hover:bg-navy-100" title="Mock email / SMS inbox">
            ✉︎ <span className="hidden sm:inline">Inbox</span>
          </Link>
        </div>
      </header>
      <main className={cx('mx-auto px-4 pb-28 pt-5', wide ? 'max-w-6xl' : 'max-w-md')}>{children}</main>
    </div>
  );
}

export function TabBar() {
  const tabs = [
    { to: '/wallet', label: 'Wallet', icon: '◎' },
    { to: '/send', label: 'Send', icon: '↗' },
    { to: '/activity', label: 'Activity', icon: '≡' },
    { to: '/settings', label: 'Settings', icon: '⚙︎' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-navy-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', isActive ? 'text-navy-900' : 'text-navy-700/50')}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
