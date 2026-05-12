/**
 * Fs host bundle — chromium-side entry that renders an extension iframe
 * backed by an FsChannel. Used by `rool-extension preview`.
 *
 * Reads config from data-* attributes on the mount node:
 *   data-base-url       Base URL of the space proxy (e.g. "/__rool-host/space").
 *   data-extension-url  URL to load the extension iframe from (e.g. "/").
 *   data-channel-id     Channel id (extension's manifest.id).
 *   data-space-id       Space id.
 *   data-space-name     Space name.
 *
 * Lifecycle signals on the global window:
 *   window.__roolReady = true       set once iframe handshake completes + a
 *                                    short settle period so first paint /
 *                                    boot-time data-fetch round-trips land
 *                                    before screenshots.
 *   window.__roolError = message    set on bootstrap failure.
 */

import { createBridgeHost, FsChannel, type FsOverview } from '../host.js';

const SETTLE_MS = 200;

declare global {
  interface Window {
    __roolReady?: boolean;
    __roolError?: string;
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('rool-fs-host');
  if (!root) throw new Error('Mount node #rool-fs-host not found');

  const baseUrl = root.dataset.baseUrl;
  const extensionUrl = root.dataset.extensionUrl;
  const channelId = root.dataset.channelId;
  const spaceId = root.dataset.spaceId;
  const spaceName = root.dataset.spaceName;
  if (!baseUrl || !extensionUrl || !channelId || !spaceId || !spaceName) {
    throw new Error('Missing required data-* attributes on #rool-fs-host');
  }

  const overviewUrl = `${baseUrl.replace(/\/$/, '')}/v1/spaces/${encodeURIComponent(spaceId)}/overview`;
  const res = await fetch(overviewUrl);
  if (!res.ok) throw new Error(`overview fetch ${res.status}`);
  const overview = (await res.json()) as FsOverview;

  const channel = new FsChannel({
    baseUrl,
    spaceId,
    spaceName,
    channelId,
    overview,
  });

  const iframe = document.createElement('iframe');
  iframe.src = extensionUrl;
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  root.appendChild(iframe);

  createBridgeHost({
    channel,
    iframe,
    user: { id: 'preview-user', name: 'Preview User', email: 'preview@local' },
  });

  let signaled = false;
  window.addEventListener('message', (e) => {
    if (signaled) return;
    if (e.source !== iframe.contentWindow) return;
    const msg = e.data as { type?: string } | null;
    if (!msg || msg.type !== 'rool:ready') return;
    signaled = true;
    setTimeout(() => { window.__roolReady = true; }, SETTLE_MS);
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  window.__roolError = message;
  document.body.innerHTML =
    `<pre style="color:#b91c1c;padding:1rem;font:13px monospace;white-space:pre-wrap">` +
    `Fs host bootstrap failed:\n${message}</pre>`;
});
