// Shared bits for the content tabs (News, Inspiration, Watchlist, Alerts) and the reader view.

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Coins, Globe2, Landmark, LineChart, Newspaper, ShieldCheck, Layers, Receipt, Activity, ArrowLeftRight, CircleDollarSign } from 'lucide-react';
import { cx } from '../../components/ui';
import { locale, tr } from '../../lib/i18n';
import type { Article } from '../../lib/market';

/** Decodes the HTML entities some feeds leave in titles/summaries (e.g. &#x201c;). Text only, never rendered as HTML. */
export function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '’')
    .replace(/&amp;/g, '&');
}

export const zurichDateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const zurichTime = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });

const LANG_NAMES: Record<string, [string, string]> = { en: ['English', 'anglais'], fr: ['French', 'français'], de: ['German', 'allemand'], it: ['Italian', 'italien'] };
/** "Article in English" — shown when the article language differs from the UI language. */
export const langLabel = (l: string) => {
  const n = LANG_NAMES[l] ?? [l, l];
  return tr(`Article in ${n[0]}`, `Article en ${n[1]}`);
};

// ───────────── News cache (so the reader and the list show the same items without refetching) ─────────────
export type NewsTopic = 'all' | 'markets' | 'companies' | 'economy' | 'crypto';
export interface NewsPayload {
  articles: Article[];
  fetchedAt: string;
  stale: boolean;
  failedSources: string[];
}
export const newsCache = new Map<NewsTopic, NewsPayload>();
export const findCachedArticle = (id: string) => {
  for (const p of newsCache.values()) {
    const a = p.articles.find((x) => x.id === id);
    if (a) return a;
  }
  return null;
};

// ───────────── List memory: scroll position, filter and the card to refocus when coming back from the reader ─────────────
type ListKind = 'news' | 'inspiration';
const memory: Record<ListKind, { scrollY: number; cardId: string; cardTop: number | null; pending: boolean } | null> = { news: null, inspiration: null };
export const listFilters: { news: NewsTopic; inspiration: string } = { news: 'all', inspiration: 'all' };

export function useOpenReader(kind: ListKind) {
  const nav = useNavigate();
  return (id: string) => {
    const card = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
    memory[kind] = { scrollY: window.scrollY, cardId: id, cardTop: card ? card.getBoundingClientRect().top : null, pending: true };
    nav(`/sq/read/${kind}/${encodeURIComponent(id)}`, { state: { from: `/sq/markets?tab=${kind === 'news' ? 'news' : 'inspiration'}` } });
  };
}

/** Restores the list's scroll position and focuses the originating card once the list is rendered (`ready`). */
export function useRestoreList(kind: ListKind, ready: boolean) {
  useLayoutEffect(() => {
    const m = memory[kind];
    if (!ready || !m?.pending) return;
    m.pending = false;
    // Put the originating card back at the same place in the viewport (robust to content above it that
    // renders a bit later), falling back to the raw scroll position.
    const restore = () => {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(m.cardId)}"]`);
      if (el && m.cardTop !== null) window.scrollBy({ top: el.getBoundingClientRect().top - m.cardTop, behavior: 'instant' as ScrollBehavior });
      else window.scrollTo({ top: m.scrollY, behavior: 'instant' as ScrollBehavior });
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    };
    restore();
    // Layout may still settle (late content, fonts): re-apply a few times unless the user has scrolled meanwhile.
    let userScrolled = false;
    const onUser = () => (userScrolled = true);
    window.addEventListener('wheel', onUser, { passive: true });
    window.addEventListener('touchmove', onUser, { passive: true });
    window.addEventListener('keydown', onUser);
    const timers = [50, 200, 500].map((ms) => setTimeout(() => !userScrolled && restore(), ms));
    const stop = setTimeout(() => {
      window.removeEventListener('wheel', onUser);
      window.removeEventListener('touchmove', onUser);
      window.removeEventListener('keydown', onUser);
    }, 600);
    return () => {
      [...timers, stop].forEach(clearTimeout);
      window.removeEventListener('wheel', onUser);
      window.removeEventListener('touchmove', onUser);
      window.removeEventListener('keydown', onUser);
    };
  }, [kind, ready]);
}

// ───────────── Illustrations (inline SVG, no third-party images) ─────────────
const THEMES: Record<string, { bg: string; fg: string; Icon: typeof Newspaper }> = {
  markets: { bg: '#FFF1E6', fg: '#E8590C', Icon: LineChart },
  companies: { bg: '#EEF2FF', fg: '#4338CA', Icon: Building2 },
  economy: { bg: '#ECFDF5', fg: '#047857', Icon: Landmark },
  crypto: { bg: '#F5F3FF', fg: '#6D28D9', Icon: Coins },
  news: { bg: '#F3F4F6', fg: '#4B5563', Icon: Newspaper },
  diversification: { bg: '#ECFDF5', fg: '#047857', Icon: Layers },
  etf: { bg: '#FFF1E6', fg: '#E8590C', Icon: Globe2 },
  fees: { bg: '#FEF3C7', fg: '#B45309', Icon: Receipt },
  volatility: { bg: '#FEE2E2', fg: '#B91C1C', Icon: Activity },
  security: { bg: '#EEF2FF', fg: '#4338CA', Icon: ShieldCheck },
  orders: { bg: '#E0F2FE', fg: '#0369A1', Icon: ArrowLeftRight },
  stablecoins: { bg: '#F5F3FF', fg: '#6D28D9', Icon: CircleDollarSign },
};

/** Neutral illustration (topic icon on a tinted background with an abstract pattern). Never a photo of an event. */
export function Illustration({ theme, label, className, big }: { theme: string; label: string; className?: string; big?: boolean }) {
  const t = THEMES[theme] ?? THEMES.news;
  return (
    <div role="img" aria-label={label} className={cx('relative flex items-center justify-center overflow-hidden', className)} style={{ background: t.bg }}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <circle cx="270" cy="30" r="70" fill={t.fg} opacity="0.07" />
        <circle cx="40" cy="170" r="60" fill={t.fg} opacity="0.06" />
        <path d="M0 140 C 60 120, 90 150, 150 110 S 260 90, 320 60" fill="none" stroke={t.fg} strokeWidth="3" opacity="0.18" />
      </svg>
      <t.Icon size={big ? 56 : 36} strokeWidth={1.5} color={t.fg} aria-hidden className="relative" />
    </div>
  );
}

/** Article / card image with a credit line; falls back to the illustration if the image fails to load. */
export function NewsImage({ a, className, big }: { a: Article; className?: string; big?: boolean }) {
  const theme = a.topics[0] ?? 'news';
  const [failed, setFailed] = useState(false);
  if (!a.image || failed)
    return <Illustration theme={theme} big={big} className={className} label={tr('Illustration (no image supplied by the source) — not a photo of the event', 'Illustration (aucune image fournie par la source) — pas une photo de l’événement')} />;
  return (
    <figure className={cx('relative overflow-hidden bg-sq-chip', className)}>
      <img
        src={a.image.url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
      <figcaption className="absolute bottom-0 right-0 rounded-tl-[6px] bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{tr(`Image: ${a.image.credit}`, `Image : ${a.image.credit}`)}</figcaption>
    </figure>
  );
}

export function StateCard({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'bad' }) {
  return <div className={cx('mt-4 rounded-[12px] bg-white p-5 text-[14px]', tone === 'bad' ? 'text-sq-down' : 'text-sq-muted')}>{children}</div>;
}
