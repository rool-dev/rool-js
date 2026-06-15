# Capacitor native auth example

Minimal [Capacitor](https://capacitorjs.com/) app that exercises the SDK's
native PKCE sign-in (`NativePkceAuthProvider` + `client.handleAuthRedirect`)
on Android and iOS. Vanilla TypeScript + Vite, no framework.

It signs in through the system browser, catches the deep-link callback, exchanges
the code for a session, then calls `client.listSpaces()` and lists them — proving
the token works against the API end-to-end. A test harness, not a real app.

> The auth server's native-client allowlist must include the redirect URIs used
> here (`roolandroidauth://auth/callback`, `rooliosauth://auth/callback`).

## How the flow works

1. `client.login('…', { provider: 'google' })` builds an `/authorize` URL with a
   PKCE challenge and opens it in the **system browser** (`openExternal`).
2. The user authenticates; the auth server redirects to the custom-scheme
   `redirectUri`, which the OS routes back to this app.
3. Capacitor's `App` plugin fires `appUrlOpen`; we pass the URL to
   `client.handleAuthRedirect(url)`, which validates state, exchanges the code at
   `/token`, and stores the session.
4. `client.on('authStateChanged' | 'currentUserChanged')` update the UI, then the
   app calls `client.listSpaces()` as an authenticated smoke test.

## Prerequisites

- **Node 22+** (Capacitor 8 CLI), pnpm
- **Android Studio** — provides the Android SDK, the emulator, and a bundled JDK
  (JBR). You do **not** need a separate JDK; CLI Gradle builds use Studio's JBR.
- **iOS:** macOS + Xcode (can't build from Linux).

## Setup

Standalone — not in the repo's pnpm workspace; install on its own and consume the
locally built SDK.

```bash
# 1. Build the SDK (from repo root) so the file: dependency has fresh dist.
pnpm --filter @rool-dev/sdk build

# 2. Install this example in isolation.
cd examples/capacitor-auth
pnpm install --ignore-workspace

# 3. Point at dev. Vite inlines these at build time, so set before building.
cp .env.example .env      # already contains the dev endpoints
```

Re-run step 1 + `pnpm build` whenever you change the SDK.

### Toolchain env

CLI builds need these. A system JDK that's too new/old fails Gradle — use
Studio's JBR:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export JAVA_HOME="$HOME/android-studio/jbr"     # Studio's bundled JDK
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
```

JBR location: tarball Studio → `~/android-studio/jbr`; snap →
`/snap/android-studio/current/jbr`.

## Scaffold the native projects (one-time)

```bash
pnpm build              # produce dist/ for Capacitor to bundle
pnpm add:android        # creates android/  (then apply the deep-link config below)
pnpm add:ios            # creates ios/      (macOS only)
pnpm sync               # copy web build + plugins into the native projects
```

The first native build downloads Gradle and any missing SDK packages — give it a
few minutes.

## Run on an emulator

Create an AVD once in Android Studio (Device Manager → a **Play-enabled** image so
it has Chrome for the OAuth step), then:

```bash
emulator -avd <avd-name> &      # list with: emulator -list-avds
adb wait-for-device
pnpm build && pnpm sync && pnpm run:android
```

The OAuth step needs a Google account signed in on the device — a physical phone
is usually easier (already signed in).

## Run on a physical phone

1. Phone: Settings → About → tap **Build number** ×7, then Developer options →
   **USB debugging** on. Connect with a data cable and accept the prompt.
2. `adb devices` → should list it as `device`. On Linux, if it shows
   `no permissions` or nothing, add a udev rule (Google vendor id `18d1`):
   ```bash
   echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0660", GROUP="plugdev"' | sudo tee /etc/udev/rules.d/51-android.rules
   sudo udevadm control --reload-rules && sudo udevadm trigger
   sudo usermod -aG plugdev "$USER"     # then replug + re-login
   ```
3. `pnpm build && pnpm sync && pnpm run:android`
   (with both a phone and emulator connected: `npx cap run android --target <id>`)

## Native deep-link config (one-time, after `cap add`)

`cap add` generates the native projects; register the custom scheme so the OS
routes the auth callback to the app. **Re-apply if you ever delete/regenerate
`android/` or `ios/`** (they're gitignored).

### Android — `android/app/src/main/AndroidManifest.xml`

Add to the existing `.MainActivity` `<activity>`:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="roolandroidauth" android:host="auth" />
</intent-filter>
```

### iOS — `ios/App/App/Info.plist`

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>rooliosauth</string>
    </array>
  </dict>
</array>
```

Re-run `pnpm sync` after editing native config.

## Debugging

- The in-app **log panel** shows each step (`handleAuthRedirect -> true`,
  `listSpaces -> N`).
- `chrome://inspect` (desktop Chrome) → WebView DevTools — best for a failing
  `/token` or GraphQL call. Works over USB for phones too.
- `adb logcat | grep -iE 'capacitor|rool'` for native/routing issues.

## Iterate

```bash
pnpm build && pnpm sync && pnpm run:android
```

`pnpm dev` runs in a desktop browser for quick UI tweaks, but custom-scheme deep
links only complete on a device/emulator.

## Files

- `src/main.ts` — client setup, deep-link listener, spaces smoke test, UI wiring
- `index.html` — minimal UI (login buttons, status, spaces list, log)
- `capacitor.config.ts` — app id / name / web dir
