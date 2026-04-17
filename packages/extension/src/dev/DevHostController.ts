/**
 * DevHostController — business logic for the dev host shell.
 *
 * Owns the RoolClient lifecycle, space management, channel-per-extension management,
 * bridge hosting, and published extension management. The Svelte component is a thin
 * view layer that reads this controller's state and calls its methods.
 *
 * The controller is self-sufficient: it manages the full lifecycle including
 * DOM flush (via injected tick) and bridge binding. Svelte components can call
 * controller methods directly without needing wrappers.
 */

import { RoolClient } from '@rool-dev/sdk';
import type { RoolSpaceInfo, RoolChannel, ExtensionInfo } from '@rool-dev/sdk';
import { createBridgeHost, type BridgeHost } from '../host.js';
import type { BridgeUser, ColorScheme } from '../protocol.js';
import type { Manifest, Environment } from '../manifest.js';
import { ENV_URLS } from '../manifest.js';

export interface ExtensionTab {
  id: string;        // 'local' or the published extension ID
  name: string;
  url: string;
  isLocal: boolean;
}

export type StatusState = 'ok' | 'loading' | 'off';

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

export class DevHostController {
  // --- Config (immutable after construction) ---
  readonly channelId: string;
  readonly extensionUrl: string;
  readonly manifest: Manifest | null;
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
  userExtensions: ExtensionInfo[] = [];
  installedExtensionIds: string[] = [];
  sidebarCollapsed: boolean = false;
  colorScheme: ColorScheme = 'light';
  uploadState: 'idle' | 'building' | 'uploading' | 'done' | 'error' = 'idle';
  uploadMessage: string | null = null;
  uploadUrl: string | null = null;

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
      extensionUrl: string;
      manifest: Manifest | null;
      manifestError: string | null;
    },
    onChange: () => void,
    tick: () => Promise<void>,
  ) {
    this.channelId = options.channelId;
    this.extensionUrl = options.extensionUrl;
    this.manifest = options.manifest;
    this.manifestError = options.manifestError;
    this._onChange = onChange;
    this._tick = tick;

    this._spaceKey = `rool-devhost:${options.channelId}:space`;

    // Restore persisted state
    this.env = this._getSavedEnv();
    this.sidebarCollapsed = storageGet('rool-devhost:collapsed') === 'true';
    this.colorScheme = this._getSavedColorScheme();
  }

  get tabs(): ExtensionTab[] {
    const localTab: ExtensionTab = {
      id: 'local',
      name: this.manifest?.name ?? 'Local',
      url: this.extensionUrl,
      isLocal: true,
    };
    const extensionTabs: ExtensionTab[] = this.installedExtensionIds
      .map((id) => {
        const ch = this.channels[id];
        if (!ch?.extensionUrl) return null;
        return {
          id,
          name: ch.channelName ?? id,
          url: ch.extensionUrl,
          isLocal: false,
        } as ExtensionTab;
      })
      .filter((t): t is ExtensionTab => t !== null);
    return [localTab, ...extensionTabs];
  }

  async boot(): Promise<void> {
    const envConfig = ENV_URLS[this.env];
    this.client = new RoolClient({ apiUrl: envConfig.apiUrl, authUrl: envConfig.authUrl });
    const authenticated = await this.client.initialize();

    if (!authenticated) {
      this.placeholderText = 'Redirecting to login...';
      this.statusText = 'Authenticating...';
      this.statusState = 'loading';
      this._onChange();
      this.client.login('Extension Dev Host');
      return;
    }

    this.placeholderText = 'Loading spaces...';
    this.statusText = 'Loading spaces...';
    this.statusState = 'loading';
    this._onChange();

    const [spaceList, extensionList] = await Promise.all([
      this.client.listSpaces(),
      this.client.listExtensions().catch(() => [] as ExtensionInfo[]),
    ]);

    this.spaces = spaceList;
    this.userExtensions = extensionList;

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
      this.placeholderText = 'Select a space to load the extension';
      this._onChange();
    }
  }

  async selectSpace(spaceId: string): Promise<void> {
    this._destroyAllBridgesAndChannels();

    this.currentSpaceId = spaceId;
    storageSet(this._spaceKey, spaceId);
    this.statusText = 'Opening channels...';
    this.statusState = 'loading';
    this.placeholderText = 'Opening channels...';
    this._onChange();

    try {
      // Open the local extension's channel
      const localChannel = await this.client.openChannel(spaceId, this.channelId);
      this.channels['local'] = localChannel;

      // Apply manifest settings to the local channel
      await this._syncManifest(localChannel, this.manifest);

      // Discover installed extensions: channels with an extensionUrl
      const space = await this.client.openSpace(spaceId);
      const spaceChannels = space.getChannels();
      this.installedExtensionIds = spaceChannels
        .filter((ch) => ch.extensionUrl && ch.id !== this.channelId)
        .map((ch) => ch.id);

      // Open channels for each installed extension (server already applied manifest)
      for (const extId of this.installedExtensionIds) {
        try {
          const ch = await this.client.openChannel(spaceId, extId);
          this.channels[extId] = ch;
        } catch (e) {
          console.error(`Failed to open channel for extension ${extId}:`, e);
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

  /**
   * Install an extension in the current space.
   *
   * Opens the channel first, THEN adds the tab. This ensures the channel
   * exists when the iframe mounts so registerIframe → _bindBridge can
   * connect the bridge before the extension sends its init message.
   */
  async installExtension(extensionId: string): Promise<void> {
    if (!this.currentSpaceId) return;
    if (this.installedExtensionIds.includes(extensionId)) return;

    try {
      // Step 1: install extension (server applies manifest: name, systemInstruction, collections)
      const channelId = await this.client.installExtension(this.currentSpaceId, extensionId, extensionId);

      // Step 2: open channel for live subscription
      const ch = await this.client.openChannel(this.currentSpaceId, channelId);
      this.channels[extensionId] = ch;

      // Step 3: add the card, flush DOM, bind bridge
      this.installedExtensionIds = [...this.installedExtensionIds, extensionId];
      this._onChange();
      await this._tick();
      this._bindBridge(extensionId);
    } catch (e) {
      console.error(`Failed to install extension ${extensionId}:`, e);
      this.installedExtensionIds = this.installedExtensionIds.filter((id) => id !== extensionId);
      this._onChange();
    }
  }

  /**
   * Uninstall an extension from the current space.
   * Deletes the channel and removes the card.
   */
  removeExtension(extensionId: string): void {
    this._destroyTab(extensionId);
    this.installedExtensionIds = this.installedExtensionIds.filter((id) => id !== extensionId);
    this._onChange();

    // Delete the channel in the background (fire-and-forget)
    if (this.currentSpaceId) {
      this.client.deleteChannel(this.currentSpaceId, extensionId).catch((e) => {
        console.error(`Failed to delete channel for extension ${extensionId}:`, e);
      });
    }
  }

  async upload(): Promise<void> {
    if (!this.manifest) {
      this.uploadState = 'error';
      this.uploadMessage = 'No valid manifest found';
      this._onChange();
      return;
    }

    this.uploadState = 'building';
    this.uploadMessage = null;
    this.uploadUrl = null;
    this._onChange();

    try {
      // Step 1: trigger server-side Vite build + zip
      const buildRes = await fetch('/__rool-host/publish', { method: 'POST' });
      if (!buildRes.ok) {
        const body = await buildRes.json().catch(() => ({ error: 'Build failed' }));
        throw new Error(body.error || 'Build failed');
      }

      const zipBlob = await buildRes.blob();

      // Step 2: upload via SDK
      this.uploadState = 'uploading';
      this._onChange();

      const result = await this.client.uploadExtension(this.manifest.id, {
        bundle: zipBlob,
      });

      // Step 3: update user extensions list
      const existingIdx = this.userExtensions.findIndex((a) => a.extensionId === result.extensionId);
      if (existingIdx >= 0) {
        this.userExtensions = [
          ...this.userExtensions.slice(0, existingIdx),
          result,
          ...this.userExtensions.slice(existingIdx + 1),
        ];
      } else {
        this.userExtensions = [...this.userExtensions, result];
      }

      this.uploadState = 'done';
      this.uploadUrl = result.url;
      this._onChange();

      // Auto-clear success state after 5 seconds
      setTimeout(() => {
        if (this.uploadState === 'done') {
          this.uploadState = 'idle';
          this.uploadUrl = null;
          this._onChange();
        }
      }, 5000);
    } catch (e) {
      this.uploadState = 'error';
      this.uploadMessage = e instanceof Error ? e.message : String(e);
      this._onChange();
    }
  }

  async switchEnv(newEnv: Environment): Promise<void> {
    if (newEnv === this.env) return;
    this.env = newEnv;
    storageSet('rool-devhost:env', newEnv);
    this._destroyAllBridgesAndChannels();
    this.currentSpaceId = null;
    this.spaces = [];
    this.userExtensions = [];
    this.installedExtensionIds = [];
    this._onChange();
    await this.boot();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    storageSet('rool-devhost:collapsed', String(this.sidebarCollapsed));
    this._onChange();
  }

  toggleColorScheme(): void {
    this.colorScheme = this.colorScheme === 'light' ? 'dark' : 'light';
    storageSet('rool-devhost:colorScheme', this.colorScheme);
    for (const host of Object.values(this.bridgeHosts)) {
      host.setColorScheme(this.colorScheme);
    }
    this._onChange();
  }

  registerIframe(tabId: string, el: HTMLIFrameElement): void {
    this.iframeEls[tabId] = el;
    this._bindBridge(tabId);
  }

  unregisterIframe(tabId: string): void {
    delete this.iframeEls[tabId];
  }

  logout(): void {
    this.client.logout();
    window.location.reload();
  }

  private get _bridgeUser(): BridgeUser {
    const cu = this.client.currentUser!; // Always available after boot() authenticates
    return { id: cu.id, name: cu.name, email: cu.email };
  }

  private _bindBridge(tabId: string): void {
    const el = this.iframeEls[tabId];
    const ch = this.channels[tabId];
    if (el && ch && !this.bridgeHosts[tabId]) {
      this.bridgeHosts[tabId] = createBridgeHost({ channel: ch, iframe: el, user: this._bridgeUser, colorScheme: this.colorScheme });
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
   * onto a channel. Safe to call every time the extension is opened.
   */
  private async _syncManifest(channel: RoolChannel, manifest: Manifest | null): Promise<void> {
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

  private _getSavedColorScheme(): ColorScheme {
    const saved = storageGet('rool-devhost:colorScheme');
    if (saved === 'light' || saved === 'dark') return saved;
    // Fall back to OS preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
