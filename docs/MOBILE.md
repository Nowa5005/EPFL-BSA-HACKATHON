# Web and App versions

My Wall has **one codebase and two targets**:

| | Web version | App version |
|---|---|---|
| Code | `apps/web` | the same `apps/web` screens, built in *app mode*, wrapped by `apps/mobile` (Capacitor 8) |
| Runs in | any browser (desktop, tablet, mobile) | iOS / Android native shell (WKWebView / Android WebView), or the browser **App preview** |
| Layout | responsive (desktop top bar ≥ 1024 px, mobile bottom nav below) | always the phone layout, whatever the width |
| Services, rules, data | `sq-cosigner`, `recovery-partner`, `sq-bank`, `market-data` | the **same** services and business rules |

There is no parallel mock-up: the app preview and the native shell render the real routes (`/login`, `/sq`, `/sq/markets`, `/wallet`…).

## 1. Web

```bash
npm run dev                      # services + web → http://localhost:5173
```

## 2. App preview in the browser (owner tool)

With `npm run dev` running, a small **Web | App** switch sits at the bottom-left of every page (dev only).

- **App** opens `http://localhost:5173/preview/app?path=<current route>`: a phone frame labelled
  *“App preview — not the native build”* containing an iframe of the **same app, same origin** in app mode
  (`<route>?app=1`, iframe named `mw-app-preview`). Same services, same `localStorage` → same Swissquote session and
  same wallet record as the web tab: no contradictory data. (The *unlocked* wallet key lives in memory per page, so
  the frame asks to unlock separately, like a second screen of the same device.)
- Device presets: iPhone 15 (390×844), iPhone SE (375×667), Pixel 7 (412×915), small Android (360×800); rotate,
  reload, “Open web route” (shows again the route that was open on the web side).
- **Web** returns to the normal site on the route currently shown in the frame (full reload so the web view re-reads
  the session).
- The switch is never shown inside the frame, in the native app, or in a production build — except when the owner
  enables it explicitly with `?preview=1` (persisted in `localStorage` key `mw:preview`; `?preview=0` removes it).
  The `/preview/app` route redirects to `/` when the tool is not enabled. Customers never see a Web/App choice.
- Not simulated by the browser preview: notch / home-indicator safe areas (`env(safe-area-inset-*)` is 0 in an
  iframe), on-screen keyboard, Android hardware back button, native passkeys.

## 3. Native app (Capacitor)

`apps/mobile` contains `capacitor.config.ts` (appId `ch.mywall.demo`, app name **My Wall (demo)** — a neutral demo
identifier, not a Swissquote store id), the generated **`android/`** (Gradle) and **`ios/`** (Xcode, Swift Package
Manager — no CocoaPods) projects, and `www/` (build output, git-ignored).

| Command (repo root) | What it does |
|---|---|
| `npm run app:build` | `vite build --mode app` of apps/web into `apps/mobile/www`, then `cap copy` into both native projects |
| `npm run app:sync` | same build + `cap sync` (copies web assets **and** updates native plugins) |
| `npm run app:ios` | opens the Xcode project (`cap open ios`) — needs Xcode |
| `npm run app:android` | opens Android Studio (`cap open android`) — needs Android Studio |
| `npm run app:run:ios -w @sq/mobile` / `npm run app:run:android -w @sq/mobile` | build & run on a simulator/emulator/device (`cap run`) |
| `npm run app:preview` | serves the **app-mode bundle** (`apps/mobile/www`) at `http://localhost:5174` in a browser |
| `npm run app:doctor` | `cap doctor` (versions, platform health) |

Native plugins used: `@capacitor/app` (Android back button → router back; exits from `/sq` or `/login`) and
`@capacitor/keyboard` (WebView resized when the keyboard opens; Android activity uses `adjustResize`).

### Prerequisites (missing on the development Mac used for this iteration)

- **iOS**: full **Xcode** (≥ 16, from the App Store) + an iOS simulator runtime; for a physical device an Apple ID
  in Xcode → *Signing & Capabilities* (free personal team is enough for a dev install). CocoaPods is **not** needed
  (Swift Package Manager; packages are resolved by Xcode on first open, internet required).
- **Android**: **Android Studio** (Android SDK, platform 36, build-tools) + an emulator image or a device with USB
  debugging (`adb`). Java is already present; Gradle is downloaded by the wrapper on first build.
- Only the Command Line Tools are installed here, so **no native compile was run**. The projects were generated and
  synced (`cap add`, `cap sync`, `cap doctor` OK), nothing more.

### Running on a simulator / device

```bash
npm run dev                                         # services on the Mac
npm run app:sync                                    # bundle with localhost service URLs
npm run app:ios        # Xcode → pick a simulator → Run   (simulator: localhost = the Mac, works as is)
npm run app:android    # Android Studio → Run              (emulator: the Mac is 10.0.2.2, see below)
```

**Service URLs.** The bundle calls `http://localhost:4001…4004` by default. That is right for the iOS simulator
(it shares the Mac's network) but **not** for a physical phone (localhost = the phone) nor the Android emulator.
Set the host **at build time** (public values only, never a secret):

```bash
VITE_API_HOST=http://192.168.1.20 npm run app:sync   # your Mac's LAN IP → :4001 … :4004
VITE_API_HOST=http://10.0.2.2     npm run app:sync   # Android emulator → the Mac
# full per-service override: VITE_COSIGNER_URL, VITE_PARTNER_URL, VITE_BANK_URL, VITE_MARKET_URL
```

(implemented in `apps/web/src/lib/services.ts`.)

**Bind address (#2).** The services listen on **127.0.0.1 only** by default (`HOST` overrides it; the start-up log
prints the real bound address; `npm run check-bind` verifies it with `lsof`). Two ways to reach them from a phone:
- **Web on a phone / dev tunnel (recommended)** — expose **only Vite** (`npm run dev -w apps/web -- --host 0.0.0.0`,
  or a tunnel to :5173). When the page is not served from `localhost`, the web app calls `<page origin>/svc/<service>`
  and Vite proxies it to `127.0.0.1:400x` (`apps/web/vite.config.ts`; the proxy drops `x-internal-token` and only
  vouches for same-origin pages — a cross-site Origin is still refused by the services). Passkeys on a tunnel domain
  also need `WEBAUTHN_ORIGIN` and `WEBAUTHN_RP_ID` set to that domain.
- **Native app with `VITE_API_HOST=http://<LAN IP>`** — start the services with `HOST=0.0.0.0` on a trusted network
  only (it exposes them to the LAN).

**CORS / origins.** The services use an explicit allow-list (`ALLOWED_ORIGINS`, see `packages/shared/src/serverAuth.ts`);
never `*`. The default dev list already contains the app origins:

| Origin | Who |
|---|---|
| `http://localhost:5173`, `http://127.0.0.1:5173` | web (Vite dev) and the browser App preview (same origin) |
| `capacitor://localhost` | iOS native app |
| `http://localhost` (and `https://localhost`) | Android native app (`server.androidScheme: 'http'` in `capacitor.config.ts`) |
| `http://localhost:5174` | **add it** if you use `npm run app:preview` (`ALLOWED_ORIGINS=…,http://localhost:5174`) |
| `http://<LAN-IP>:5173` | **add it** for live reload (below) |

**Cleartext http (dev only).** The demo services are plain http.
- Android: `android/app/src/debug/AndroidManifest.xml` + `debug/res/xml/network_security_config.xml` allow cleartext
  **in debug builds only**; release builds stay HTTPS-only.
- iOS: `Info.plist` has `NSAppTransportSecurity › NSAllowsLocalNetworking = true` (LAN IPs / `.local` only, ATS
  unchanged for internet domains) and `NSLocalNetworkUsageDescription`. **Remove both before any store build.**
- Not verified on a device: whether WKWebView (page origin `capacitor://localhost`) lets `fetch` reach an http LAN
  service is to be confirmed on the first device run; if blocked, serve the services over HTTPS (e.g. a dev tunnel or
  `mkcert`) and point `VITE_API_HOST` at it.

**Live reload (optional, off by default).**

```bash
npm run dev -w apps/web -- --host 0.0.0.0           # Vite reachable on the LAN (the root `npm run dev` binds localhost)
CAP_SERVER_URL=http://192.168.1.20:5173 npx cap run android   # from apps/mobile; or ios
```

`CAP_SERVER_URL` makes the native WebView load the dev server instead of `www/` (and sets `cleartext: true`). Add
`http://192.168.1.20:5173` to `ALLOWED_ORIGINS` and `WEBAUTHN_ORIGIN`. Never ship a build with `server.url`.

## 4. App mode in the code

`apps/web/src/lib/platform.ts`:

- `isApp` = `Capacitor.isNativePlatform()` **or** the bundle was built with `--mode app` (or `VITE_TARGET=app`)
  **or** the page runs inside the preview frame (iframe named `mw-app-preview` / `?app=1`).
- `useIsDesktopLayout()` → always `false` in app mode; used by `SqShell` and `WalletShell` (phone layout whatever the
  width). On a tablet in the native shell the viewport is pinned to 480 CSS px so Tailwind breakpoints stay consistent.
- `html.mw-app` class: no tap highlight, no overscroll bounce. Safe areas: the shells pad with
  `env(safe-area-inset-*)` (`viewport-fit=cover` in `index.html`, `ios.contentInset: 'never'`).
- Touch targets: shell buttons/tabs are ≥ 44 px (`min-h-11`, `size-11`, 60 px tabs); entry points do not rely on hover.

## 5. Authentication, passkeys and wallets in the native WebView

**Passkeys do not work in the native shell with the demo configuration**, and the code says so instead of failing:

- The demo RP ID is `localhost` (`WEBAUTHN_RP_ID`). In the native app the page origin is `capacitor://localhost`
  (iOS) / `http://localhost` (Android): WKWebView only allows WebAuthn for RP IDs listed in the app's **Associated
  Domains** (`webcredentials:<domain>`, served by `https://<domain>/.well-known/apple-app-site-association`), and the
  Android WebView needs WebAuthn support enabled (androidx.webkit) plus a **Digital Asset Links** file
  (`https://<domain>/.well-known/assetlinks.json`) for the app's signing certificate.
- So in the native app `passkeySupport()` reports `native-unconfigured`; the onboarding / unlock / recovery screens
  show *“Passkeys need the production domain configuration in the native app; use the web version or the app preview
  for now”*, and any passkey ceremony stops with the same message (`lib/passkeyGuard.ts`). The availability of
  `PublicKeyCredential` is **not** treated as proof that it works.
- To enable it: an HTTPS production domain as RP ID (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` incl. the app origins), the
  AASA and assetlinks files on that domain, the Associated Domains entitlement (iOS) and the Android WebView WebAuthn
  setting — or a native passkey plugin (ASAuthorization / Android Credential Manager) bridged to the same server
  endpoints. Then build with `VITE_NATIVE_PASSKEYS=1`. Biometrics (Face ID / fingerprint) come with the passkey; no
  separate biometric plugin is used.
- In the browser App preview passkeys work as on the web (same origin `http://localhost:5173`).

**External wallets.** `window.ethereum` (MetaMask & co.) never exists in a native WebView. A future “connect an
external wallet” flow must use WalletConnect or a deep link in the app; `injectedWalletAvailable()` in
`platform.ts` returns `false` in the native shell for that reason.

**Sessions & deep links.** The Swissquote demo session is in `localStorage` (per app install). No deep links / universal
links are registered (none are needed for the demo); adding them requires the same AASA / assetlinks files.

**Secrets.** The app bundle only contains public service URLs. No key, token or `.env` value is embedded.

## 6. Not done here

- No native compile, simulator run or device install (no Xcode / Android SDK on this Mac).
- No store publishing, signing for distribution, or deployment.
