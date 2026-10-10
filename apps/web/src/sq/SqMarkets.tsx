import { useEffect, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { ChangeBadge, Card, cx, fmt, MockBadge, Pill, Tabs, useReducedMotion } from '../components/ui';
import { SqMobileTop } from './SqShell';
import { CRYPTO, INDICES, jitter, SHARES, SMI_COMPONENTS, type Quote } from './mockMarkets';

type Filter = 'shares' | 'crypto' | 'indices' | 'components';
const LISTS: Record<Filter, { title: string; data: Quote[] }> = {
  shares: { title: 'Popular shares', data: SHARES },
  crypto: { title: 'Crypto', data: CRYPTO },
  indices: { title: 'Indices', data: INDICES },
  components: { title: 'Components of indices', data: SMI_COMPONENTS },
};

function SwissFlag() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#E20E00" />
      <path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill="#fff" />
    </svg>
  );
}

export default function SqMarkets() {
  const [tab, setTab] = useState<'watchlists' | 'inspiration' | 'markets' | 'news' | 'alerts'>('markets');
  const [filter, setFilter] = useState<Filter>('components');
  const [rows, setRows] = useState(LISTS.components.data);
  const [updated, setUpdated] = useState(new Date());
  const reduced = useReducedMotion();

  useEffect(() => setRows(LISTS[filter].data), [filter]);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => {
      setRows((r) => jitter(r));
      setUpdated(new Date());
    }, 5000);
    return () => clearInterval(t);
  }, [reduced, filter]);

  return (
    <div className="mx-auto max-w-[880px]">
      <SqMobileTop />
      <Tabs
        className="mt-1"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'watchlists', label: 'Watchlists' },
          { id: 'inspiration', label: 'Inspiration' },
          { id: 'markets', label: 'Markets' },
          { id: 'news', label: 'News' },
          { id: 'alerts', label: 'Alerts' },
        ]}
      />
      {tab !== 'markets' ? (
        <Card className="mt-4 text-[14px] text-sq-muted">Section non reconstituée dans cette démo.</Card>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {(['shares', 'crypto', 'indices', 'components'] as Filter[]).map((f) => (
              <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </Pill>
            ))}
          </div>
          <p className="num mt-2 text-center text-[13px] text-sq-muted">
            Updated: {updated.toLocaleTimeString('de-CH')} <MockBadge label="Données fictives" className="ml-1" />
          </p>
          <Card className="mt-2 px-0 pb-1 pt-4">
            <div className="flex items-center justify-between px-5">
              <h2 className="text-[17px] font-semibold">{LISTS[filter].title}</h2>
              <button className="inline-flex min-h-11 items-center gap-1 text-[15px] text-sq-orange">
                <ArrowDown size={18} strokeWidth={2} /> Sort
              </button>
            </div>
            {filter === 'components' && (
              <div className="px-5 pb-1">
                <span className="inline-flex items-center gap-2 rounded-full bg-sq-chip px-3 py-1.5 text-[14px] font-medium">
                  <SwissFlag /> SMI <ChevronDown size={16} strokeWidth={1.75} />
                </span>
              </div>
            )}
            <ul>
              {rows.map((q) => (
                <li key={q.symbol}>
                  <button className="flex min-h-[64px] w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-sq-bg/60 sm:gap-3 sm:px-4">
                    {q.index ? <span className="w-8" /> : <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sq-orange text-[13px] font-semibold text-white">T</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] text-sq-ink">{q.symbol}</span>
                      <span className="block text-[11px] uppercase leading-tight tracking-wide text-sq-muted">{q.name}</span>
                    </span>
                    <span className="num whitespace-nowrap text-[15px] text-sq-ink">
                      {fmt(q.price)}
                      <span className="ml-1 text-[12px]">{q.currency}</span>
                    </span>
                    <ChangeBadge value={q.change} />
                    <ChevronRight size={18} strokeWidth={1.75} className={cx('shrink-0 text-sq-muted')} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
