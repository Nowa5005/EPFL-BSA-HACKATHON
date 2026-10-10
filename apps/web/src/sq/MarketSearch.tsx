// Instrument search (round search button in the Swissquote header): debounced /search on the market-data
// service (Yahoo Finance + CoinGecko). Picking a result opens its instrument page.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { cx, ICON, IconButton, Spinner } from '../components/ui';
import { tr } from '../lib/i18n';
import { instrumentPath, marketGet, useDebounced, type Kind } from '../lib/market';
import { kindLabel } from './marketUi';

interface Hit {
  id: string;
  symbol: string;
  name: string;
  kind: Kind;
  exchange: string;
}

export function SearchButton({ className, flat }: { className?: string; flat?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLDivElement>(null);
  return (
    <div ref={btn} className={className}>
      <IconButton label={tr('Search instruments', 'Rechercher un instrument')} onClick={() => setOpen(true)} className={flat ? 'shadow-none' : undefined}>
        <Search {...ICON} />
      </IconButton>
      {open && (
        <SearchDialog
          onClose={() => {
            setOpen(false);
            btn.current?.querySelector('button')?.focus();
          }}
        />
      )}
    </div>
  );
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [state, setState] = useState<{ q: string; hits: Hit[]; error: string | null; loading: boolean }>({ q: '', hits: [], error: null, loading: false });
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!dq) return setState({ q: '', hits: [], error: null, loading: false });
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    marketGet<{ results: Hit[] }>(`/search?q=${encodeURIComponent(dq)}`)
      .then((r) => alive && (setState({ q: dq, hits: r.results, error: null, loading: false }), setActive(0)))
      .catch((e) => alive && setState({ q: dq, hits: [], error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [dq]);

  const go = (h: Hit) => {
    onClose();
    nav(instrumentPath(h.id));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(state.hits.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && state.hits[active] && document.activeElement === input.current) {
      e.preventDefault();
      go(state.hits[active]);
    } else if (e.key === 'Tab') {
      // keep focus inside the dialog
      const f = panel.current?.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])');
      if (!f?.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  useEffect(() => {
    document.getElementById(`sr-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pending = q.trim() !== state.q || state.loading;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 px-3 pt-[max(12px,env(safe-area-inset-top))] sm:pt-20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={tr('Search instruments', 'Rechercher un instrument')} onKeyDown={onKey} className="mw-toast flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[14px] bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-sq-line px-3 py-2">
          <Search size={20} strokeWidth={1.75} className="shrink-0 text-sq-muted" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('Search shares, ETFs, indices, crypto…', 'Rechercher actions, ETF, indices, cryptos…')}
            aria-label={tr('Search', 'Rechercher')}
            role="combobox"
            aria-expanded={state.hits.length > 0}
            aria-controls="market-search-results"
            aria-activedescendant={state.hits.length ? `sr-${active}` : undefined}
            aria-autocomplete="list"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-sq-muted"
            maxLength={50}
          />
          {pending && q.trim() && <Spinner className="text-sq-muted" />}
          <button type="button" onClick={onClose} aria-label={tr('Close search', 'Fermer la recherche')} className="flex size-11 items-center justify-center rounded-full hover:bg-sq-chip/60">
            <X {...ICON} />
          </button>
        </div>
        <div className="overflow-y-auto">
          {!q.trim() ? (
            <p className="px-4 py-6 text-center text-[14px] text-sq-muted">{tr('Type a name or a ticker, e.g. Nestlé, NESN, Bitcoin.', 'Saisissez un nom ou un symbole, p. ex. Nestlé, NESN, Bitcoin.')}</p>
          ) : state.error && !pending ? (
            <p className="px-4 py-6 text-center text-[14px] text-sq-down" role="alert">
              {tr('Search is unavailable right now', 'La recherche est indisponible pour le moment')} ({state.error}).
            </p>
          ) : !pending && state.hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-sq-muted">{tr('No instrument found.', 'Aucun instrument trouvé.')}</p>
          ) : (
            <ul id="market-search-results" role="listbox" aria-label={tr('Results', 'Résultats')} className={cx('py-1', pending && 'opacity-60')}>
              {state.hits.map((h, i) => (
                <li key={h.id} id={`sr-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => go(h)}
                    onMouseEnter={() => setActive(i)}
                    className={cx('flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left', i === active ? 'bg-sq-chip/60' : 'hover:bg-sq-bg')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-sq-ink">{h.name}</span>
                      <span className="block truncate text-[12px] text-sq-muted">
                        {h.symbol} · {kindLabel(h.kind)}
                        {h.exchange ? ` · ${h.exchange}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-t border-sq-line px-4 py-2 text-[11px] text-sq-muted">{tr('Data: Yahoo Finance / CoinGecko. ↑ ↓ to move, Enter to open, Esc to close.', 'Données : Yahoo Finance / CoinGecko. ↑ ↓ pour naviguer, Entrée pour ouvrir, Échap pour fermer.')}</p>
      </div>
    </div>,
    document.body,
  );
}
