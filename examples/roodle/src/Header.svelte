<script lang="ts">
  import type { Rool, ReactiveSpace } from '@rool-dev/svelte';
  import Icon from '@iconify/svelte';

  interface Props {
    rool: Rool;
    currentSpace: ReactiveSpace | null;
    eventTitle: string | null;
  }

  let { rool, currentSpace, eventTitle }: Props = $props();

  let showCopied = $state(false);

  async function copyShareLink() {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    showCopied = true;
    setTimeout(() => { showCopied = false; }, 2000);
  }
</script>

<header class="bg-white border-b border-slate-200 px-4 py-3">
  <div class="max-w-4xl mx-auto flex items-center gap-3">
    <!-- Logo + name -->
    <div class="flex items-center gap-2 shrink-0">
      <div class="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
        <Icon icon="mdi:calendar-clock" class="w-4 h-4 text-white" />
      </div>
      <span class="font-semibold text-slate-800 hidden sm:block">Roodle</span>
    </div>

    <!-- Event title (center) -->
    <div class="flex-1 min-w-0">
      {#if eventTitle}
        <span class="text-sm font-medium text-slate-700 truncate block">{eventTitle}</span>
      {/if}
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2 shrink-0">
      {#if currentSpace}
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
          onclick={copyShareLink}
        >
          {#if showCopied}
            <Icon icon="mdi:check" class="w-4 h-4" />
            <span class="hidden sm:inline">Copied!</span>
          {:else}
            <Icon icon="mdi:share-variant" class="w-4 h-4" />
            <span class="hidden sm:inline">Share</span>
          {/if}
        </button>
      {/if}

      {#if rool.authenticated}
        <button
          class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          onclick={() => rool.logout()}
          aria-label="Sign out"
          title="Sign out"
        >
          <Icon icon="mdi:logout" class="w-5 h-5" />
        </button>
      {/if}
    </div>
  </div>
</header>
