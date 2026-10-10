// Informations: three STABLE categories (no carousel). Personal alerts (A, and C "action requise")
// are never mixed with general market content (B).

import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ActivityEvent } from '@sq/shared';
import { cosigner } from '../lib/api';
import { useLocal, usePoll, useReadState, useWalletTxs } from '../lib/hooks';
import { Card, cx, dateTime, MockBadge, Pill, Tabs, useMedia } from '../components/ui';
import { MARKET_NEWS, RELEASES } from './mockNews';

type Cat = 'tx' | 'market' | 'updates';
const CATS: { id: Cat; label: string; short: string }[] = [
  { id: 'tx', label: 'Mes transactions', short: 'Transactions' },
  { id: 'market', label: 'Marché crypto', short: 'Marché' },
  { id: 'updates', label: 'Mises à jour de My Wall', short: 'Mises à jour' },
];

const TX_TYPES = /^(wallet-tx\.|tx\.executed|tx\.failed|tx\.rejected|tx\.step-up|recovery\.(completed|requested|refused)|wallet\.deployed)/;

interface Item {
  id: string;
  title: string;
  summary?: string;
  date: string;
  to?: string;
  badges?: string[];
  source?: string;
  action?: { label: string; to: string };
  group?: string;
  body?: string;
}

function useItems(): Record<Cat, Item[]> {
  const { device } = useLocal();
  const { data: events } = usePoll<ActivityEvent[]>(() => cosigner.get(`/clients/${device!.clientId}/activity`), 8000, [device?.clientId]);
  const { data: txs } = useWalletTxs(8000);
  const linkFor = (e: ActivityEvent) => {
    const id = (e.data as any)?.walletTxId ?? txs?.find((t) => e.txHash && t.txHash?.toLowerCase() === e.txHash.toLowerCase())?.id;
    return id ? `/wallet/tx/${id}` : '/wallet/transactions';
  };
  return {
    tx: (events ?? [])
      .filter((e) => TX_TYPES.test(e.type))
      .map((e) => ({
        id: `a:${e.id}`,
        title: e.message,
        date: e.ts,
        to: linkFor(e),
        group: /receive|Réception/i.test(e.message) ? 'in' : /failed|rejected|refused/.test(e.type) ? 'alert' : 'out',
      })),
    market: MARKET_NEWS.map((n) => ({ id: `b:${n.id}`, title: n.title, summary: n.summary, body: n.body, date: n.publishedAt, badges: n.assets, source: n.source })),
    updates: RELEASES.map((r) => ({ id: `c:${r.id}`, title: r.title, summary: r.body, body: r.body, date: r.date, action: r.action, group: r.action ? 'action' : 'news' })),
  };
}

const FILTERS: Record<Cat, { id: string; label: string; test: (i: Item) => boolean }[]> = {
  tx: [
    { id: 'all', label: 'Tout', test: () => true },
    { id: 'in', label: 'Réceptions', test: (i) => i.group === 'in' },
    { id: 'out', label: 'Envois', test: (i) => i.group === 'out' },
    { id: 'alert', label: 'Échecs', test: (i) => i.group === 'alert' },
  ],
  market: [
    { id: 'all', label: 'Tout', test: () => true },
    { id: 'ETH', label: 'ETH', test: (i) => !!i.badges?.includes('ETH') },
    { id: 'USDC', label: 'USDC', test: (i) => !!i.badges?.includes('USDC') },
  ],
  updates: [
    { id: 'all', label: 'Tout', test: () => true },
    { id: 'action', label: 'Action requise', test: (i) => !!i.action },
    { id: 'news', label: 'Nouveautés', test: (i) => !i.action },
  ],
};

function Row({ it, unread, onOpen }: { it: Item; unread: boolean; onOpen: () => void }) {
  return (
    <li className="border-b border-sq-line last:border-0">
      <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-start gap-3 py-3 text-left hover:bg-sq-bg/50">
        <span className={cx('mt-2 size-2 shrink-0 rounded-full', unread ? 'bg-sq-orange' : 'bg-transparent')} aria-label={unread ? 'Non lu' : undefined} />
        <span className="min-w-0 flex-1">
          {it.action && <span className="mb-1 inline-block rounded-[4px] bg-sq-orange-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-sq-orange-600">Action requise</span>}
          <span className={cx('block text-[14px] leading-snug', unread ? 'font-semibold text-sq-ink' : 'text-sq-ink-2')}>{it.title}</span>
          {it.summary && <span className="mt-0.5 line-clamp-2 block text-[13px] text-sq-muted">{it.summary}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-sq-muted">
            {dateTime(it.date)}
            {it.source && <span>· {it.source}</span>}
            {it.badges?.map((b) => (
              <span key={b} className="rounded-[4px] bg-sq-chip px-1.5 py-px text-[11px] font-medium text-sq-ink-2">
                {b}
              </span>
            ))}
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} className="mt-1 shrink-0 text-sq-muted" />
      </button>
    </li>
  );
}

export function InfoPanel({ cat, items, limit, filter, setFilter, open }: { cat: Cat; items: Item[]; limit?: number; filter: string; setFilter: (f: string) => void; open: (it: Item) => void }) {
  const { isRead } = useReadState();
  const f = FILTERS[cat].find((x) => x.id === filter) ?? FILTERS[cat][0];
  const list = items.filter(f.test).slice(0, limit ?? 100);
  return (
    <div>
      <div className="mb-1 flex gap-2 overflow-x-auto pb-1">
        {FILTERS[cat].map((x) => (
          <Pill key={x.id} active={x.id === f.id} onClick={() => setFilter(x.id)}>
            {x.label}
          </Pill>
        ))}
      </div>
      {cat === 'market' && <p className="mb-1 text-[12px] text-sq-muted">Contenu de démonstration — pas des actualités réelles.</p>}
      {list.length ? (
        <ul>
          {list.map((it) => (
            <Row key={it.id} it={it} unread={!isRead(it.id)} onOpen={() => open(it)} />
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-[14px] text-sq-muted">Rien pour l'instant.</p>
      )}
    </div>
  );
}

/** Used both on /wallet/info and as the "Informations" widget of the home screen. */
export function InfoBoard({ limit }: { limit?: number }) {
  const [params, setParams] = useSearchParams();
  const isDesktop = useMedia('(min-width: 1024px)');
  const items = useItems();
  const { mark } = useReadState();
  const cat = (params.get('cat') as Cat) ?? 'tx';
  const filterOf = (c: Cat) => params.get(`f-${c}`) ?? 'all';
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };
  const open = (it: Item) => {
    mark(it.id);
    const p = new URLSearchParams(params);
    p.set('item', it.id);
    setParams(p);
  };
  const itemId = params.get('item');
  const detail = itemId ? [...items.tx, ...items.market, ...items.updates].find((i) => i.id === itemId) : null;

  if (detail)
    return (
      <Card>
        <button
          type="button"
          className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[14px] font-medium text-sq-ink-2"
          onClick={() => {
            const p = new URLSearchParams(params);
            p.delete('item');
            setParams(p);
          }}
        >
          <ChevronLeft size={18} strokeWidth={1.75} /> Retour (filtres conservés)
        </button>
        {detail.action && <span className="mb-2 inline-block rounded-[4px] bg-sq-orange-50 px-1.5 py-px text-[11px] font-semibold uppercase text-sq-orange-600">Action requise</span>}
        <h2 className="text-[18px] font-semibold leading-snug">{detail.title}</h2>
        <p className="mt-1 text-[12px] text-sq-muted">
          {dateTime(detail.date)}
          {detail.source && ` · ${detail.source}`}
          {detail.id.startsWith('b:') && (
            <>
              {' '}
              · <MockBadge label="Démo" />
            </>
          )}
        </p>
        {detail.body && <p className="mt-3 text-[15px] leading-relaxed text-sq-ink-2">{detail.body}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          {detail.to && (
            <Link to={detail.to} className="inline-flex min-h-11 items-center rounded-[10px] border border-sq-line px-4 text-[14px] font-semibold">
              Voir la transaction
            </Link>
          )}
          {detail.action && (
            <Link to={detail.action.to} className="inline-flex min-h-11 items-center rounded-[10px] bg-sq-orange px-4 text-[14px] font-semibold text-white">
              {detail.action.label}
            </Link>
          )}
        </div>
      </Card>
    );

  if (isDesktop)
    return (
      <div className="grid grid-cols-3 gap-4">
        {CATS.map((c) => (
          <Card key={c.id} className="min-w-0">
            <h3 className="mb-3 text-[16px] font-semibold">{c.label}</h3>
            <InfoPanel cat={c.id} items={items[c.id]} limit={limit} filter={filterOf(c.id)} setFilter={(f) => setParam(`f-${c.id}`, f)} open={open} />
          </Card>
        ))}
      </div>
    );

  return (
    <Card>
      <Tabs value={cat} onChange={(c) => setParam('cat', c)} tabs={CATS.map((c) => ({ id: c.id, label: c.short }))} />
      <div className="mt-3">
        <InfoPanel cat={cat} items={items[cat]} limit={limit} filter={filterOf(cat)} setFilter={(f) => setParam(`f-${cat}`, f)} open={open} />
      </div>
    </Card>
  );
}

export default function InfoPage() {
  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight">Informations</h1>
      <p className="mb-4 text-[14px] text-sq-muted">Vos événements, l'actualité crypto et les nouveautés de My Wall — chacun à sa place.</p>
      <InfoBoard />
    </div>
  );
}
