<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { DevHostController } from './DevHostController.js';
  import type { ExtensionTab } from './DevHostController.js';
  import type { Manifest } from '../manifest.js';
  import type { RoolSpaceInfo, PublishedExtensionInfo } from '@rool-dev/sdk';
  import type { Environment } from '../manifest.js';
  import Sidebar from './Sidebar.svelte';
  import AppGrid from './AppGrid.svelte';

  // Props injected from the mount entry
  interface Props {
    channelId: string;
    extensionUrl: string;
    manifest: Manifest | null;
    manifestError: string | null;
  }

  const props: Props = $props();

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
  let publishedExtensions: PublishedExtensionInfo[] = $state([]);
  let installedExtensionIds: string[] = $state([]);
  let tabs: ExtensionTab[] = $state([]);
  let publishState: 'idle' | 'building' | 'uploading' | 'done' | 'error' = $state('idle');
  let publishMessage: string | null = $state(null);
  let publishUrl: string | null = $state(null);

  // UI-only state (not in controller)
  let dropdownOpen: boolean = $state(false);

  const controller = new DevHostController(
    props,
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
    env = controller.env;
    publishedExtensions = controller.publishedExtensions;
    installedExtensionIds = controller.installedExtensionIds;
    tabs = controller.tabs;
    publishState = controller.publishState;
    publishMessage = controller.publishMessage;
    publishUrl = controller.publishUrl;
  }

  // Derived: published apps not yet installed (excluding the local dev app)
  let uninstalledExtensions = $derived(
    publishedExtensions.filter((ext) => ext.extensionId !== props.channelId && !installedExtensionIds.includes(ext.extensionId)),
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
  manifest={props.manifest}
  manifestError={props.manifestError}
  {spaces}
  {currentSpaceId}
  {env}
  {statusText}
  {statusState}
  {sidebarCollapsed}
  {publishState}
  {publishMessage}
  {publishUrl}
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
