<script lang="ts">
  import { getContext, onMount, tick } from 'svelte';
  import { DevHostController } from './DevHostController.js';
  import type { ExtensionTab } from './DevHostController.js';
  import type { Manifest } from '../manifest.js';
  import type { RoolSpaceInfo, ExtensionInfo } from '@rool-dev/sdk';
  import type { Environment } from '../manifest.js';
  import Sidebar from './Sidebar.svelte';
  import AppGrid from './AppGrid.svelte';

  // Static config injected via mount() context — not reactive, never changes
  interface HostConfig {
    channelId: string;
    extensionUrl: string;
    manifest: Manifest | null;
    manifestError: string | null;
  }

  const { channelId, extensionUrl, manifest, manifestError } = getContext<HostConfig>('hostConfig');

  // ---------------------------------------------------------------------------
  // Controller + reactive state mirror
  // ---------------------------------------------------------------------------

  let spaces: RoolSpaceInfo[] = $state([]);
  let currentSpaceId: string | null = $state(null);
  let statusText: string = $state('Initializing...');
  let statusState: 'ok' | 'loading' | 'off' = $state('off');
  let placeholderText: string | null = $state('Authenticating...');
  let sidebarCollapsed: boolean = $state(false);
  let env: Environment = $state('prod');
  let userExtensions: ExtensionInfo[] = $state([]);
  let installedExtensionIds: string[] = $state([]);
  let tabs: ExtensionTab[] = $state([]);
  let colorScheme: 'light' | 'dark' = $state('light');
  let uploadState: 'idle' | 'building' | 'uploading' | 'done' | 'error' = $state('idle');
  let uploadMessage: string | null = $state(null);
  let uploadUrl: string | null = $state(null);

  // UI-only state (not in controller)
  let dropdownOpen: boolean = $state(false);

  const controller = new DevHostController(
    { channelId, extensionUrl, manifest, manifestError },
    syncState,
    tick,
  );

  function syncState() {
    spaces = controller.spaces;
    currentSpaceId = controller.currentSpaceId;
    statusText = controller.statusText;
    statusState = controller.statusState;
    placeholderText = controller.placeholderText;
    sidebarCollapsed = controller.sidebarCollapsed;
    colorScheme = controller.colorScheme;
    env = controller.env;
    userExtensions = controller.userExtensions;
    installedExtensionIds = controller.installedExtensionIds;
    tabs = controller.tabs;
    uploadState = controller.uploadState;
    uploadMessage = controller.uploadMessage;
    uploadUrl = controller.uploadUrl;
  }

  // Derived: user extensions not yet installed (excluding the local dev extension)
  let uninstalledExtensions = $derived(
    userExtensions.filter((ext) => ext.extensionId !== channelId && !installedExtensionIds.includes(ext.extensionId)),
  );

  // Initial sync
  syncState();

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  onMount(() => {
    controller.boot();

    function handleClickOutside(e: MouseEvent) {
      if (dropdownOpen && !(e.target as Element)?.closest('[data-dropdown]')) {
        dropdownOpen = false;
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });
</script>

<!-- Sidebar -->
<Sidebar
  {controller}
  {manifest}
  {manifestError}
  {spaces}
  {currentSpaceId}
  {env}
  {statusText}
  {statusState}
  {sidebarCollapsed}
  {colorScheme}
  {uploadState}
  {uploadMessage}
  {uploadUrl}
  bind:dropdownOpen
/>

<!-- Main area -->
<div class="flex-1 min-w-0 flex flex-col">
  {#if placeholderText}
    <div class="flex items-center justify-center h-full text-slate-400 text-sm">{placeholderText}</div>
  {:else}
    <AppGrid
      {controller}
      {tabs}
      uninstalledExtensions={uninstalledExtensions}
      onInstallExtension={(id) => controller.installExtension(id)}
      onRemoveExtension={(id) => controller.removeExtension(id)}
    />
  {/if}
</div>
