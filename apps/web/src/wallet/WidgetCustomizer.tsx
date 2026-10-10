// "Customize" mode of the My Wall home (N6): choose, hide and reorder widgets.
//  - drag and drop with a mouse (HTML5 drag events on each row);
//  - touch: drag by the handle (pointer events, the list does not scroll while a handle is held);
//  - keyboard / screen readers: "Move up" / "Move down" buttons (focus kept on the moved row) and a visibility switch,
//    every change announced in an aria-live region.
// Balances and Main actions are always shown (movable, not removable). No dependency added.

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, GripVertical, RotateCcw } from 'lucide-react';
import { isRequiredWidget, type LayoutAction, type WidgetId, type WidgetKind, type WidgetLayout } from '@sq/shared/widgets';
import { tr } from '../lib/i18n';
import { WIDGET_META, type SaveState } from '../lib/widgets';
import { Button, Card, cx } from '../components/ui';

export function WidgetCustomizer({ layout, dispatch, kind, save, onDone }: { layout: WidgetLayout; dispatch: (a: LayoutAction) => WidgetLayout; kind: WidgetKind; save: SaveState; onDone: () => void }) {
  const [announce, setAnnounce] = useState('');
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusNext = useRef<string | null>(null);
  const n = layout.order.length;

  useEffect(() => {
    if (!focusNext.current) return;
    const [id, dir] = focusNext.current.split(':');
    focusNext.current = null;
    const root = listRef.current;
    const btn = root?.querySelector<HTMLButtonElement>(`[data-move="${id}:${dir}"]`);
    const other = root?.querySelector<HTMLButtonElement>(`[data-move="${id}:${dir === 'up' ? 'down' : 'up'}"]`);
    (btn && !btn.disabled ? btn : other)?.focus();
  });

  const say = (id: WidgetId, l: WidgetLayout) =>
    setAnnounce(tr(`${WIDGET_META[id].label}: position ${l.order.indexOf(id) + 1} of ${n}.`, `${WIDGET_META[id].label} : position ${l.order.indexOf(id) + 1} sur ${n}.`));

  const move = (id: WidgetId, delta: number) => {
    const l = dispatch({ type: 'move', id, delta });
    focusNext.current = `${id}:${delta < 0 ? 'up' : 'down'}`;
    say(id, l);
  };
  const moveTo = (id: WidgetId, index: number) => {
    const l = dispatch({ type: 'moveTo', id, index });
    say(id, l);
  };
  const toggle = (id: WidgetId, show: boolean) => {
    dispatch({ type: show ? 'show' : 'hide', id });
    setAnnounce(show ? tr(`${WIDGET_META[id].label} shown.`, `${WIDGET_META[id].label} affiché.`) : tr(`${WIDGET_META[id].label} hidden.`, `${WIDGET_META[id].label} masqué.`));
  };

  /** Index where a pointer at clientY would drop (between rows). */
  const indexAt = (clientY: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-widget-row]') ?? [])];
    let i = 0;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (clientY > b.top + b.height / 2) i++;
    }
    return i;
  };
  const finishDrop = (id: WidgetId, slot: number) => {
    const from = layout.order.indexOf(id);
    const to = slot > from ? slot - 1 : slot; // slot counts the dragged row itself
    if (to !== from) moveTo(id, to);
    setDragId(null);
    setDropAt(null);
  };

  return (
    <Card as="section" className="mw-customize space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold">{tr('Customize your home', 'Personnaliser votre accueil')}</h2>
          <p className="mt-0.5 text-[13px] text-sq-muted">
            {kind === 'desktop'
              ? tr('Layout for computers. Drag a row, or use the arrows. Your phone has its own layout.', 'Disposition pour ordinateur. Glissez une ligne ou utilisez les flèches. Votre téléphone a sa propre disposition.')
              : tr('Layout for this phone. Hold the handle to drag, or use the arrows. Your computer has its own layout.', 'Disposition pour téléphone. Maintenez la poignée pour glisser, ou utilisez les flèches. Votre ordinateur a sa propre disposition.')}
          </p>
        </div>
      </div>
      <p aria-live="polite" role="status" className="sr-only" data-testid="widget-announce">
        {announce}
      </p>
      <ol ref={listRef} className="space-y-2" aria-label={tr('Home widgets, in display order', 'Widgets de l’accueil, dans l’ordre d’affichage')} data-testid="widget-list">
        {layout.order.map((id, i) => {
          const required = isRequiredWidget(id);
          const shown = !layout.hidden.includes(id);
          const meta = WIDGET_META[id];
          return (
            <li
              key={id}
              data-widget-row={id}
              draggable
              onDragStart={(e) => {
                setDragId(id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropAt(indexAt(e.clientY));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) finishDrop(dragId, indexAt(e.clientY));
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              className={cx(
                'mw-widget-row relative flex items-center gap-2 rounded-[12px] border bg-sq-surface py-2 pl-1 pr-2',
                dragId === id ? 'border-sq-orange opacity-60' : 'border-sq-line',
                !shown && 'bg-sq-bg',
              )}
            >
              {dropAt === i && dragId && <span aria-hidden className="absolute inset-x-2 -top-[5px] h-[3px] rounded-full bg-sq-orange" />}
              {dropAt === n && i === n - 1 && dragId && <span aria-hidden className="absolute inset-x-2 -bottom-[5px] h-[3px] rounded-full bg-sq-orange" />}
              <DragHandle id={id} label={meta.label} onDrag={(y) => setDropAt(indexAt(y))} onStart={() => setDragId(id)} onDrop={(y) => finishDrop(id, indexAt(y))} onCancel={() => { setDragId(null); setDropAt(null); }} />
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[15px] font-medium', !shown && 'text-sq-muted')}>{meta.label}</span>
                <span className="block text-[12px] text-sq-muted">{required ? tr('Always shown', 'Toujours affiché') : meta.desc}</span>
              </span>
              <label className={cx('flex min-h-11 shrink-0 items-center gap-2 px-1 text-[13px]', required ? 'text-sq-muted' : 'cursor-pointer text-sq-ink-2')}>
                <input
                  type="checkbox"
                  role="switch"
                  className="size-5 accent-[var(--color-sq-orange)]"
                  checked={shown}
                  disabled={required}
                  onChange={(e) => toggle(id, e.target.checked)}
                  aria-label={tr(`Show ${meta.label}`, `Afficher ${meta.label}`)}
                />
                <span aria-hidden className="hidden sm:inline">{tr('Show', 'Afficher')}</span>
              </label>
              <button
                type="button"
                data-move={`${id}:up`}
                disabled={i === 0}
                onClick={() => move(id, -1)}
                aria-label={tr(`Move ${meta.label} up`, `Monter ${meta.label}`)}
                title={tr('Move up', 'Monter')}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-sq-ink hover:bg-sq-chip/60 disabled:opacity-30"
              >
                <ArrowUp size={18} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                data-move={`${id}:down`}
                disabled={i === n - 1}
                onClick={() => move(id, 1)}
                aria-label={tr(`Move ${meta.label} down`, `Descendre ${meta.label}`)}
                title={tr('Move down', 'Descendre')}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-sq-ink hover:bg-sq-chip/60 disabled:opacity-30"
              >
                <ArrowDown size={18} strokeWidth={1.75} />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="w-auto px-5" onClick={onDone}>
          <Check size={18} strokeWidth={2} /> {tr('Done', 'Terminé')}
        </Button>
        <Button
          variant="secondary"
          className="w-auto px-4"
          onClick={() => {
            dispatch({ type: 'reset' });
            setAnnounce(tr('Default layout restored.', 'Disposition par défaut rétablie.'));
          }}
        >
          <RotateCcw size={16} strokeWidth={1.75} /> {tr('Reset to default', 'Rétablir par défaut')}
        </Button>
        <span className="text-[12px] text-sq-muted" data-testid="widget-save-state">
          {save === 'saving'
            ? tr('Saving…', 'Enregistrement…')
            : save === 'saved'
              ? tr('Saved to your profile', 'Enregistré dans votre profil')
              : save === 'local-only'
                ? tr('Saved on this device only (server unreachable)', 'Enregistré sur cet appareil seulement (serveur injoignable)')
                : ''}
        </span>
      </div>
    </Card>
  );
}

/** Touch / pen drag handle (pointer events). Mouse users drag the whole row (HTML5 drag and drop). */
function DragHandle({ label, onStart, onDrag, onDrop, onCancel }: { id: WidgetId; label: string; onStart: () => void; onDrag: (y: number) => void; onDrop: (y: number) => void; onCancel: () => void }) {
  const active = useRef(false);
  return (
    <span
      aria-hidden
      title={tr(`Drag ${label}`, `Glisser ${label}`)}
      style={{ touchAction: 'none' }}
      className="flex h-11 w-9 shrink-0 cursor-grab items-center justify-center rounded-lg text-sq-muted active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return; // mouse: native row drag
        active.current = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        onStart();
        onDrag(e.clientY);
      }}
      onPointerMove={(e) => active.current && onDrag(e.clientY)}
      onPointerUp={(e) => {
        if (!active.current) return;
        active.current = false;
        onDrop(e.clientY);
      }}
      onPointerCancel={() => {
        active.current = false;
        onCancel();
      }}
    >
      <GripVertical size={18} strokeWidth={1.75} />
    </span>
  );
}
