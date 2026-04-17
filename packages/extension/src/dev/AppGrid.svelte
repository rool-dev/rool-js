<script lang="ts">
  import { onMount } from 'svelte';
  import { GridStack } from 'gridstack';
  import type { ExtensionTab } from './DevHostController.js';
  import type { DevHostController } from './DevHostController.js';
  import type { ExtensionInfo } from '@rool-dev/sdk';

  interface Props {
    controller: DevHostController;
    tabs: ExtensionTab[];
    uninstalledExtensions: ExtensionInfo[];
    onInstallExtension: (extensionId: string) => void;
    onRemoveExtension: (extensionId: string) => void;
  }

  let { controller, tabs, uninstalledExtensions, onInstallExtension, onRemoveExtension }: Props = $props();

  let gridEl: HTMLDivElement;
  let grid: GridStack;
  let addMenuOpen = $state(false);

  let mountedTabIds = new Set<string>();

  // --- Layout persistence ---

  interface SavedWidget { id: string; x: number; y: number; w: number; h: number }

  function layoutKey(): string {
    return `rool-devhost:layout:${controller.currentSpaceId ?? 'default'}`;
  }

  function loadLayout(): Record<string, SavedWidget> {
    try {
      const raw = localStorage.getItem(layoutKey());
      if (!raw) return {};
      const arr: SavedWidget[] = JSON.parse(raw);
      const map: Record<string, SavedWidget> = {};
      for (const w of arr) map[w.id] = w;
      return map;
    } catch { return {}; }
  }

  function saveLayout() {
    if (!grid) return;
    const widgets: SavedWidget[] = [];
    for (const node of grid.engine.nodes) {
      if (node.id) {
        widgets.push({ id: node.id as string, x: node.x!, y: node.y!, w: node.w!, h: node.h! });
      }
    }
    try { localStorage.setItem(layoutKey(), JSON.stringify(widgets)); } catch {}
  }

  function defaultPosition(count: number): { x: number; y: number; w: number; h: number } {
    if (count <= 1) return { x: 0, y: 0, w: 12, h: 6 };
    return {
      w: 6,
      h: 6,
      x: ((count - 1) % 2) * 6,
      y: Math.floor((count - 1) / 2) * 6,
    };
  }

  onMount(() => {
    grid = GridStack.init({
      column: 12,
      cellHeight: 80,
      margin: 6,
      animate: true,
      float: true,
      draggable: { handle: '.app-card-handle' },
      resizable: { handles: 'e,se,s,sw,w' },
    }, gridEl);

    grid.on('dragstart resizestart', () => {
      gridEl.classList.add('gs-dragging');
    });
    grid.on('dragstop resizestop', () => {
      gridEl.classList.remove('gs-dragging');
    });

    // Save layout after any drag/resize/add/remove settles
    grid.on('change', () => saveLayout());

    const saved = loadLayout();
    for (const tab of tabs) {
      addTabWidget(tab, saved);
    }

    return () => {
      grid.destroy(false);
    };
  });

  function addTabWidget(tab: ExtensionTab, savedLayout?: Record<string, SavedWidget>) {
    if (mountedTabIds.has(tab.id)) return;
    mountedTabIds.add(tab.id);

    const saved = savedLayout?.[tab.id];
    let { x, y, w, h } = saved ?? defaultPosition(mountedTabIds.size);

    // If no saved layout and this is the second widget, shrink the first
    if (!saved && mountedTabIds.size === 2) {
      const firstEl = gridEl.querySelector(`[gs-id="${[...mountedTabIds][0]}"]`) as HTMLElement;
      if (firstEl) grid.update(firstEl, { w: 6 });
    }

    const widgetEl = grid.addWidget({ id: tab.id, x, y, w, h, content: '' });

    const contentEl = widgetEl.querySelector('.grid-stack-item-content') as HTMLElement;
    contentEl.innerHTML = '';
    contentEl.className = 'grid-stack-item-content flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm'
      + (tab.isLocal ? ' border-emerald-300' : ' border-slate-200');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.className = 'app-card-handle flex items-center gap-1.5 px-2.5 h-8 border-b cursor-grab select-none shrink-0'
      + (tab.isLocal
        ? ' bg-emerald-50 border-emerald-200'
        : ' bg-slate-50 border-slate-200');

    if (tab.isLocal) {
      const badge = document.createElement('span');
      badge.className = 'text-[9px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded px-1 py-px tracking-wide';
      badge.textContent = 'DEV';
      titleBar.appendChild(badge);
    }

    const name = document.createElement('span');
    name.className = 'text-xs font-medium text-slate-700 flex-1 min-w-0 truncate';
    name.textContent = tab.name;
    titleBar.appendChild(name);

    if (!tab.isLocal) {
      const id = document.createElement('span');
      id.className = 'text-[10px] text-slate-400 font-mono shrink-0';
      id.textContent = tab.id;
      titleBar.appendChild(id);

      const close = document.createElement('button');
      close.className = 'border-none bg-transparent cursor-pointer text-slate-400 hover:text-red-500 p-0.5 leading-none shrink-0 transition-colors';
      close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';
      close.title = 'Uninstall extension';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTabWidget(tab.id);
        onRemoveExtension(tab.id);
      });
      titleBar.appendChild(close);
    }

    contentEl.appendChild(titleBar);

    const iframe = document.createElement('iframe');
    iframe.src = tab.url;
    iframe.title = tab.name;
    iframe.sandbox.add('allow-scripts', 'allow-same-origin');
    iframe.className = 'flex-1 border-0 min-h-0 w-full';
    contentEl.appendChild(iframe);

    controller.registerIframe(tab.id, iframe);
  }

  function removeTabWidget(tabId: string) {
    const el = gridEl.querySelector(`[gs-id="${tabId}"]`) as HTMLElement;
    if (el) {
      controller.unregisterIframe(tabId);
      grid.removeWidget(el);
      mountedTabIds.delete(tabId);
      saveLayout();
    }
  }

  $effect(() => {
    if (!grid) return;
    const currentIds = new Set(tabs.map(t => t.id));

    for (const tab of tabs) {
      if (!mountedTabIds.has(tab.id)) addTabWidget(tab);
    }
    for (const id of mountedTabIds) {
      if (!currentIds.has(id)) removeTabWidget(id);
    }
  });
</script>

<div class="flex-1 min-h-0 relative flex flex-col">
  <!-- Toolbar -->
  <div class="flex items-center px-3 py-1.5 bg-white border-b border-slate-200 shrink-0">
    <span class="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Extensions</span>
    <div class="flex-1"></div>
    {#if uninstalledExtensions.length > 0}
      <div class="relative" data-add-menu>
        <button
          class="px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-md transition-colors border border-slate-200 bg-white flex items-center gap-1.5"
          type="button"
          onclick={(e: MouseEvent) => { e.stopPropagation(); addMenuOpen = !addMenuOpen; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Install
        </button>
        {#if addMenuOpen}
          <div class="absolute top-full mt-1 right-0 min-w-[200px] max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
            {#each uninstalledExtensions as ext}
              <button
                class="flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] text-left border-none cursor-pointer hover:bg-slate-50 text-slate-700 bg-transparent"
                type="button"
                onclick={() => { addMenuOpen = false; onInstallExtension(ext.extensionId); }}
              >
                <span class="font-medium">{ext.manifest.name}</span>
                <span class="text-[10px] text-slate-400 font-mono ml-auto">{ext.extensionId}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Grid -->
  <div class="flex-1 min-h-0 overflow-auto bg-slate-100 p-2">
    <div bind:this={gridEl} class="grid-stack"></div>
  </div>
</div>

<svelte:document onclick={(e: MouseEvent) => {
  if (addMenuOpen && !(e.target as Element)?.closest('[data-add-menu]')) {
    addMenuOpen = false;
  }
}} />

<style>
  /* Only GridStack overrides that can't be done with Tailwind */
  :global(.gs-dragging .grid-stack-item-content iframe) {
    pointer-events: none !important;
  }
  :global(.ui-draggable-dragging > .grid-stack-item-content),
  :global(.ui-resizable-resizing > .grid-stack-item-content) {
    opacity: 1 !important;
  }
  :global(.grid-stack-placeholder > .placeholder-content) {
    background: rgba(99, 102, 241, 0.06) !important;
    border: 2px dashed #c7d2fe !important;
    border-radius: 8px !important;
  }
</style>
