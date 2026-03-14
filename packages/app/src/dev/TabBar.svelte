<script lang="ts">
  import type { AppTab } from './DevHostController.js';
  import type { PublishedAppInfo } from '@rool-dev/sdk';

  interface Props {
    tabs: AppTab[];
    activeTab: string;
    uninstalledApps: PublishedAppInfo[];
    onSelectTab: (id: string) => void;
    onRemoveApp: (id: string) => void;
    onInstallApp: (appId: string) => void;
  }

  let { tabs, activeTab, uninstalledApps, onSelectTab, onRemoveApp, onInstallApp }: Props = $props();

  let addMenuOpen = $state(false);
</script>

<div class="flex items-end border-b border-slate-200 bg-slate-50 px-2 pt-1 shrink-0">
  {#each tabs as tab}
    <div
      class="relative px-3 py-1.5 text-[12px] font-medium rounded-t-md transition-colors mr-0.5 flex items-center gap-1.5 cursor-pointer select-none
        {activeTab === tab.id
          ? 'bg-white text-slate-800 border border-slate-200 border-b-white -mb-px z-10'
          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-transparent'}"
      role="tab"
      tabindex="0"
      aria-selected={activeTab === tab.id}
      onclick={() => onSelectTab(tab.id)}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectTab(tab.id); } }}
    >
      {#if tab.isLocal}
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Local dev"></span>
      {/if}
      {tab.name}
      {#if !tab.isLocal}
        <button
          class="ml-1 text-slate-400 hover:text-red-500 transition-colors p-0 border-none bg-transparent leading-none"
          type="button"
          title="Uninstall app"
          onclick={(e: MouseEvent) => { e.stopPropagation(); onRemoveApp(tab.id); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      {/if}
    </div>
  {/each}

  <!-- Add app button -->
  {#if uninstalledApps.length > 0}
    <div class="relative ml-1 mb-0.5" data-add-menu>
      <button
        class="px-2 py-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors border-none bg-transparent"
        type="button"
        title="Install app"
        onclick={(e: MouseEvent) => { e.stopPropagation(); addMenuOpen = !addMenuOpen; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
      </button>
      {#if addMenuOpen}
        <div class="absolute top-full mt-1 left-0 min-w-[200px] max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg z-50 py-1">
          <div class="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Install App</div>
          {#each uninstalledApps as app}
            <button
              class="block w-full px-2.5 py-1.5 text-[13px] text-left truncate border-none cursor-pointer hover:bg-slate-100 text-slate-700 bg-transparent"
              type="button"
              onclick={() => { addMenuOpen = false; onInstallApp(app.appId); }}
            >
              <span class="font-medium">{app.name}</span>
              <span class="text-[10px] text-slate-400 font-mono ml-1.5">{app.appId}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<svelte:document onclick={(e: MouseEvent) => {
  if (addMenuOpen && !(e.target as Element)?.closest('[data-add-menu]')) {
    addMenuOpen = false;
  }
}} />
