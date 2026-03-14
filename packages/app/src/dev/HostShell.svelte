<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { DevHostController } from './DevHostController.js';
  import type { AppTab } from './DevHostController.js';
  import type { AppManifest } from '../manifest.js';
  import type { RoolSpaceInfo, PublishedAppInfo } from '@rool-dev/sdk';
  import type { Environment } from '../manifest.js';
  import Sidebar from './Sidebar.svelte';
  import TabBar from './TabBar.svelte';

  // Props injected from the mount entry
  interface Props {
    channelId: string;
    appUrl: string;
    manifest: AppManifest | null;
    manifestError: string | null;
  }

  const props: Props = $props();

  // ---------------------------------------------------------------------------
  // Controller + reactive state mirror
  // ---------------------------------------------------------------------------

  // Svelte $state mirrors of controller fields — the controller calls onChange()
  // to trigger a sync, and we copy its fields into reactive variables.
  let spaces: RoolSpaceInfo[] = $state([]);
  let currentSpaceId: string | null = $state(null);
  let statusText: string = $state('Initializing...');
  let statusState: 'ok' | 'loading' | 'off' = $state('off');
  let placeholderText: string | null = $state('Authenticating...');
  let sidebarCollapsed: boolean = $state(false);
  let env: Environment = $state('prod');
  let publishedApps: PublishedAppInfo[] = $state([]);
  let installedAppIds: string[] = $state([]);
  let activeTab: string = $state('local');
  let tabs: AppTab[] = $state([]);

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
    publishedApps = controller.publishedApps;
    installedAppIds = controller.installedAppIds;
    activeTab = controller.activeTab;
    tabs = controller.tabs;
  }

  // Derived: published apps not yet installed (excluding the local dev app)
  let uninstalledApps = $derived(
    publishedApps.filter((app) => app.appId !== props.channelId && !installedAppIds.includes(app.appId)),
  );

  // Initial sync
  syncState();

  // ---------------------------------------------------------------------------
  // Svelte action: register iframe with controller
  // ---------------------------------------------------------------------------

  function registerIframe(el: HTMLIFrameElement, tabId: string) {
    controller.registerIframe(tabId, el);
    return {
      destroy() {
        controller.unregisterIframe(tabId);
      }
    };
  }

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
  bind:dropdownOpen
/>

<!-- Main area -->
<div class="flex-1 min-w-0 flex flex-col">
  <!-- Tab bar (always shown when not in placeholder state, so user can install apps via +) -->
  {#if !placeholderText}
    <TabBar
      {tabs}
      {activeTab}
      {uninstalledApps}
      onSelectTab={(id) => controller.selectTab(id)}
      onRemoveApp={(id) => controller.removeApp(id)}
      onInstallApp={(id) => controller.installApp(id)}
    />
  {/if}

  <!-- App frames -->
  <div class="flex-1 min-h-0 relative">
    {#if placeholderText}
      <div class="flex items-center justify-center h-full text-slate-400 text-sm">{placeholderText}</div>
    {:else}
      {#each tabs as tab (tab.id)}
        <iframe
          use:registerIframe={tab.id}
          class="w-full h-full border-0 absolute inset-0"
          class:hidden={activeTab !== tab.id}
          src={tab.url}
          sandbox="allow-scripts allow-same-origin"
          title={tab.name}
        ></iframe>
      {/each}
    {/if}
  </div>
</div>
