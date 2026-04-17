<script lang="ts">
  import type { DevHostController } from './DevHostController.js';
  import type { RoolSpaceInfo } from '@rool-dev/sdk';
  import type { Manifest, Environment } from '../manifest.js';
  import { ENV_URLS } from '../manifest.js';

  interface Props {
    controller: DevHostController;
    manifest: Manifest | null;
    manifestError: string | null;
    spaces: RoolSpaceInfo[];
    currentSpaceId: string | null;
    env: Environment;
    statusText: string;
    statusState: 'ok' | 'loading' | 'off';
    sidebarCollapsed: boolean;
    colorScheme: 'light' | 'dark';
    uploadState: 'idle' | 'building' | 'uploading' | 'done' | 'error';
    uploadMessage: string | null;
    uploadUrl: string | null;
    dropdownOpen: boolean;
  }

  let {
    controller,
    manifest,
    manifestError,
    spaces,
    currentSpaceId,
    env,
    statusText,
    statusState,
    sidebarCollapsed,
    colorScheme,
    uploadState,
    uploadMessage,
    uploadUrl,
    dropdownOpen = $bindable(),
  }: Props = $props();

  let selectedSpace = $derived(spaces.find((s) => s.id === currentSpaceId));
</script>

{#if sidebarCollapsed}
  <!-- Collapsed sidebar -->
  <div class="w-10 shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-3">
    <button
      class="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
      onclick={() => controller.toggleSidebar()}
      title="Expand sidebar"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    </button>
    <div class="mt-3">
      <span
        class="block w-2 h-2 rounded-full {statusState === 'ok' ? 'bg-green-500' : statusState === 'loading' ? 'bg-amber-500' : 'bg-slate-400'}"
        title={statusText}
      ></span>
    </div>
  </div>
{:else}
  <!-- Expanded sidebar -->
  <div class="w-[280px] shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
    <!-- App identity (hero) -->
    <div class="px-4 pt-4 pb-3 border-b border-slate-100">
      <div class="flex items-start justify-between mb-1">
        {#if manifest}
          <div class="flex items-center gap-2 min-w-0">
            {#if manifest.icon}
              <img src="/{manifest.icon}" alt="" class="w-6 h-6 shrink-0 rounded" />
            {/if}
            <div class="min-w-0">
              <div class="font-semibold text-base text-slate-800 leading-tight">{manifest.name}</div>
              <div class="text-[11px] text-slate-400 font-mono mt-0.5">{manifest.id}</div>
            </div>
          </div>
        {:else}
          <div class="min-w-0">
            <div class="font-semibold text-base text-slate-800 leading-tight">App</div>
          </div>
        {/if}
        <button
          class="p-1 -mr-1 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          onclick={() => controller.toggleSidebar()}
          title="Collapse sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>
      {#if manifest?.description}
        <div class="text-xs text-slate-500 leading-snug mt-1">{manifest.description}</div>
      {/if}
      {#if manifestError && !manifest}
        <div class="text-xs text-red-500 mt-1">{manifestError}</div>
      {/if}
    </div>

    <!-- Collections -->
    {#if manifest?.collections}
      <div class="px-4 py-3 border-b border-slate-100">
        <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Collections</div>
        <div class="space-y-2.5">
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
      </div>
    {/if}

    <!-- System Instruction -->
    {#if manifest?.systemInstruction}
      <div class="px-4 py-3 border-b border-slate-100">
        <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">System Instruction</div>
        <div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2 whitespace-pre-wrap leading-snug max-h-24 overflow-y-auto">{manifest.systemInstruction}</div>
      </div>
    {/if}

    <!-- Manifest warning -->
    {#if manifestError && manifest}
      <div class="px-3 py-2 mx-3 mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md">
        {manifestError}
      </div>
    {/if}

    <!-- Environment -->
    <div class="px-4 py-3 border-b border-slate-100">
      <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Environment</div>
      <div class="flex rounded-md border border-slate-200 overflow-hidden">
        <button
          class="flex-1 py-1.5 text-[11px] font-medium transition-colors border-r border-slate-200 {env === 'local' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}"
          onclick={() => controller.switchEnv('local')}
        >
          Local
        </button>
        <button
          class="flex-1 py-1.5 text-[11px] font-medium transition-colors border-r border-slate-200 {env === 'dev' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}"
          onclick={() => controller.switchEnv('dev')}
        >
          Dev
        </button>
        <button
          class="flex-1 py-1.5 text-[11px] font-medium transition-colors {env === 'prod' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}"
          onclick={() => controller.switchEnv('prod')}
        >
          Prod
        </button>
      </div>
      <div class="text-[10px] text-slate-400 mt-1 font-mono">{ENV_URLS[env].label}</div>
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
                onclick={() => { dropdownOpen = false; controller.selectSpace(space.id); }}
              >
                {space.name}
              </button>
            {:else}
              <div class="px-2.5 py-1.5 text-[13px] text-slate-400">No spaces available</div>
            {/each}
          </div>
        {/if}
      </div>
      <!-- Connection status -->
      <div class="text-[11px] text-slate-400 leading-normal mt-1.5">
        <span
          class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle {statusState === 'ok' ? 'bg-green-500' : statusState === 'loading' ? 'bg-amber-500' : 'bg-slate-400'}"
        ></span>
        {statusText}
      </div>
    </div>

    <!-- Upload -->
    {#if manifest}
      <div class="px-4 py-3 border-b border-slate-100">
        <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Upload</div>
        <button
          class="w-full py-1.5 px-3 text-[12px] font-medium rounded-md transition-colors
            {uploadState === 'building' || uploadState === 'uploading'
              ? 'bg-indigo-100 text-indigo-400 cursor-wait'
              : uploadState === 'done'
                ? 'bg-green-50 text-green-600 border border-green-200'
                : uploadState === 'error'
                  ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                  : 'bg-indigo-500 text-white hover:bg-indigo-600'}"
          onclick={() => controller.upload()}
          disabled={uploadState === 'building' || uploadState === 'uploading'}
        >
          {#if uploadState === 'building'}
            Building...
          {:else if uploadState === 'uploading'}
            Uploading...
          {:else if uploadState === 'done'}
            Uploaded
          {:else if uploadState === 'error'}
            Retry Upload
          {:else}
            Upload to {env}
          {/if}
        </button>
        {#if uploadState === 'done' && uploadUrl}
          <a
            href={uploadUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="block text-[11px] text-indigo-500 hover:text-indigo-600 mt-1.5 truncate"
          >
            {uploadUrl}
          </a>
        {:else if uploadState === 'error' && uploadMessage}
          <div class="text-[11px] text-red-500 mt-1.5">{uploadMessage}</div>
        {/if}
      </div>
    {/if}

    <!-- Footer -->
    <div class="px-4 py-3 mt-auto flex items-center justify-between">
      <a
        href="https://docs.rool.dev/extension/"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[11px] text-slate-400 hover:text-indigo-500 transition-colors"
      >
        Documentation
      </a>
      <button
        class="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
        onclick={() => controller.toggleColorScheme()}
        title={colorScheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        {#if colorScheme === 'light'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        {/if}
      </button>
      <button
        class="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
        onclick={() => controller.logout()}
      >
        Sign out
      </button>
    </div>
  </div>
{/if}
