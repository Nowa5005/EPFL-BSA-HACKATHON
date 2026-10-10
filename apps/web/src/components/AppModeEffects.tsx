// Behaviour specific to app mode (native Capacitor shell or the owner's preview frame).
// On the web version it does nothing: every effect below is gated by isApp / isNative / inPreviewFrame.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tr } from '../lib/i18n';
import { inPreviewFrame, isApp, isNative, passkeySupport, type PasskeySupport } from '../lib/platform';
import { passkeyNativeMessage } from '../lib/passkeyGuard';
import { X } from 'lucide-react';
import { Notice } from './ui';

/** Screens from which the Android back button leaves the app instead of going back. */
const ROOTS = new Set(['/', '/sq', '/login']);
/** Screens that need a passkey: show the limitation up front rather than failing at the last step. */
const PASSKEY_ROUTES = ['/onboarding', '/wallet/unlock', '/recover'];

if (isApp && typeof document !== 'undefined') {
  document.documentElement.classList.add('mw-app');
  // Tablets in the native shell: keep the phone layout consistent (CSS breakpoints included) by rendering
  // a phone-width viewport, scaled by the WebView. Phones are unaffected.
  if (isNative && Math.min(window.screen.width, window.screen.height) >= 600) {
    document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=480, viewport-fit=cover');
  }
}

export default function AppModeEffects() {
  const loc = useLocation();
  const nav = useNavigate();
  const [passkeys, setPasskeys] = useState<PasskeySupport | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Preview frame → tell the owner's preview page which route is shown (same origin only).
  useEffect(() => {
    if (!inPreviewFrame) return;
    try {
      window.parent.postMessage({ type: 'mw:preview-route', path: loc.pathname + loc.search + loc.hash }, window.location.origin);
    } catch {
      /* ignore */
    }
  }, [loc.pathname, loc.search, loc.hash]);

  // Android hardware back button → router back (or leave the app from a root screen).
  useEffect(() => {
    if (!isNative) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    import('@capacitor/app').then(({ App }) =>
      App.addListener('backButton', ({ canGoBack }) => {
        if (!canGoBack || ROOTS.has(window.location.pathname)) void App.exitApp();
        else nav(-1);
      }).then((h) => {
        if (cancelled) void h.remove();
        else remove = () => void h.remove();
      }),
    );
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [nav]);

  useEffect(() => {
    if (isApp) void passkeySupport().then(setPasskeys);
  }, []);

  if (!isApp || dismissed || !passkeys || passkeys.ok || !PASSKEY_ROUTES.some((r) => loc.pathname.startsWith(r))) return null;
  // In the browser preview a missing built-in authenticator is the same situation as on the web: no extra notice.
  if (!isNative && passkeys.reason === 'no-platform-authenticator') return null;
  return (
    <div className="fixed inset-x-0 top-[max(8px,env(safe-area-inset-top))] z-50 px-4" data-testid="app-passkey-notice">
      <Notice tone="warn" title={tr('Passkeys unavailable here', 'Passkeys indisponibles ici')} className="mx-auto max-w-[560px] shadow-md">
        {passkeys.reason === 'native-unconfigured'
          ? passkeyNativeMessage()
          : passkeys.reason === 'no-webauthn'
            ? tr('This WebView has no passkey (WebAuthn) support. Use the web version.', 'Cette WebView ne prend pas en charge les passkeys (WebAuthn). Utilisez la version web.')
            : tr(
                'No built-in passkey authenticator (Face ID, fingerprint…) was found on this device. A security key or another phone may still work.',
                'Aucun authentificateur de passkey intégré (Face ID, empreinte…) n’a été trouvé sur cet appareil. Une clé de sécurité ou un autre téléphone peut encore fonctionner.',
              )}
        <button type="button" onClick={() => setDismissed(true)} className="mt-1 inline-flex min-h-11 items-center gap-1 font-semibold text-sq-ink">
          <X size={16} strokeWidth={1.75} /> {tr('Dismiss', 'Fermer')}
        </button>
      </Notice>
    </div>
  );
}
