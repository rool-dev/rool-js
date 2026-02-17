<script lang="ts">
  import type { Rool, ReactiveSpace } from '@rool-dev/svelte';
  import Icon from '@iconify/svelte';

  interface Props {
    rool: Rool;
    currentSpace: ReactiveSpace | null;
    onSpaceChange: (spaceId: string) => void;
  }

  let { rool, currentSpace, onSpaceChange }: Props = $props();

  let showNewSpaceForm = $state(false);
  let newSpaceName = $state('');
  let showSpaceDropdown = $state(false);
  let showActionsMenu = $state(false);
  let isCreating = $state(false);

  // URL query param sync
  function getSpaceIdFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('space');
  }

  function updateUrlSpaceId(spaceId: string | null) {
    const url = new URL(window.location.href);
    if (spaceId) {
      url.searchParams.set('space', spaceId);
    } else {
      url.searchParams.delete('space');
    }
    history.replaceState(null, '', url.toString());
  }

  let initialSpaceId = getSpaceIdFromUrl();

  // Auto-open space from URL param once spaces are loaded
  $effect(() => {
    if (initialSpaceId && rool.spaces && !currentSpace) {
      const exists = rool.spaces.some(s => s.id === initialSpaceId);
      if (exists) {
        selectSpace(initialSpaceId);
      } else {
        updateUrlSpaceId(null);
      }
      initialSpaceId = null;
    }
  });

  function selectSpace(spaceId: string) {
    updateUrlSpaceId(spaceId);
    onSpaceChange(spaceId);
  }

  // Close dropdowns on outside click
  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-dropdown]')) {
      showSpaceDropdown = false;
      showActionsMenu = false;
    }
  }

  async function createSpace() {
    if (!newSpaceName.trim() || isCreating) return;
    isCreating = true;
    try {
      const space = await rool.createSpace(newSpaceName.trim());
      newSpaceName = '';
      showNewSpaceForm = false;
      selectSpace(space.id);
    } finally {
      isCreating = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<header class="bg-white border-b border-slate-200 px-4 py-3">
  <div class="max-w-5xl mx-auto flex items-center gap-3">
    <!-- Logo + name (name hidden on mobile) -->
    <div class="flex items-center gap-2 shrink-0">
      <div class="w-8 h-8 bg-linear-to-br from-violet-400 to-purple-500 rounded-lg flex items-center justify-center">
        <Icon icon="mdi:cards-outline" class="w-4 h-4 text-white" />
      </div>
      <span class="font-semibold text-slate-800 hidden sm:block">Flashcards</span>
    </div>

    <!-- Space selector -->
    <div class="flex-1 min-w-0 relative" data-dropdown>
      {#if rool.spacesLoading}
        <span class="text-sm text-slate-400">Loading...</span>
      {:else if rool.spacesError}
        <span class="text-sm text-red-500">Failed to load</span>
      {:else if showNewSpaceForm}
        <div class="flex items-center gap-2">
          <input
            type="text"
            class="flex-1 min-w-0 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:outline-none"
            placeholder="Space name..."
            bind:value={newSpaceName}
            onkeydown={(e) => e.key === 'Enter' && createSpace()}
            disabled={isCreating}
          />
          <button
            class="px-3 py-1.5 text-sm font-medium text-white bg-violet-500 rounded-lg hover:bg-violet-600 disabled:opacity-50 shrink-0"
            onclick={createSpace}
            disabled={isCreating || !newSpaceName.trim()}
          >
            {isCreating ? '...' : 'Create'}
          </button>
          <button
            class="p-1.5 text-slate-400 hover:text-slate-600 shrink-0"
            onclick={() => { showNewSpaceForm = false; newSpaceName = ''; }}
            aria-label="Cancel"
          >
            <Icon icon="mdi:close" class="w-5 h-5" />
          </button>
        </div>
      {:else}
        <button
          class="w-full flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 rounded-lg text-slate-700 hover:bg-slate-200 transition-colors text-left"
          onclick={() => { showSpaceDropdown = !showSpaceDropdown; showActionsMenu = false; }}
        >
          <span class="truncate flex-1 font-medium">
            {currentSpace?.name ?? 'Select a space...'}
          </span>
          <Icon icon="mdi:chevron-down" class="w-4 h-4 shrink-0 text-slate-400" />
        </button>

        <!-- Space dropdown -->
        {#if showSpaceDropdown}
          <div class="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            {#each rool.spaces ?? [] as s}
              <button
                class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 {s.id === currentSpace?.id ? 'bg-violet-50 text-violet-700' : 'text-slate-700'}"
                onclick={() => { selectSpace(s.id); showSpaceDropdown = false; }}
              >
                <span class="truncate flex-1">{s.name}</span>
                {#if s.id === currentSpace?.id}
                  <Icon icon="mdi:check" class="w-4 h-4 shrink-0" />
                {/if}
              </button>
            {/each}
            {#if (rool.spaces ?? []).length === 0}
              <div class="px-3 py-2 text-sm text-slate-400">No spaces yet</div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <!-- Actions menu (vdot) -->
    <div class="relative shrink-0" data-dropdown>
      <button
        class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        onclick={() => { showActionsMenu = !showActionsMenu; showSpaceDropdown = false; }}
        aria-label="Menu"
      >
        <Icon icon="mdi:dots-vertical" class="w-5 h-5" />
      </button>

      {#if showActionsMenu}
        <div class="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-35">
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 text-slate-700"
            onclick={() => { showNewSpaceForm = true; showActionsMenu = false; showSpaceDropdown = false; }}
          >
            <Icon icon="mdi:plus" class="w-4 h-4" />
            New space
          </button>
          <div class="border-t border-slate-100 my-1"></div>
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 text-slate-700"
            onclick={() => { rool.logout(); showActionsMenu = false; }}
          >
            <Icon icon="mdi:logout" class="w-4 h-4" />
            Sign out
          </button>
        </div>
      {/if}
    </div>
  </div>
</header>
