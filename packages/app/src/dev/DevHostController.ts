/**
 * DevHostController — business logic for the dev host shell.
 *
 * Owns the RoolClient lifecycle, space management, channel-per-app management,
 * bridge hosting, and published app management. The Svelte component is a thin
 * view layer that reads this controller's state and calls its methods.
 *
 * The controller is self-sufficient: it manages the full lifecycle including
 * DOM flush (via injected tick) and bridge binding. Svelte components can call
 * controller methods directly without needing wrappers.
 */

import { RoolClient } from '@rool-dev/sdk';
import type { RoolSpaceInfo, RoolChannel, PublishedAppInfo } from '@rool-dev/sdk';
import { createBridgeHost, type BridgeHost } from '../host.js';
import type { AppManifest, Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppTab {
  id: string;        // 'local' or the published app ID
  name: string;
  url: string;
  isLocal: boolean;
}

export type StatusState = 'ok' | 'loading' | 'off';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// DevHostController
// ---------------------------------------------------------------------------

export class DevHostController {
  // --- Config (immutable after construction) ---
  readonly channelId: string;
  readonly appUrl: string;
  readonly manifest: AppManifest | null;
  readonly manifestError: string | null;

  // --- SDK client ---
  client!: RoolClient;

  // --- Observable state (Svelte component mirrors these via $state) ---
  spaces: RoolSpaceInfo[] = [];
  currentSpaceId: string | null = null;
  statusText: string = 'Initializing...';
  statusState: StatusState = 'off';
  placeholderText: string | null = 'Authenticating...';
  env: Environment;
  publishedApps: PublishedAppInfo[] = [];
  installedAppIds: string[] = [];
  sidebarCollapsed: boolean = false;
  publishState: 'idle' | 'building' | 'uploading' | 'done' | 'error' = 'idle';
  publishMessage: string | null = null;
  publishUrl: string | null = null;

  // --- Per-tab state (imperative, not rendered directly) ---
  private channels: Record<string, RoolChannel> = {};
  private iframeEls: Record<string, HTMLIFrameElement> = {};
  private bridgeHosts: Record<string, BridgeHost> = {};

  // --- Dependencies ---
  private _onChange: () => void;
  private _tick: () => Promise<void>;

  // --- Storage keys ---
  private _spaceKey: string;

  constructor(
    options: {
      channelId: string;
      appUrl: string;
      manifest: AppManifest | null;
      manifestError: string | null;
    },
    onChange: () => void,
    tick: () => Promise<void>,
  ) {
    this.channelId = options.channelId;
    this.appUrl = options.appUrl;
    this.manifest = options.manifest;
    this.manifestError = options.manifestError;
    this._onChange = onChange;
    this._tick = tick;

    this._spaceKey = `rool-devhost:${options.channelId}:space`;

    // Restore persisted state
    this.env = this._getSavedEnv();
    this.sidebarCollapsed = storageGet('rool-devhost:collapsed') === 'true';
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  get tabs(): AppTab[] {
    const localTab: AppTab = {
      id: 'local',
      name: this.manifest?.name ?? 'Local',
      url: this.appUrl,
      isLocal: true,
    };
    const appTabs: AppTab[] = this.installedAppIds
      .map((id) => {
        const ch = this.channels[id];
        if (!ch?.appUrl) return null;
        return {
          id,
          name: ch.channelName ?? id,
          url: ch.appUrl,
          isLocal: false,
        } as AppTab;
      })
      .filter((t): t is AppTab => t !== null);
    return [localTab, ...appTabs];
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  async boot(): Promise<void> {
    const urls = ENV_URLS[this.env];
    this.client = new RoolClient({ baseUrl: urls.baseUrl, authUrl: urls.authUrl });
    const authenticated = await this.client.initialize();

    if (!authenticated) {
      this.placeholderText = 'Redirecting to login...';
      this.statusText = 'Authenticating...';
      this.statusState = 'loading';
      this._onChange();
      this.client.login('App Dev Host');
      return;
    }

    this.placeholderText = 'Loading spaces...';
    this.statusText = 'Loading spaces...';
    this.statusState = 'loading';
    this._onChange();

    const [spaceList, appList] = await Promise.all([
      this.client.listSpaces(),
      this.client.listApps().catch(() => [] as PublishedAppInfo[]),
    ]);

    this.spaces = spaceList;
    this.publishedApps = appList;

    this.client.on('spaceAdded', (space) => {
      if (!this.spaces.some((s) => s.id === space.id)) {
        this.spaces = [...this.spaces, space];
        this._onChange();
      }
    });
    this.client.on('spaceRemoved', (id) => {
      this.spaces = this.spaces.filter((s) => s.id !== id);
      if (this.currentSpaceId === id) {
        this.currentSpaceId = null;
        this.statusText = 'Disconnected';
        this.statusState = 'off';
      }
      this._onChange();
    });
    this.client.on('spaceRenamed', (id, name) => {
      this.spaces = this.spaces.map((s) => (s.id === id ? { ...s, name } : s));
      this._onChange();
    });

    this.statusText = 'Ready';
    this.statusState = 'off';

    const savedSpace = storageGet(this._spaceKey);
    if (savedSpace && this.spaces.some((s) => s.id === savedSpace)) {
      await this.selectSpace(savedSpace);
    } else {
      this.placeholderText = 'Select a space to load the app';
      this._onChange();
    }
  }

  // ---------------------------------------------------------------------------
  // Space selection
  // ---------------------------------------------------------------------------

  async selectSpace(spaceId: string): Promise<void> {
    this._destroyAllBridgesAndChannels();

    this.currentSpaceId = spaceId;
    storageSet(this._spaceKey, spaceId);
    this.statusText = 'Opening channels...';
    this.statusState = 'loading';
    this.placeholderText = 'Opening channels...';
    this._onChange();

    try {
      // Open the local app's channel
      const localChannel = await this.client.openChannel(spaceId, this.channelId);
      this.channels['local'] = localChannel;

      // Apply manifest settings to the local channel
      await this._syncManifest(localChannel, this.manifest);

      // Discover installed apps: channels with an appUrl
      const space = await this.client.openSpace(spaceId);
      const spaceChannels = space.getChannels();
      this.installedAppIds = spaceChannels
        .filter((ch) => ch.appUrl && ch.id !== this.channelId)
        .map((ch) => ch.id);

      // Open channels for each installed app (server already applied manifest)
      for (const appId of this.installedAppIds) {
        try {
          const ch = await this.client.openChannel(spaceId, appId);
          this.channels[appId] = ch;
        } catch (e) {
          console.error(`Failed to open channel for app ${appId}:`, e);
        }
      }

      // Show iframes, wait for DOM to mount them, then bind bridges
      this.placeholderText = null;
      this._onChange();
      await this._tick();
      this._bindAllBridges();

      const spaceName = this.spaces.find((s) => s.id === this.currentSpaceId)?.name ?? spaceId;
      this.statusText = `Connected \u2014 ${spaceName}`;
      this.statusState = 'ok';
      this._onChange();
    } catch (e) {
      console.error('Failed to open channel:', e);
      this.placeholderText = `Error: ${e instanceof Error ? e.message : String(e)}`;
      this.statusText = 'Error';
      this.statusState = 'off';
      this._onChange();
    }
  }

  // ---------------------------------------------------------------------------
  // App installation / removal
  // ---------------------------------------------------------------------------

  /**
   * Install an app in the current space.
   *
   * Opens the channel first, THEN adds the tab. This ensures the channel
   * exists when the iframe mounts so registerIframe → _bindBridge can
   * connect the bridge before the app sends its init message.
   */
  async installApp(appId: string): Promise<void> {
    if (!this.currentSpaceId) return;
    if (this.installedAppIds.includes(appId)) return;

    try {
      // Step 1: install app (server applies manifest: name, systemInstruction, collections)
      const channelId = await this.client.installApp(this.currentSpaceId, appId);

      // Step 2: open channel for live subscription
      const ch = await this.client.openChannel(this.currentSpaceId, channelId);
      this.channels[appId] = ch;

      // Step 3: add the card, flush DOM, bind bridge
      this.installedAppIds = [...this.installedAppIds, appId];
      this._onChange();
      await this._tick();
      this._bindBridge(appId);
    } catch (e) {
      console.error(`Failed to install app ${appId}:`, e);
      this.installedAppIds = this.installedAppIds.filter((id) => id !== appId);
      this._onChange();
    }
  }

  /**
   * Uninstall an app from the current space.
   * Deletes the channel and removes the card.
   */
  removeApp(appId: string): void {
    this._destroyTab(appId);
    this.installedAppIds = this.installedAppIds.filter((id) => id !== appId);
    this._onChange();

    // Delete the channel in the background (fire-and-forget)
    if (this.currentSpaceId) {
      this.client.deleteChannel(this.currentSpaceId, appId).catch((e) => {
        console.error(`Failed to delete channel for app ${appId}:`, e);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  async publish(): Promise<void> {
    if (!this.manifest) {
      this.publishState = 'error';
      this.publishMessage = 'No valid manifest found';
      this._onChange();
      return;
    }

    this.publishState = 'building';
    this.publishMessage = null;
    this.publishUrl = null;
    this._onChange();

    try {
      // Step 1: trigger server-side Vite build + zip
      const buildRes = await fetch('/__rool-host/publish', { method: 'POST' });
      if (!buildRes.ok) {
        const body = await buildRes.json().catch(() => ({ error: 'Build failed' }));
        throw new Error(body.error || 'Build failed');
      }

      const zipBlob = await buildRes.blob();

      // Step 2: publish via SDK
      this.publishState = 'uploading';
      this._onChange();

      const result = await this.client.publishApp(this.manifest.id, {
        bundle: zipBlob,
      });

      // Step 3: update published apps list
      const existingIdx = this.publishedApps.findIndex((a) => a.appId === result.appId);
      if (existingIdx >= 0) {
        this.publishedApps = [
          ...this.publishedApps.slice(0, existingIdx),
          result,
          ...this.publishedApps.slice(existingIdx + 1),
        ];
      } else {
        this.publishedApps = [...this.publishedApps, result];
      }

      this.publishState = 'done';
      this.publishUrl = result.url;
      this._onChange();

      // Auto-clear success state after 5 seconds
      setTimeout(() => {
        if (this.publishState === 'done') {
          this.publishState = 'idle';
          this.publishUrl = null;
          this._onChange();
        }
      }, 5000);
    } catch (e) {
      this.publishState = 'error';
      this.publishMessage = e instanceof Error ? e.message : String(e);
      this._onChange();
    }
  }

  // ---------------------------------------------------------------------------
  // Environment switching
  // ---------------------------------------------------------------------------

  async switchEnv(newEnv: Environment): Promise<void> {
    if (newEnv === this.env) return;
    this.env = newEnv;
    storageSet('rool-devhost:env', newEnv);
    this._destroyAllBridgesAndChannels();
    this.currentSpaceId = null;
    this.spaces = [];
    this.publishedApps = [];
    this.installedAppIds = [];
    this._onChange();
    await this.boot();
  }

  // ---------------------------------------------------------------------------
  // Sidebar
  // ---------------------------------------------------------------------------

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    storageSet('rool-devhost:collapsed', String(this.sidebarCollapsed));
    this._onChange();
  }

  // ---------------------------------------------------------------------------
  // Iframe registration (called by Svelte action)
  // ---------------------------------------------------------------------------

  registerIframe(tabId: string, el: HTMLIFrameElement): void {
    this.iframeEls[tabId] = el;
    this._bindBridge(tabId);
  }

  unregisterIframe(tabId: string): void {
    delete this.iframeEls[tabId];
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  logout(): void {
    this.client.logout();
    window.location.reload();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _bindBridge(tabId: string): void {
    const el = this.iframeEls[tabId];
    const ch = this.channels[tabId];
    if (el && ch && !this.bridgeHosts[tabId]) {
      this.bridgeHosts[tabId] = createBridgeHost({ channel: ch, iframe: el });
    }
  }

  private _bindAllBridges(): void {
    for (const tab of this.tabs) {
      this._bindBridge(tab.id);
    }
  }

  private _destroyTab(tabId: string): void {
    this.bridgeHosts[tabId]?.destroy();
    delete this.bridgeHosts[tabId];
    this.channels[tabId]?.close();
    delete this.channels[tabId];
    delete this.iframeEls[tabId];
  }

  private _destroyAllBridgesAndChannels(): void {
    for (const host of Object.values(this.bridgeHosts)) {
      host.destroy();
    }
    for (const ch of Object.values(this.channels)) {
      ch.close();
    }
    this.bridgeHosts = {};
    this.channels = {};
    this.iframeEls = {};
  }

  /**
   * Idempotently sync a manifest's settings (name, system instruction, collections)
   * onto a channel. Safe to call every time the app is opened.
   */
  private async _syncManifest(channel: RoolChannel, manifest: AppManifest | null): Promise<void> {
    if (!manifest) return;

    if (channel.channelName !== manifest.name) {
      await channel.rename(manifest.name);
    }

    const targetInstruction = manifest.systemInstruction ?? null;
    const currentInstruction = channel.getSystemInstruction() ?? null;
    if (currentInstruction !== targetInstruction) {
      await channel.setSystemInstruction(targetInstruction);
    }

    const currentSchema = channel.getSchema();
    const syncCollections = async (colls: Record<string, { name: string; type: Record<string, unknown> }[]>) => {
      for (const [name, fields] of Object.entries(colls)) {
        if (name in currentSchema) {
          await channel.alterCollection(name, fields as any);
        } else {
          await channel.createCollection(name, fields as any);
        }
      }
    };
    const { write: w, read: r } = manifest.collections;
    if (w && w !== '*') await syncCollections(w);
    if (r && r !== '*') await syncCollections(r);
  }

  private _getSavedEnv(): Environment {
    const saved = storageGet('rool-devhost:env');
    if (saved === 'local' || saved === 'dev' || saved === 'prod') return saved;
    return 'prod';
  }
}
