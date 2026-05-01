/**
 * Snapshot host bundle — headless preview of an extension against an in-memory
 * SnapshotChannel. Used by `rool-extension preview` to render an extension in a
 * Chromium tab driven via CDP, without any GraphQL backend.
 *
 * Reads config from data-* attributes on the mount node:
 *   data-extension-url   URL to load the extension iframe from (e.g. "/ext/").
 *   data-snapshot-url    URL of the snapshot.json (e.g. "/snapshot.json").
 *   data-channel-id      Channel id (extension's manifest.id).
 *   data-space-id        Space id (defaults to channel id).
 *   data-space-name      Space name (defaults to "Snapshot").
 *
 * Lifecycle signals on the global window:
 *   window.__roolReady = true       set once iframe handshake completes + a
 *                                    short settle period (default 200ms) so
 *                                    initial paint / data-fetch round-trips
 *                                    have a chance to land before screenshots.
 *   window.__roolError = message    set on bootstrap failure.
 */

import { createBridgeHost, SnapshotChannel, type RoolSpaceData } from '../host.js';

interface SnapshotInfo {
  spaceId: string;
  name: string;
  takenAt: number;
  version: number;
}

const SETTLE_MS = 200;

declare global {
  interface Window {
    __roolReady?: boolean;
    __roolError?: string;
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('rool-snapshot-host');
  if (!root) throw new Error('Mount node #rool-snapshot-host not found');

  const extensionUrl = root.dataset.extensionUrl;
  const snapshotUrl = root.dataset.snapshotUrl;
  const channelId = root.dataset.channelId;
  if (!extensionUrl || !snapshotUrl || !channelId) {
    throw new Error('Missing required data-* attributes on #rool-snapshot-host');
  }

  // Load the snapshot. info.json is optional — fall back to data-* attrs.
  const dataRes = await fetch(snapshotUrl);
  if (!dataRes.ok) throw new Error(`snapshot.json fetch ${dataRes.status}`);
  const data = (await dataRes.json()) as RoolSpaceData;

  let info: Partial<SnapshotInfo> = {};
  try {
    const infoUrl = snapshotUrl.replace(/snapshot\.json$/, 'info.json');
    const r = await fetch(infoUrl);
    if (r.ok) info = (await r.json()) as SnapshotInfo;
  } catch {
    // optional
  }

  const spaceId = root.dataset.spaceId ?? info.spaceId ?? channelId;
  const spaceName = root.dataset.spaceName ?? info.name ?? 'Snapshot';

  const channel = new SnapshotChannel({
    data,
    spaceId,
    spaceName,
    channelId,
  });

  const iframe = document.createElement('iframe');
  iframe.src = extensionUrl;
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  root.appendChild(iframe);

  createBridgeHost({
    channel,
    iframe,
    user: { id: 'snapshot-user', name: 'Snapshot User', email: 'snapshot@local' },
  });

  // Signal readiness after the iframe handshake completes plus a settle
  // window so first paint and any boot-time channel round-trips land before
  // a screenshot is taken. BridgeHost replies to 'rool:ready' synchronously
  // with 'rool:init', so this fires once per bootstrap.
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
    `Snapshot host bootstrap failed:\n${message}</pre>`;
});
