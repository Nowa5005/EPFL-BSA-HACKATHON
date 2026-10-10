import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, CircleAlert, Copy, ExternalLink, Eye, EyeOff, Info, Loader2, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { PolicyCheck } from '@sq/shared';
import { useMasked } from '../lib/prefs';
import { locale, tr } from '../lib/i18n';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export const ICON = { size: 20, strokeWidth: 1.75 } as const;

// ── Brand ──
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  // Provided logo, used as-is (no recolouring, no effects).
  return <img src="/brand/swissquote-logo.png" width={size} height={size} alt="Swissquote" className={cx('shrink-0 rounded-full', className)} style={{ width: size, height: size }} />;
}

export function DemoFooter({ className }: { className?: string }) {
  return (
    <p className={cx('px-4 py-6 text-center text-[11px] leading-relaxed text-sq-muted', className)}>
      {tr(
        'Prototype — Swissquote Wallet Challenge (EPFL). Swissquote account data is fictitious; market data is real (Yahoo Finance, CoinGecko); the wallet runs on the Ethereum Sepolia testnet.',
        'Prototype — Swissquote Wallet Challenge (EPFL). Données du compte Swissquote fictives ; données de marché réelles (Yahoo Finance, CoinGecko) ; le wallet fonctionne sur le réseau de test Ethereum Sepolia.',
      )}
    </p>
  );
}

// ── Badges ──
export function MockBadge({ label = 'Mock', className }: { label?: string; className?: string }) {
  return (
    <span
      title={tr('Simulated in this prototype — see the Real / Mock table in the README', 'Simulé dans ce prototype — voir le tableau Réel / Mock du README')}
      className={cx('inline-flex items-center rounded-[4px] border border-dashed border-sq-muted/60 px-1.5 py-px align-middle text-[10px] font-medium uppercase tracking-wider text-sq-muted', className)}
    >
      {label}
    </span>
  );
}

export function NetBadge({ className }: { className?: string }) {
  return <span className={cx('inline-flex items-center rounded-[4px] bg-sq-chip px-1.5 py-px text-[11px] font-medium text-sq-ink-2', className)}>Ethereum Sepolia</span>;
}

export function ChangeBadge({ value, className }: { value: number; className?: string }) {
  const up = value >= 0;
  return (
    <span className={cx('num inline-flex min-w-[62px] shrink-0 justify-center rounded-[4px] px-1.5 py-1.5 text-[13px] font-medium text-white', up ? 'bg-sq-up' : 'bg-sq-down', className)}>
      {up ? '+' : '−'}
      {Math.abs(value).toFixed(2)} %
    </span>
  );
}

export type TxStatus = 'detected' | 'pending' | 'confirmed' | 'failed';
export const STATUS_LABEL: Record<TxStatus, string> = {
  detected: tr('Detected', 'Détectée'),
  pending: tr('Pending', 'En attente'),
  confirmed: tr('Confirmed', 'Confirmée'),
  failed: tr('Failed', 'Échouée'),
};
export function StatusPill({ status, className }: { status: TxStatus; className?: string }) {
  const s = {
    detected: { cls: 'bg-sq-chip text-sq-ink-2', icon: <Info size={13} strokeWidth={2} /> },
    pending: { cls: 'bg-sq-warn-50 text-sq-warn', icon: <Loader2 size={13} strokeWidth={2} className="animate-spin motion-reduce:animate-none" /> },
    confirmed: { cls: 'bg-sq-ok-50 text-sq-up', icon: <Check size={13} strokeWidth={2.5} /> },
    failed: { cls: 'bg-sq-bad-50 text-sq-down', icon: <X size={13} strokeWidth={2.5} /> },
  }[status];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[12px] font-medium', s.cls, (status === 'pending' || status === 'failed') && 'mw-important', className)}>
      {s.icon}
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Surfaces ──
export function Card({ children, className, id, as: As = 'div' }: { children: ReactNode; className?: string; id?: string; as?: 'div' | 'section' }) {
  return (
    <As id={id} className={cx('mw-card rounded-[12px] bg-sq-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)}>
      {children}
    </As>
  );
}

export function Tile({ children, className, to, onClick }: { children: ReactNode; className?: string; to?: string; onClick?: () => void }) {
  const cls = cx('block rounded-[10px] border border-sq-line bg-sq-surface px-3.5 py-3 text-left transition-colors hover:border-sq-muted/50', className);
  if (to)
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx(cls, 'w-full')}>
        {children}
      </button>
    );
  return <div className={cls}>{children}</div>;
}

// ── Buttons ──
export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className,
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}) {
  const styles = {
    primary: 'bg-sq-orange text-white hover:bg-sq-orange-600 active:bg-sq-orange-600',
    secondary: 'border border-sq-line bg-white text-sq-ink hover:border-sq-muted/60',
    danger: 'border border-sq-down/30 bg-white text-sq-down hover:bg-sq-bad-50',
    ghost: 'bg-transparent text-sq-ink-2 hover:bg-sq-chip/60',
    dark: 'bg-sq-dark text-white hover:bg-black',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] px-4 py-3 text-[15px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        /(^|\s)w-/.test(className ?? '') ? '' : 'w-full',
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Round dark quick-action button (Swissquote style). */
export function RoundAction({ icon, label, onClick, to }: { icon: ReactNode; label: string; onClick?: () => void; to?: string }) {
  const inner = (
    <>
      <span className="flex size-12 items-center justify-center rounded-full bg-sq-dark text-white transition-transform duration-150 group-active:scale-95">{icon}</span>
      <span className="text-[13px] font-medium text-sq-ink">{label}</span>
    </>
  );
  const cls = 'group flex min-w-[84px] flex-col items-center gap-2 rounded-lg p-1';
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function IconButton({ label, onClick, children, className }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cx('flex size-11 items-center justify-center rounded-full bg-white text-sq-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-sq-chip/50', className)}>
      {children}
    </button>
  );
}

// ── Forms ──
export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-medium text-sq-ink">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-[13px] text-sq-down">{error}</span> : hint && <span className="mt-1.5 block text-[12px] text-sq-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full min-h-12 rounded-[10px] border border-sq-line bg-white px-3.5 py-3 text-[15px] text-sq-ink outline-none transition placeholder:text-sq-muted/70 focus:border-sq-ink/40 focus-visible:outline-2 focus-visible:outline-sq-orange';

export function SecretInput({ value, onChange, autoComplete = 'new-password', placeholder, id, autoFocus }: { value: string; onChange: (v: string) => void; autoComplete?: string; placeholder?: string; id?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        autoFocus={autoFocus}
        type={show ? 'text' : 'password'}
        className={cx(inputCls, 'pr-12')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={128}
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? tr('Hide', 'Masquer') : tr('Show', 'Afficher')}
        className="absolute inset-y-0 right-1 my-auto flex size-10 items-center justify-center rounded-lg text-sq-muted hover:text-sq-ink"
      >
        {show ? <EyeOff {...ICON} /> : <Eye {...ICON} />}
      </button>
    </div>
  );
}

// ── Tabs & pills ──
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; disabled?: boolean }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-5 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          className={cx(
            'relative min-h-11 shrink-0 pb-2 text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            value === t.id ? 'font-semibold text-sq-ink' : 'text-sq-muted hover:text-sq-ink',
          )}
        >
          {t.label}
          <span className={cx('absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-sq-orange transition-transform duration-200 ease-out', value === t.id ? 'scale-x-100' : 'scale-x-0')} />
        </button>
      ))}
    </div>
  );
}

export function Pill({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx('min-h-9 shrink-0 rounded-full border px-3.5 py-1.5 text-[14px] transition-colors', active ? 'border-sq-chip bg-sq-chip font-medium text-sq-ink' : 'border-sq-line bg-white text-sq-ink-2 hover:border-sq-muted/50')}
    >
      {children}
    </button>
  );
}

// ── Feedback ──
export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={18} strokeWidth={2} className={cx('animate-spin motion-reduce:animate-none', className)} aria-hidden />;
}

export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = {
    info: { cls: 'bg-sq-surface border-sq-line', icon: <Info size={18} strokeWidth={1.75} className="text-sq-muted" /> },
    ok: { cls: 'bg-sq-ok-50 border-sq-up/20', icon: <Check size={18} strokeWidth={2} className="text-sq-up" /> },
    warn: { cls: 'bg-sq-warn-50 border-sq-warn/20', icon: <TriangleAlert size={18} strokeWidth={1.75} className="text-sq-warn" /> },
    bad: { cls: 'bg-sq-bad-50 border-sq-down/20', icon: <CircleAlert size={18} strokeWidth={1.75} className="text-sq-down" /> },
  }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : undefined} className={cx('flex gap-3 rounded-[10px] border p-3.5 text-[14px]', t.cls, (tone === 'warn' || tone === 'bad') && 'mw-important', className)}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0">
        {title && <div className="font-semibold text-sq-ink">{title}</div>}
        {children && <div className={cx(!!title && 'mt-0.5', 'text-sq-ink-2')}>{children}</div>}
      </div>
    </div>
  );
}

/** "Why we ask this" explanation. */
export function Why({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-[10px] bg-sq-surface p-3.5 text-[13px] leading-relaxed text-sq-ink-2">
      <ShieldCheck size={18} strokeWidth={1.75} className="mt-px shrink-0 text-sq-muted" />
      <span>{children}</span>
    </p>
  );
}

export function Checks({ checks }: { checks: PolicyCheck[] }) {
  return (
    <ul className="divide-y divide-sq-line">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-3 py-2.5 text-[14px]">
          <span
            className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white', c.status === 'pass' ? 'bg-sq-up' : c.status === 'step-up' ? 'bg-sq-warn' : 'bg-sq-down')}
            aria-label={c.status === 'pass' ? tr('Passed', 'Réussi') : c.status === 'step-up' ? tr('Extra check', 'Contrôle renforcé') : tr('Refused', 'Refusé')}
          >
            {c.status === 'pass' ? <Check size={12} strokeWidth={3} /> : c.status === 'step-up' ? <span className="text-[11px] font-bold">!</span> : <X size={12} strokeWidth={3} />}
          </span>
          <span>
            <span className="font-medium text-sq-ink">{c.label}</span>
            {c.detail && <span className="block text-[12px] text-sq-muted">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Steps({ total, current, label }: { total: number; current: number; label?: string }) {
  return (
    <div>
      <div className="h-1 overflow-hidden rounded-full bg-sq-line" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} aria-label={label ?? tr(`Step ${current + 1} of ${total}`, `Étape ${current + 1} sur ${total}`)}>
        <div className="h-full rounded-full bg-sq-orange transition-[width] duration-300 ease-out" style={{ width: `${((current + 1) / total) * 100}%` }} />
      </div>
      <div className="mt-2 text-[12px] text-sq-muted">
        {tr(`Step ${current + 1} of ${total}`, `Étape ${current + 1} sur ${total}`)}
        {label ? ` · ${label}` : ''}
      </div>
    </div>
  );
}

export type ProgState = 'todo' | 'doing' | 'done' | 'error';
export function ProgressList({ items }: { items: { label: string; state: ProgState; detail?: ReactNode }[] }) {
  return (
    <ul className="space-y-3.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-start gap-3 text-[14px]">
          <span className="mt-px flex size-5 shrink-0 items-center justify-center">
            {it.state === 'doing' ? (
              <Spinner className="text-sq-orange" />
            ) : it.state === 'done' ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-sq-up text-white">
                <Check size={12} strokeWidth={3} />
              </span>
            ) : it.state === 'error' ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-sq-down text-white">
                <X size={12} strokeWidth={3} />
              </span>
            ) : (
              <span className="size-2 rounded-full bg-sq-line" />
            )}
          </span>
          <span className={cx(it.state === 'todo' ? 'text-sq-muted' : 'text-sq-ink')}>
            {it.label}
            {it.detail && <span className="block text-[12px] text-sq-muted">{it.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-sq-chip/70 motion-reduce:animate-none', className)} />;
}

// ── Formatting ──
const nf = (d: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt = (n: number, d = 2) => nf(d).format(n);
export const chf = (n: number) => `${fmt(n)} CHF`;

/** Big amount + smaller, lighter currency (Swissquote style). */
export function Amount({ value, currency = 'CHF', decimals = 2, className }: { value: number; currency?: string; decimals?: number; className?: string }) {
  const masked = useMasked();
  return (
    <span className={cx('num whitespace-nowrap font-semibold tracking-tight', className)} aria-label={masked ? tr('Amount hidden', 'Montant masqué') : undefined}>
      {masked ? '••••••' : fmt(value, decimals)}
      <span className="ml-1 text-[0.6em] font-normal">{currency}</span>
    </span>
  );
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(locale(), { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' });

export function Addr({ a, full }: { a?: string; full?: boolean }) {
  if (!a) return null;
  return <span className="font-mono text-[13px] break-all">{full ? a : `${a.slice(0, 6)}…${a.slice(-4)}`}</span>;
}

export function TxLink({ hash, children }: { hash?: string; children?: ReactNode }) {
  if (!hash) return null;
  return (
    <a className="inline-flex items-center gap-1 font-medium text-sq-ink underline decoration-sq-line underline-offset-2 hover:decoration-sq-ink" href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
      {children ?? tr('View on Etherscan', 'Voir sur Etherscan')} <ExternalLink size={14} strokeWidth={1.75} />
    </a>
  );
}

export function CopyButton({ value, label = tr('Copy', 'Copier'), sensitive }: { value: string; label?: string; sensitive?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
      if (sensitive)
        // Best effort only: not every platform lets us clear the clipboard.
        setTimeout(() => navigator.clipboard.writeText('').catch(() => undefined), 30_000);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={copy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[14px] font-medium text-sq-ink hover:bg-sq-chip/60">
        {done ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.75} />}
        {done ? tr('Copied', 'Copié') : label}
      </button>
      {done && sensitive && <span className="px-2 text-[12px] text-sq-muted">{tr('Copied. The clipboard contains sensitive data.', 'Copié. Le presse-papiers contient une donnée sensible.')}</span>}
    </span>
  );
}

export function PageHeader({ title, back, right, subtitle }: { title: ReactNode; back?: string; right?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2">
        {back && (
          <Link to={back} className="-ml-2 flex size-11 items-center justify-center rounded-full text-sq-ink hover:bg-sq-chip/60" aria-label={tr('Back', 'Retour')}>
            <ChevronLeft {...ICON} />
          </Link>
        )}
        <h1 className="flex-1 text-[22px] font-semibold tracking-tight">{title}</h1>
        {right}
      </div>
      {subtitle && <p className="mt-1 text-[14px] text-sq-muted">{subtitle}</p>}
    </div>
  );
}

export function useCountdown(until?: string | number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function useMedia(query: string) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}
export const useIsDesktop = () => useMedia('(min-width: 1024px)');
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');
