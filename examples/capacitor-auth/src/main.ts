import { RoolClient, NativePkceAuthProvider, type NativeAuthFlowProvider } from '@rool-dev/sdk';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const logEl = $<HTMLPreElement>('log');
function log(message: string): void {
  logEl.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logEl.textContent ?? ''}`;
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
  render();
});
client.on('currentUserChanged', (user) => {
  log(`currentUserChanged: ${user ? user.name ?? user.slug ?? '(no name)' : 'null'}`);
  render();
});

// The OS hands the deep link to the app here after the external browser
// redirects to the custom scheme. Feed it straight to the SDK.
App.addListener('appUrlOpen', async ({ url }) => {
  log(`appUrlOpen: ${url}`);
  try {
    const ok = await client.handleAuthRedirect(url);
    log(`handleAuthRedirect -> ${ok}`);
    if (ok) {
      await Browser.close().catch(() => {});
      void refreshSpaces();
    }
  } catch (error) {
    log(`handleAuthRedirect error: ${String(error)}`);
  }
  render();
});

function render(): void {
  $('signed-out').hidden = authenticated;
  $('signed-in').hidden = !authenticated;
  $('platform-note').hidden = platform !== 'web';
  $('status').textContent = authenticated ? 'Signed in' : 'Signed out';
  const user = client.currentUser;
  $('user').textContent = user ? `${user.name ?? '(no name)'} — ${user.slug ?? user.id}` : '';
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
      li.textContent = `${space.name} — ${space.role} (${space.id})`;
      $('spaces').appendChild(li);
    }
  } catch (error) {
    log(`listSpaces error: ${String(error)}`);
    $('spaces-status').textContent = `Error: ${String(error)}`;
  }
}

$('login-google').addEventListener('click', () => login('google'));
$('login-apple').addEventListener('click', () => login('apple'));
$('refresh-spaces').addEventListener('click', () => void refreshSpaces());
$('logout').addEventListener('click', () => {
  log('logout');
  client.logout();
  $('spaces').innerHTML = '';
  $('spaces-status').textContent = '';
  render();
});

async function boot(): Promise<void> {
  log(`platform=${platform} redirectUri=${redirectUri}`);
  authenticated = await client.initialize();
  log(`initialize -> ${authenticated}`);
  render();
  if (authenticated) void refreshSpaces();
}

void boot();
