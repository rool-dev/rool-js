import { RoolClient, NativePkceAuthProvider, type NativeAuthFlowProvider } from '@rool-dev/sdk';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const logEl = $<HTMLPreElement>('log');
function log(message: string): void {
  logEl.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logEl.textContent ?? ''}`;
}

function showBanner(kind: 'info' | 'error', message: string): void {
  const el = $('banner');
  el.textContent = message;
  el.className = `banner banner-${kind}`;
  el.hidden = false;
}
function clearBanner(): void {
  $('banner').hidden = true;
}

// The deep-link scheme must match what the auth server's native-client
// allowlist expects (and the intent-filter / Info.plist in the native project).
const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
const redirectUri =
  platform === 'ios' ? 'rooliosauth://auth/callback' : 'roolandroidauth://auth/callback';

const client = new RoolClient({
  // Point at the environment where native PKCE support is deployed (dev for now).
  apiUrl: import.meta.env.VITE_ROOL_API_URL || undefined,
  authUrl: import.meta.env.VITE_ROOL_AUTH_URL || undefined,
  authProvider: new NativePkceAuthProvider({
    redirectUri,
    defaultProvider: 'google',
    // PKCE authorizes in the system browser, not the app webview.
    openExternal: (url) => Browser.open({ url }),
  }),
});

let authenticated = false;

client.on('authStateChanged', (a) => {
  authenticated = a;
  log(`authStateChanged: ${a}`);
  if (a) void refreshSpaces();
  render();
});
client.on('currentUserChanged', (user) => {
  log(`currentUserChanged: ${user ? user.name ?? user.slug ?? '(no name)' : 'null'}`);
  render();
});

// The OS hands a deep link to the app here. Two shapes complete sign-in:
//   custom scheme  roolandroidauth://auth/callback?code=…&state=…  → PKCE code exchange
//   magic link     https://…/?verify=<jwt>                         → verify token
// (The https magic link only reaches the app once Universal/App Links are set up.)
App.addListener('appUrlOpen', async ({ url }) => {
  log(`appUrlOpen: ${url}`);
  try {
    const verifyToken = new URL(url).searchParams.get('verify');
    const ok = verifyToken
      ? await client.verify(verifyToken)
      : await client.handleAuthRedirect(url);
    log(`${verifyToken ? 'verify' : 'handleAuthRedirect'} -> ${ok}`);
    if (ok) await Browser.close().catch(() => {});
  } catch (error) {
    log(`deep-link error: ${String(error)}`);
  }
  render();
});

function render(): void {
  $('signed-out').hidden = authenticated;
  $('signed-in').hidden = !authenticated;
  $('platform-note').hidden = platform !== 'web';
  const user = client.currentUser;
  $('user').textContent = user ? (user.name ?? user.slug ?? '(no name)') : '';
  $('user-sub').textContent = user?.email ?? '';
}

function login(provider: NativeAuthFlowProvider): void {
  log(`login(${provider}) — opening system browser…`);
  void client.login('Rool Auth Example', { provider });
}

// Proof that the session works end-to-end: hit the API with the token.
async function refreshSpaces(): Promise<void> {
  $('spaces-status').textContent = 'Loading spaces…';
  $('spaces').innerHTML = '';
  try {
    const spaces = await client.listSpaces();
    log(`listSpaces -> ${spaces.length} space(s)`);
    $('spaces-status').textContent = `${spaces.length} space(s):`;
    for (const space of spaces) {
      const li = document.createElement('li');
      li.textContent = `${space.name} — ${space.role}`;
      $('spaces').appendChild(li);
    }
  } catch (error) {
    log(`listSpaces error: ${String(error)}`);
    $('spaces-status').textContent = `Error: ${String(error)}`;
  }
}

// --- Sign-in handlers ---

$('login-google').addEventListener('click', () => login('google'));
$('login-apple').addEventListener('click', () => login('apple'));

$('password-toggle').addEventListener('click', () => {
  $('password-form').hidden = !$('password-form').hidden;
});

$('magic-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanner();
  const email = $<HTMLInputElement>('magic-email').value.trim();
  log(`requestMagicLink(${email})`);
  try {
    await client.requestMagicLink(email);
    showBanner(
      'info',
      'Sign-in link sent — check your email. On this device the link opens the Rool website unless Universal/App Links are configured.'
    );
  } catch (error) {
    showBanner('error', String(error instanceof Error ? error.message : error));
  }
});

$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearBanner();
  const email = $<HTMLInputElement>('pw-email').value.trim();
  const password = $<HTMLInputElement>('pw-password').value;
  log(`signInWithPassword(${email})`);
  try {
    const result = await client.signInWithPassword(email, password);
    log(`signInWithPassword -> ${result.status}`);
    if (result.status === 'verify_required') {
      showBanner(
        'info',
        "Your email isn't verified yet — we sent a sign-in link. Check your inbox."
      );
    }
    // status === 'signed_in' flips the UI via authStateChanged.
  } catch (error) {
    showBanner('error', String(error instanceof Error ? error.message : error));
  }
});

$('refresh-spaces').addEventListener('click', () => void refreshSpaces());
$('logout').addEventListener('click', () => {
  log('logout');
  client.logout();
  $('spaces').innerHTML = '';
  $('spaces-status').textContent = '';
  clearBanner();
  render();
});

async function boot(): Promise<void> {
  log(`platform=${platform} redirectUri=${redirectUri}`);
  authenticated = await client.initialize();
  log(`initialize -> ${authenticated}`);
  render();
  if (authenticated) void refreshSpaces(); // no authStateChanged fires for a persisted session
}

void boot();
