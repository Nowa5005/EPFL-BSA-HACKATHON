// DEMO order ticket: opened by Buy / Sell on an instrument page with the instrument preselected.
// It NEVER places an order — there is no order route anywhere in this prototype and the submit button is disabled.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, cx, fmt, ICON, inputCls, MockBadge, Notice } from '../components/ui';
import { tr } from '../lib/i18n';
import type { Quote } from '../lib/market';
import { fmtPrice } from './marketUi';

export function OrderTicket({ instrument, quote, side: initialSide, onClose }: { instrument: { id: string; symbol: string; name: string; currency: string }; quote: Quote | null; side: 'buy' | 'sell'; onClose: () => void }) {
  const [side, setSide] = useState(initialSide);
  const [qty, setQty] = useState('1');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [limit, setLimit] = useState(quote ? String(Number(quote.price.toFixed(quote.price < 1 ? 4 : 2))) : '');
  const panel = useRef<HTMLDivElement>(null);
  const n = Number(qty.replace(',', '.'));
  const px = type === 'limit' ? Number(limit.replace(',', '.')) : quote?.price ?? NaN;
  const est = Number.isFinite(n) && n > 0 && Number.isFinite(px) ? n * px : null;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // portal: the page container has its own stacking context (page animation), so the sheet must live under <body>
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="ticket-title" className="mw-sheet-up max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-t-[16px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-xl sm:rounded-[16px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ticket-title" className="text-[18px] font-semibold">
              {tr('Order ticket', 'Ordre')} <MockBadge label={tr('Demo', 'Démo')} className="ml-1" />
            </h2>
            <p className="text-[14px] text-sq-ink-2">
              {instrument.name} · <span className="num">{instrument.symbol}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={tr('Close', 'Fermer')} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-sq-chip/60">
            <X {...ICON} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-full bg-sq-bg p-1" role="radiogroup" aria-label={tr('Side', 'Sens')}>
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              data-autofocus={side === s ? '' : undefined}
              onClick={() => setSide(s)}
              className={cx('min-h-10 rounded-full text-[15px]', side === s ? 'bg-white font-semibold shadow-sm' : 'text-sq-ink-2')}
            >
              {s === 'buy' ? tr('Buy', 'Acheter') : tr('Sell', 'Vendre')}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3 text-[14px]">
          <label className="block">
            <span className="mb-1 block text-sq-ink-2">{tr('Quantity', 'Quantité')}</span>
            <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sq-ink-2">{tr('Order type', 'Type d’ordre')}</span>
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'market' | 'limit')}>
              <option value="market">{tr('Market', 'Au marché')}</option>
              <option value="limit">{tr('Limit', 'Limite')}</option>
            </select>
          </label>
          {type === 'limit' && (
            <label className="block">
              <span className="mb-1 block text-sq-ink-2">
                {tr('Limit price', 'Prix limite')} ({instrument.currency})
              </span>
              <input className={inputCls} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
          )}
          <div className="flex justify-between rounded-[10px] bg-sq-bg px-3 py-2.5">
            <span className="text-sq-ink-2">{tr('Indicative value', 'Valeur indicative')}</span>
            <span className="num font-semibold">{est != null ? `${fmt(est)} ${instrument.currency}` : '—'}</span>
          </div>
          {quote && (
            <p className="text-[12px] text-sq-muted">
              {tr('Based on the last price shown', 'Basé sur le dernier cours affiché')} ({fmtPrice(quote.price)} {quote.currency}, {quote.provider}). {tr('Not an executable quote; fees not included.', 'Pas un cours exécutable ; frais non inclus.')}
            </p>
          )}
        </div>

        <Notice tone="warn" className="mt-4" title={tr('Order placement isn’t available in this prototype', 'Le passage d’ordres n’est pas disponible dans ce prototype')}>
          {tr('This ticket is a demonstration of the flow only: nothing is sent to an exchange and no order is created.', 'Ce ticket ne fait que démontrer le parcours : rien n’est envoyé à une bourse et aucun ordre n’est créé.')}
        </Notice>
        <Button className="mt-4" disabled ariaLabel={tr('Place order — unavailable in this prototype', 'Passer l’ordre — indisponible dans ce prototype')}>
          {side === 'buy' ? tr('Place buy order', 'Passer l’ordre d’achat') : tr('Place sell order', 'Passer l’ordre de vente')}
        </Button>
        <Button variant="ghost" className="mt-2" onClick={onClose}>
          {tr('Close', 'Fermer')}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
