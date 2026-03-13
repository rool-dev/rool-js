<script lang="ts">
  import { onMount } from 'svelte';
  import { RoolClient } from '@rool-dev/sdk';
  import type { RoolSpaceInfo, RoolChannel } from '@rool-dev/sdk';
  import { createBridgeHost, type BridgeHost } from '../host.js';

  // Props injected from the mount entry
  interface Props {
    channelId: string;
    appUrl: string;
    manifest: Manifest | null;
    manifestError: string | null;
  }

  interface ManifestFieldDef {
    name: string;
    type: Record<string, unknown>;
  }

  interface ManifestCollections {
    write?: Record<string, ManifestFieldDef[]> | '*';
    read?: Record<string, ManifestFieldDef[]> | '*';
  }

  interface Manifest {
    id: string;
    name: string;
    description?: string;
    systemInstruction?: string | null;
    collections?: ManifestCollections;
  }

  let { channelId, appUrl, manifest, manifestError }: Props = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let client: RoolClient;
  let spaces: RoolSpaceInfo[] = $state([]);
  let currentSpaceId: string | null = $state(null);
  let channel: RoolChannel | null = null;
  let bridgeHost: BridgeHost | null = null;

  let statusText: string = $state('Initializing...');
  let statusState: 'ok' | 'loading' | 'off' = $state('off');
  let placeholderText: string | null = $state('Authenticating...');
  let dropdownOpen: boolean = $state(false);

  let iframeEl: HTMLIFrameElement | null = $state(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  let selectedSpace = $derived(spaces.find((s) => s.id === currentSpaceId));

  // ---------------------------------------------------------------------------
  // Space persistence (localStorage)
  // ---------------------------------------------------------------------------

  const SPACE_STORAGE_KEY = `rool-devhost:${channelId}:space`;

  function getSavedSpace(): string | null {
    try { return localStorage.getItem(SPACE_STORAGE_KEY); } catch { return null; }
  }

  function saveSpace(id: string | null) {
    try {
      if (id) localStorage.setItem(SPACE_STORAGE_KEY, id);
      else localStorage.removeItem(SPACE_STORAGE_KEY);
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Channel + bridge lifecycle
  // ---------------------------------------------------------------------------

  async function selectSpace(spaceId: string) {
    bridgeHost?.destroy();
    bridgeHost = null;
    channel?.close();
    channel = null;
    iframeEl = null;

    currentSpaceId = spaceId;
    saveSpace(spaceId);
    dropdownOpen = false;
    statusText = 'Opening channel...';
    statusState = 'loading';
    placeholderText = 'Opening channel...';

    try {
      channel = await client.openChannel(spaceId, channelId);

      // Apply manifest settings to the channel
      if (manifest && channel.channelName !== manifest.name) {
        await channel.rename(manifest.name);
      }
      const targetInstruction = manifest?.systemInstruction ?? null;
      const currentInstruction = channel.getSystemInstruction() ?? null;
      if (currentInstruction !== targetInstruction) {
        await channel.setSystemInstruction(targetInstruction);
      }

      // Sync collections from manifest
      if (manifest?.collections) {
        const currentSchema = channel.getSchema();
        // Sync write collections (app defines and owns these)
        const writeCollections = manifest.collections.write;
        if (writeCollections && writeCollections !== '*') {
          for (const [name, fields] of Object.entries(writeCollections)) {
            if (name in currentSchema) {
              await channel.alterCollection(name, fields as any);
            } else {
              await channel.createCollection(name, fields as any);
            }
          }
        }
        // Sync read collections (app declares shape but doesn't own)
        const readCollections = manifest.collections.read;
        if (readCollections && readCollections !== '*') {
          for (const [name, fields] of Object.entries(readCollections)) {
            if (name in currentSchema) {
              await channel.alterCollection(name, fields as any);
            } else {
              await channel.createCollection(name, fields as any);
            }
          }
        }
      }

      placeholderText = null;

      // Wait a tick for the iframe to mount via the reactive template
      await new Promise((r) => setTimeout(r, 0));

      if (iframeEl) {
        bridgeHost = createBridgeHost({ channel, iframe: iframeEl });
      }

      const spaceName = spaces.find((s) => s.id === spaceId)?.name ?? spaceId;
      statusText = `Connected \u2014 ${spaceName}`;
      statusState = 'ok';
    } catch (e) {
      console.error('Failed to open channel:', e);
      placeholderText = `Error: ${e instanceof Error ? e.message : String(e)}`;
      statusText = 'Error';
      statusState = 'off';
    }
  }

  function logout() {
    client.logout();
    window.location.reload();
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  onMount(() => {
    boot();

    function handleClickOutside(e: MouseEvent) {
      if (dropdownOpen && !(e.target as Element)?.closest('[data-dropdown]')) {
        dropdownOpen = false;
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });

  async function boot() {
    client = new RoolClient();
    const authenticated = await client.initialize();

    if (!authenticated) {
      placeholderText = 'Redirecting to login...';
      statusText = 'Authenticating...';
      statusState = 'loading';
      client.login('App Dev Host');
      return;
    }

    placeholderText = 'Loading spaces...';
    statusText = 'Loading spaces...';
    statusState = 'loading';

    spaces = await client.listSpaces();

    client.on('spaceAdded', (space) => {
      if (!spaces.some((s) => s.id === space.id)) {
        spaces = [...spaces, space];
      }
    });
    client.on('spaceRemoved', (id) => {
      spaces = spaces.filter((s) => s.id !== id);
      if (currentSpaceId === id) {
        currentSpaceId = null;
        statusText = 'Disconnected';
        statusState = 'off';
      }
    });
    client.on('spaceRenamed', (id, name) => {
      spaces = spaces.map((s) => (s.id === id ? { ...s, name } : s));
    });

    statusText = 'Ready';
    statusState = 'off';

    const savedSpace = getSavedSpace();
    if (savedSpace && spaces.some((s) => s.id === savedSpace)) {
      await selectSpace(savedSpace);
    } else {
      placeholderText = 'Select a space to load the app';
    }
  }
</script>

<!-- Sidebar -->
<div class="w-[260px] shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
  <div class="p-4 border-b border-slate-100">
    <div class="font-bold text-[13px] text-slate-800 uppercase tracking-wide">Dev Host</div>
  </div>

  <!-- Space picker -->
  <div class="px-4 py-3 border-b border-slate-100">
    <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Space</div>
    <div class="relative" data-dropdown>
      <button
        class="w-full py-1.5 pl-2.5 pr-8 text-[13px] border border-slate-200 rounded-md bg-white text-slate-700 text-left truncate cursor-pointer outline-none hover:border-slate-300 {dropdownOpen ? 'border-indigo-500 ring-2 ring-indigo-500/12' : 'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/12'}"
        type="button"
        onclick={(e) => { e.stopPropagation(); dropdownOpen = !dropdownOpen; }}
      >
        {selectedSpace?.name ?? 'Select a space...'}
        <svg class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {#if dropdownOpen}
        <div class="absolute top-full mt-1 left-0 min-w-full max-w-[360px] max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg z-50 py-1">
          {#each spaces as space}
            <button
              class="block w-full px-2.5 py-1.5 text-[13px] text-left truncate border-none cursor-pointer hover:bg-slate-100 {space.id === currentSpaceId ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-slate-700 bg-transparent'}"
              type="button"
              onclick={() => selectSpace(space.id)}
            >
              {space.name}
            </button>
          {:else}
            <div class="px-2.5 py-1.5 text-[13px] text-slate-400">No spaces available</div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Manifest info -->
  {#if manifest}
    <div class="px-4 py-3 border-b border-slate-100">
      <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">App</div>
      <div class="font-semibold text-sm text-slate-800 mb-0.5">{manifest.name}</div>
      {#if manifest.description}
        <div class="text-xs text-slate-500 leading-snug">{manifest.description}</div>
      {/if}
      <div class="text-[11px] text-slate-400 font-mono mt-1">{manifest.id}</div>
    </div>

    <div class="px-4 py-3 border-b border-slate-100">
      <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Collections</div>
      {#if manifest.collections}
        <div class="space-y-2.5">
          <!-- Defined collections (write with field definitions) -->
          {#if manifest.collections.write && manifest.collections.write !== '*'}
            <div>
              <div class="text-[10px] font-semibold text-emerald-600 mb-1">Defines</div>
              <div class="space-y-1">
                {#each Object.entries(manifest.collections.write) as [name, fields]}
                  <div class="flex items-baseline gap-1.5 pl-2 border-l-2 border-emerald-200">
                    <span class="text-[11px] font-medium text-slate-700 shrink-0">{name}</span>
                    <span class="text-[10px] text-slate-400 truncate">{fields.map(f => f.name).join(', ')}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <!-- Read-only defined collections -->
          {#if manifest.collections.read && manifest.collections.read !== '*'}
            <div>
              <div class="text-[10px] font-semibold text-blue-600 mb-1">Defines (read-only)</div>
              <div class="space-y-1">
                {#each Object.entries(manifest.collections.read) as [name, fields]}
                  <div class="flex items-baseline gap-1.5 pl-2 border-l-2 border-blue-200">
                    <span class="text-[11px] font-medium text-slate-700 shrink-0">{name}</span>
                    <span class="text-[10px] text-slate-400 truncate">{fields.map(f => f.name).join(', ')}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <!-- Access requests -->
          {#if manifest.collections.write === '*' || manifest.collections.read === '*'}
            <div>
              <div class="text-[10px] font-semibold text-slate-500 mb-1">Requests access</div>
              <div class="space-y-0.5 pl-2">
                {#if manifest.collections.write === '*'}
                  <div class="text-[11px] text-slate-600">Read & write all collections</div>
                {:else if manifest.collections.read === '*'}
                  <div class="text-[11px] text-slate-600">Read all collections</div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <span class="text-xs text-slate-400">None</span>
      {/if}
    </div>

    <div class="px-4 py-3 border-b border-slate-100">
      <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">System Instruction</div>
      {#if manifest.systemInstruction}
        <div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2 whitespace-pre-wrap leading-snug max-h-30 overflow-y-auto">{manifest.systemInstruction}</div>
      {:else}
        <div class="text-slate-400 italic text-xs">None</div>
      {/if}
    </div>
  {:else}
    <div class="px-4 py-3 border-b border-slate-100">
      <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">App</div>
      <div class="text-xs text-red-500">{manifestError ?? 'No rool-app.json found'}</div>
    </div>
  {/if}

  {#if manifestError && manifest}
    <div class="px-3 py-2 mx-3 mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md">
      {manifestError}
    </div>
  {/if}

  <!-- Status -->
  <div class="px-4 py-3 mt-auto">
    <div class="text-[11px] text-slate-400 leading-normal">
      <span
        class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle {statusState === 'ok' ? 'bg-green-500' : statusState === 'loading' ? 'bg-amber-500' : 'bg-slate-400'}"
      ></span>
      {statusText}
    </div>
    <button
      class="block w-full mt-2.5 py-1.5 text-xs font-medium text-slate-500 bg-transparent border border-slate-200 rounded-md cursor-pointer transition-colors hover:bg-red-50 hover:text-red-600 hover:border-red-200"
      onclick={logout}
    >
      Sign out
    </button>
  </div>
</div>

<!-- Main area -->
<div class="flex-1 min-w-0 flex flex-col">
  <div class="flex-1 min-h-0 relative">
    {#if placeholderText}
      <div class="flex items-center justify-center h-full text-slate-400 text-sm">{placeholderText}</div>
    {:else}
      <iframe
        bind:this={iframeEl}
        class="w-full h-full border-0"
        src={appUrl}
        sandbox="allow-scripts allow-same-origin"
        title="App"
      ></iframe>
    {/if}
  </div>
</div>
