// Owner tool: "App" preview. A phone-sized frame showing the SAME app (same origin, same services, same
// localStorage session) rendered in app mode. It is a browser preview, NOT the native build (see docs/MOBILE.md).
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ExternalLink, RefreshCw, RotateCw, Smartphone } from 'lucide-react';
import { tr } from '../lib/i18n';
import { PREVIEW_FRAME_NAME, previewToolEnabled } from '../lib/platform';
import { frameSrc, safeAppPath, stripAppFlag } from '../lib/previewPaths';
import { setPreviewFramePath } from '../components/PreviewSwitch';
import { cx } from '../components/ui';

const DEVICES = [
  { id: 'iphone15', label: 'iPhone 15', w: 390, h: 844 },
  { id: 'iphonese', label: 'iPhone SE', w: 375, h: 667 },
  { id: 'pixel7', label: 'Pixel 7', w: 412, h: 915 },
  { id: 'android-s', label: tr('Small Android', 'Petit Android'), w: 360, h: 800 },
] as const;
const DEVICE_KEY = 'mw:preview-device';
const BEZEL = 12;

export default function PreviewApp() {
  const loc = useLocation();
  const [enabled] = useState(previewToolEnabled);
  const startPath = safeAppPath(new URLSearchParams(loc.search).get('path'));
  const [src, setSrc] = useState(() => frameSrc(startPath));
  const [current, setCurrent] = useState(startPath);
  const [reloadKey, setReloadKey] = useState(0);
  const [deviceId, setDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_KEY) ?? 'iphone15';
    } catch {
      return 'iphone15';
    }
  });
  const [landscape, setLandscape] = useState(false);
  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];
  const w = landscape ? device.h : device.w;
  const h = landscape ? device.w : device.h;

  // Scale the frame down to fit the window (the iframe keeps its real CSS size, so layouts are exact).
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const scale = useMemo(() => Math.min(1, (vp.h - 150) / (h + 2 * BEZEL), (vp.w - 32) / (w + 2 * BEZEL)), [vp, w, h]);

  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_KEY, deviceId);
    } catch {
      /* ignore */
    }
  }, [deviceId]);

  // The frame reports its route (AppModeEffects) so "Web" reopens the same screen.
  useEffect(() => {
    setPreviewFramePath(startPath);
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'mw:preview-route' || typeof e.data.path !== 'string') return;
      const p = safeAppPath(stripAppFlag(e.data.path));
      setCurrent(p);
      setPreviewFramePath(p);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return <Navigate to="/" replace />;

  const btn = 'inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-sq-line bg-white px-3 text-[13px] font-medium text-sq-ink hover:bg-sq-chip/50';
  return (
    <div className="min-h-screen bg-[#e7ebf3] pb-24" data-testid="app-preview">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2 px-4 pt-4">
        <div className="mr-auto flex items-center gap-2">
          <Smartphone size={18} strokeWidth={1.75} className="text-sq-orange" />
          <div>
            <div className="text-[15px] font-semibold text-sq-ink">{tr('App preview — not the native build', 'Aperçu App — pas la compilation native')}</div>
            <div className="text-[12px] text-sq-muted">
              {tr('Same screens, services and session as the web version, rendered in app mode.', 'Mêmes écrans, services et session que la version web, affichés en mode application.')}{' '}
              <span className="font-mono">{current}</span>
            </div>
          </div>
        </div>
        <label className="sr-only" htmlFor="mw-preview-device">
          {tr('Device size', 'Taille de l’appareil')}
        </label>
        <select id="mw-preview-device" value={device.id} onChange={(e) => setDeviceId(e.target.value)} className={cx(btn, 'pr-2')}>
          {DEVICES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} · {d.w}×{d.h}
            </option>
          ))}
        </select>
        <button type="button" className={btn} onClick={() => setLandscape((l) => !l)} aria-pressed={landscape}>
          <RotateCw size={15} strokeWidth={1.75} /> {tr('Rotate', 'Pivoter')}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            setSrc(frameSrc(current));
            setReloadKey((k) => k + 1);
          }}
        >
          <RefreshCw size={15} strokeWidth={1.75} /> {tr('Reload', 'Recharger')}
        </button>
        <button
          type="button"
          className={btn}
          title={tr('Show again the screen that was open in the web version', 'Réafficher l’écran ouvert dans la version web')}
          onClick={() => {
            setSrc(frameSrc(startPath));
            setCurrent(startPath);
            setReloadKey((k) => k + 1);
          }}
        >
          <ExternalLink size={15} strokeWidth={1.75} /> {tr('Open web route', 'Ouvrir la route web')}
        </button>
      </div>

      <div className="mt-4 flex justify-center px-4">
        <div style={{ width: (w + 2 * BEZEL) * scale, height: (h + 2 * BEZEL) * scale }}>
          <div
            className="origin-top-left rounded-[44px] bg-[#111] shadow-2xl"
            style={{ width: w + 2 * BEZEL, height: h + 2 * BEZEL, padding: BEZEL, transform: `scale(${scale})` }}
          >
            <iframe
              key={`${reloadKey}-${src}`}
              name={PREVIEW_FRAME_NAME}
              title={tr('App preview', 'Aperçu App')}
              src={src}
              width={w}
              height={h}
              className="block rounded-[32px] bg-white"
              allow="publickey-credentials-get; publickey-credentials-create; clipboard-write"
            />
          </div>
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[560px] px-4 text-center text-[12px] text-sq-muted">
        {tr(
          'Browser preview: safe areas, keyboard and hardware back button of a real phone are not simulated. Native build: see docs/MOBILE.md.',
          'Aperçu navigateur : zones sûres, clavier et bouton retour d’un vrai téléphone ne sont pas simulés. Compilation native : voir docs/MOBILE.md.',
        )}
      </p>
    </div>
  );
}
