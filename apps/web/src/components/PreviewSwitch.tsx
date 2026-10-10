// Owner-only "Web | App" preview switch (iteration 4, section 20). Not part of the customer journey:
// rendered only in dev (import.meta.env.DEV) or after ?preview=1, and never in app mode (native app / preview frame).
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Monitor, Smartphone, X } from 'lucide-react';
import { tr } from '../lib/i18n';
import { previewToolEnabled } from '../lib/platform';
import { PREVIEW_PATH, previewUrlFor, safeAppPath } from '../lib/previewPaths';
import { cx } from './ui';

const COLLAPSED_KEY = 'mw:preview-collapsed';

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Route currently shown inside the app frame (reported by the frame), used by "Web" to open the same screen. */
let framePath: string | null = null;
export const setPreviewFramePath = (p: string) => {
  framePath = p;
};

export default function PreviewSwitch() {
  const [enabled] = useState(previewToolEnabled);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    try {
      if (collapsed) localStorage.setItem(COLLAPSED_KEY, '1');
      else localStorage.removeItem(COLLAPSED_KEY);
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  if (!enabled) return null;

  const inApp = loc.pathname === PREVIEW_PATH;
  const toWeb = () => {
    if (!inApp) return;
    // Full load: the web view re-reads the session the app frame may have changed (same origin, same storage).
    window.location.assign(safeAppPath(framePath, safeAppPath(new URLSearchParams(loc.search).get('path'))));
  };
  const toApp = () => !inApp && nav(previewUrlFor(loc.pathname + loc.search));

  if (collapsed)
    return (
      <button
        type="button"
        data-testid="preview-switch-open"
        onClick={() => setCollapsed(false)}
        aria-label={tr('Show the Web / App preview switch', 'Afficher le sélecteur d’aperçu Web / App')}
        title={tr('Preview: Web / App (owner tool)', 'Aperçu : Web / App (outil propriétaire)')}
        className="fixed bottom-[calc(124px+env(safe-area-inset-bottom))] left-2 z-[60] flex size-11 items-center justify-center rounded-full border border-sq-line bg-white/95 text-sq-ink-2 shadow-md lg:bottom-4"
      >
        {inApp ? <Smartphone size={18} strokeWidth={1.75} /> : <Monitor size={18} strokeWidth={1.75} />}
      </button>
    );

  const seg = (active: boolean) =>
    cx('flex min-h-11 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold', active ? 'bg-sq-ink text-white' : 'text-sq-ink-2 hover:bg-sq-chip/60');
  return (
    <div
      data-testid="preview-switch"
      role="group"
      aria-label={tr('Preview mode (owner tool)', 'Mode d’aperçu (outil propriétaire)')}
      className="fixed bottom-[calc(124px+env(safe-area-inset-bottom))] left-2 z-[60] flex items-center gap-1 rounded-[12px] border border-sq-line bg-white/95 p-1 shadow-md backdrop-blur lg:bottom-4"
    >
      <span className="hidden px-1.5 text-[11px] font-semibold uppercase tracking-wide text-sq-muted sm:inline">{tr('Preview', 'Aperçu')}</span>
      <button type="button" aria-pressed={!inApp} onClick={toWeb} className={seg(!inApp)}>
        <Monitor size={16} strokeWidth={1.75} /> Web
      </button>
      <button type="button" aria-pressed={inApp} onClick={toApp} className={seg(inApp)}>
        <Smartphone size={16} strokeWidth={1.75} /> App
      </button>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        aria-label={tr('Hide the preview switch', 'Masquer le sélecteur d’aperçu')}
        className="flex size-11 items-center justify-center rounded-[8px] text-sq-muted hover:bg-sq-chip/60"
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
