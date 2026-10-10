// Instrument search backed by market-data /search (Yahoo Finance + CoinGecko) — used to add to the watchlist
// and to pick an alert's instrument.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { inputCls, Spinner } from '../../components/ui';
import { tr } from '../../lib/i18n';
import { marketGet, useDebounced, type Kind } from '../../lib/market';

export interface SearchHit {
  id: string;
  symbol: string;
  name: string;
  kind: Kind;
  exchange: string;
}

export const kindLabel = (k: Kind) => ({ equity: tr('Share', 'Action'), etf: 'ETF', index: tr('Index', 'Indice'), crypto: 'Crypto' })[k] ?? k;

export function InstrumentSearch({ label, action, autoFocus }: { label: string; action: (h: SearchHit) => ReactNode; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 350);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    if (dq.length < 1) {
      setHits(null);
      setErr(null);
      return;
    }
    let alive = true;
    setBusy(true);
    marketGet<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(dq)}`)
      .then((r) => alive && (setHits(r.results), setErr(null)))
      .catch((e) => alive && (setErr(e.message), setHits(null)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [dq]);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-medium text-sq-ink">
        {label}
      </label>
      <div className="relative">
        <Search size={18} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sq-muted" aria-hidden />
        <input
          id={id}
          type="search"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Name, ticker or crypto (e.g. Nestlé, AAPL, bitcoin)', 'Nom, symbole ou crypto (ex. Nestlé, AAPL, bitcoin)')}
          className={inputCls + ' pl-10'}
          autoComplete="off"
          maxLength={50}
        />
        {busy && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-sq-muted" />}
      </div>
      <div aria-live="polite">
        {err && <p className="mt-2 text-[13px] text-sq-down">{tr('Search unavailable right now.', 'Recherche indisponible pour le moment.')}</p>}
        {hits && hits.length === 0 && <p className="mt-2 text-[13px] text-sq-muted">{tr('No instrument found.', 'Aucun instrument trouvé.')}</p>}
      </div>
      {hits && hits.length > 0 && (
        <ul className="mt-2 divide-y divide-sq-line rounded-[10px] border border-sq-line bg-white">
          {hits.map((h) => (
            <li key={h.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-sq-ink">{h.name}</span>
                <span className="block text-[12px] text-sq-muted">
                  {h.symbol} · {kindLabel(h.kind)}
                  {h.exchange && ` · ${h.exchange}`}
                </span>
              </span>
              {action(h)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
