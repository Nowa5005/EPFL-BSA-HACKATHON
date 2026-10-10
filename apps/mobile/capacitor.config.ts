// Capacitor configuration for the My Wall DEMO app (iOS / Android).
// The native app is a thin shell: it loads the SAME screens as apps/web, built in "app" mode
// (`npm run app:build` → apps/web `vite build --mode app` → apps/mobile/www). See docs/MOBILE.md.
//
// - appId is a neutral demo identifier (NOT a Swissquote store id). Nothing is published to a store.
// - No secret is ever embedded: the web bundle only contains public service URLs (VITE_API_HOST).
// - Live reload (dev only, OFF by default): `CAP_SERVER_URL=http://<your-mac-LAN-IP>:5173 npx cap run ios|android`
//   makes the native WebView load the Vite dev server instead of the bundled www/ (see docs/MOBILE.md).
import type { CapacitorConfig } from '@capacitor/cli';

const liveReloadUrl = process.env.CAP_SERVER_URL; // e.g. http://192.168.1.20:5173 — dev only

const config: CapacitorConfig = {
  appId: 'ch.mywall.demo',
  appName: 'My Wall (demo)',
  webDir: 'www',
  server: {
    // Android serves the bundle from http://localhost (default androidScheme is https; we keep http so that
    // the demo services on plain http are not blocked as mixed content). iOS uses capacitor://localhost.
    androidScheme: 'http',
    ...(liveReloadUrl ? { url: liveReloadUrl, cleartext: true } : {}),
  },
  ios: {
    // Content goes under the notch/home indicator; the web code pads with env(safe-area-inset-*).
    contentInset: 'never',
  },
  android: {
    // Plain-http demo services: only allowed in debug builds (see android/app/src/debug/res/xml/network_security_config.xml).
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      // Resize the WebView when the keyboard opens so focused inputs and bottom buttons stay visible.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
