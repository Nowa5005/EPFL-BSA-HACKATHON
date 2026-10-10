// Passkey ceremonies, guarded for the native app: in the Capacitor WebView the demo RP ID ("localhost") cannot work
// (it needs an HTTPS domain + associated domains / assetlinks, or a native passkey plugin — see docs/MOBILE.md).
// Rather than letting the WebView fail with an obscure error, we stop with an explicit message.
import { startAuthentication as sa, startRegistration as sr } from '@simplewebauthn/browser';
import { tr } from './i18n';
import { passkeysBlockedInNative } from './platform';

export const passkeyNativeMessage = () =>
  tr(
    'Passkeys need the production domain configuration in the native app. Use the web version or the app preview for now.',
    'Les passkeys nécessitent la configuration du domaine de production dans l’application native. Utilisez pour l’instant la version web ou l’aperçu App.',
  );

function guard() {
  if (passkeysBlockedInNative()) throw new Error(passkeyNativeMessage());
}

export const startRegistration: typeof sr = (opts) => {
  guard();
  return sr(opts);
};
export const startAuthentication: typeof sa = (opts) => {
  guard();
  return sa(opts);
};
