<script lang="ts">
  import type { RoolObject } from '@rool-dev/svelte';
  import Icon from '@iconify/svelte';

  interface Slot extends RoolObject {
    type: 'slot';
    datetime: string; // ISO 8601 format with timezone
    yes?: string[]; // array of user names who can make it
    chosen?: boolean; // true if this slot was finalized
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
  <!-- Chosen slot - celebration style -->
  <div class="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-400 rounded-xl p-4 shadow-md">
    <!-- Confirmed badge -->
    <div class="flex items-center justify-center gap-1 text-emerald-600 mb-2">
      <Icon icon="mdi:check-circle" class="w-5 h-5" />
      <span class="text-xs font-semibold uppercase tracking-wider">Confirmed</span>
    </div>

    <!-- Date & Time -->
    <div class="text-center mb-3">
      <div class="text-xl font-bold text-emerald-800">{formatDate(slot.datetime)}</div>
      <div class="text-sm font-medium text-emerald-600">{formatTime(slot.datetime)}</div>
    </div>

    <!-- Attendees -->
    {#if slot.yes?.length}
      <div class="text-center text-sm text-emerald-700 mb-3">
        {slot.yes.length} {slot.yes.length === 1 ? 'attendee' : 'attendees'}
      </div>
    {/if}

    <!-- Reopen button (organizer only) -->
    {#if isOrganizer && onReopen}
      <button
        class="w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white/60 text-emerald-700 hover:bg-white/80 border border-emerald-200'}"
        onclick={onReopen}
        {disabled}
      >
        Reopen discussion
      </button>
    {/if}
  </div>
{:else}
  <!-- Regular slot card -->
  <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
    <!-- Date & Time -->
    <div class="text-center mb-3">
      <div class="text-lg font-semibold text-slate-800">{formatDate(slot.datetime)}</div>
      <div class="text-sm text-slate-500">{formatTime(slot.datetime)}</div>
    </div>

    <!-- Action buttons -->
    <div class="flex gap-2 justify-center">
      <button
        class="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}"
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
        class="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-red-50 text-red-700 hover:bg-red-100'}"
        onclick={onReject}
        {disabled}
        title="I can't make this time"
      >
        <Icon icon="mdi:close" class="w-4 h-4" />
        <span class="hidden sm:inline">Can't</span>
      </button>
    </div>

    <!-- Organizer finalize button -->
    {#if isOrganizer && onFinalize}
      <button
        class="w-full mt-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors
          {disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400'}"
        onclick={onFinalize}
        {disabled}
      >
        Choose this time
      </button>
    {/if}
  </div>
{/if}
