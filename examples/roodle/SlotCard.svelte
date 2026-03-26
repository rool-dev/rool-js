<script lang="ts">
  import type { RoolObject } from '@rool-dev/extension';
  import Icon from '@iconify/svelte';

  interface Slot extends RoolObject {
    type: 'slot';
    datetime: string;
    yes?: string[];
    chosen?: boolean;
  }

  interface Props {
    slot: Slot;
    isOrganizer: boolean;
    onConfirm: () => void;
    onReject: () => void;
    onFinalize?: () => void;
    onReopen?: () => void;
    disabled: boolean;
  }

  let { slot, isOrganizer, onConfirm, onReject, onFinalize, onReopen, disabled }: Props = $props();

  function formatDate(datetime: string): string {
    const date = new Date(datetime);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatTime(datetime: string): string {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
</script>

{#if slot.chosen}
  <!-- Chosen slot -->
  <div class="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/40 dark:to-green-950/40 border-2 border-emerald-400 dark:border-emerald-600 rounded-xl p-2 sm:p-4 shadow-md">
    <div class="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400 mb-1 sm:mb-2">
      <Icon icon="mdi:check-circle" class="w-4 h-4 sm:w-5 sm:h-5" />
      <span class="text-xs font-semibold uppercase tracking-wider">Confirmed</span>
    </div>

    <div class="text-center mb-1 sm:mb-3">
      <div class="text-base sm:text-xl font-bold text-emerald-800 dark:text-emerald-200">{formatDate(slot.datetime)}</div>
      <div class="text-xs sm:text-sm font-medium text-emerald-600 dark:text-emerald-400">{formatTime(slot.datetime)}</div>
    </div>

    {#if slot.yes?.length}
      <div class="text-center text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 mb-1 sm:mb-3">
        {slot.yes.length} {slot.yes.length === 1 ? 'attendee' : 'attendees'}
      </div>
    {/if}

    {#if isOrganizer && onReopen}
      <button
        class="w-full px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500 cursor-not-allowed' : 'bg-white/60 dark:bg-neutral-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-white/80 dark:hover:bg-neutral-800/80 border border-emerald-200 dark:border-emerald-700'}"
        onclick={onReopen}
        {disabled}
      >
        Reopen
      </button>
    {/if}
  </div>
{:else}
  <!-- Regular slot -->
  <div class="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-xl p-2 sm:p-4 shadow-sm hover:shadow-md transition-shadow">
    <div class="text-center mb-2 sm:mb-3">
      <div class="text-sm sm:text-lg font-semibold text-slate-800 dark:text-neutral-100">{formatDate(slot.datetime)}</div>
      <div class="text-xs sm:text-sm text-slate-500 dark:text-neutral-400">{formatTime(slot.datetime)}</div>
    </div>

    <div class="flex gap-1.5 sm:gap-2 justify-center">
      <button
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500 cursor-not-allowed' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'}"
        onclick={onConfirm}
        {disabled}
        title="I can make this time"
      >
        <Icon icon="mdi:check" class="w-4 h-4" />
        {#if slot.yes?.length}
          <span class="font-semibold">{slot.yes.length}</span>
        {:else}
          <span class="hidden sm:inline">Works</span>
        {/if}
      </button>
      <button
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500 cursor-not-allowed' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50'}"
        onclick={onReject}
        {disabled}
        title="I can't make this time"
      >
        <Icon icon="mdi:close" class="w-4 h-4" />
        <span class="hidden sm:inline">Can't</span>
      </button>
    </div>

    {#if isOrganizer && onFinalize}
      <button
        class="w-full mt-2 sm:mt-3 px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1
          {disabled ? 'bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400'}"
        onclick={onFinalize}
        {disabled}
      >
        <Icon icon="mdi:crown" class="w-4 h-4 sm:hidden" />
        <span class="hidden sm:inline">Choose this time</span>
        <span class="sm:hidden">Choose</span>
      </button>
    {/if}
  </div>
{/if}
