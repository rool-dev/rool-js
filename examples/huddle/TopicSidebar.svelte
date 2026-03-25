<script lang="ts">
  import type { ReactiveChannel, ReactiveWatch, RoolObject } from '@rool-dev/extension';
  import Icon from '@iconify/svelte';

  interface Props {
    channel: ReactiveChannel;
    huddles: ReactiveWatch;
    activeHuddleId: string | null;
    onselect: (id: string) => void;
    oncreate: () => void;
    ondelete: (id: string) => void;
    onclose: () => void;
  }

  let { channel, huddles, activeHuddleId, onselect, oncreate, ondelete, onclose }: Props = $props();

  let newName = $state('');
  let creating = $state(false);

  async function createHuddle() {
    const name = newName.trim();
    if (!name) return;
    creating = true;
    try {
      const { object } = await channel.createObject({ data: { name, description: null } });
      newName = '';
      onselect(object.id);
    } finally {
      creating = false;
    }
  }
</script>

<div class="flex flex-col h-full">
  <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
    <span class="font-semibold text-slate-700 text-sm">Huddles</span>
    <button
      class="p-1 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-slate-100 transition-colors md:hidden"
      onclick={onclose}
      aria-label="Close sidebar"
    >
      <Icon icon="mdi:close" class="w-5 h-5" />
    </button>
  </div>

  <!-- New huddle input -->
  <div class="px-3 py-2 border-b border-slate-100">
    <div class="flex items-center gap-1">
      <input
        class="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-teal-400 min-w-0"
        placeholder="New huddle..."
        bind:value={newName}
        onkeydown={(e) => e.key === 'Enter' && createHuddle()}
        disabled={creating}
      />
      <button
        class="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-slate-100 disabled:opacity-30 transition-colors"
        onclick={createHuddle}
        disabled={!newName.trim() || creating}
        aria-label="Create huddle"
      >
        <Icon icon="mdi:plus" class="w-5 h-5" />
      </button>
    </div>
  </div>

  <!-- Huddle list -->
  <div class="flex-1 overflow-auto py-1">
    {#each huddles.objects as huddle (huddle.id)}
      <div
        class="group flex items-center gap-1 mx-2 my-0.5 px-3 py-2 rounded-lg cursor-pointer transition-colors
          {activeHuddleId === huddle.id
            ? 'bg-teal-50 text-teal-700'
            : 'text-slate-600 hover:bg-slate-50'}"
      >
        <button
          class="flex-1 text-left text-sm truncate min-w-0 flex items-center gap-2"
          onclick={() => { onselect(huddle.id); onclose(); }}
        >
          <Icon icon="mdi:pound" class="w-4 h-4 shrink-0 opacity-50" />
          {huddle.name}
        </button>
        <button
          class="p-0.5 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all shrink-0"
          onclick={(e) => { e.stopPropagation(); ondelete(huddle.id); }}
          title="Delete huddle"
        >
          <Icon icon="mdi:close" class="w-3.5 h-3.5" />
        </button>
      </div>
    {:else}
      <p class="px-4 py-8 text-sm text-slate-400 text-center">
        {huddles.loading ? 'Loading...' : 'No huddles yet. Create one above.'}
      </p>
    {/each}
  </div>
</div>
