/**
 * Dev host shell entry point.
 *
 * Mounts the HostShell Svelte component into #rool-host.
 * Built into a single bundle at publish time and served by the CLI dev server.
 */

import { mount } from 'svelte';
import HostShell from './HostShell.svelte';
import css from './app.css?inline';
import gridstackCss from 'gridstack/dist/gridstack.css?inline';

// Inject Tailwind + GridStack CSS into the document
const style = document.createElement('style');
style.textContent = css + '\n' + gridstackCss;
document.head.appendChild(style);

const root = document.getElementById('rool-host')!;
const channelId = root.dataset.channelId ?? 'extension-dev';
const extensionUrl = root.dataset.extensionUrl ?? '/';
const manifest = root.dataset.manifest ? JSON.parse(root.dataset.manifest) : null;
const manifestError = root.dataset.manifestError ?? null;

mount(HostShell, {
  target: root,
  props: { channelId, extensionUrl, manifest, manifestError },
});
