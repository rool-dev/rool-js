<script lang="ts">
  import type { ReactiveSpace, ReactiveCollection } from '@rool-dev/svelte';

  interface Props {
    space: ReactiveSpace;
  }

  let { space }: Props = $props();

  let collection = $state<ReactiveCollection | null>(null);

  $effect(() => {
    const c = space.collection({});
    collection = c;
    return () => c.close();
  });

  let objects = $derived(collection?.objects ?? []);
</script>

<!-- Mobile: full width swipe panel. Desktop: side panel -->
<aside class="w-full shrink-0 snap-start md:w-80 md:shrink md:snap-align-none border-l border-gray-200 bg-white flex flex-col">
  <div class="px-4 py-3 border-b border-gray-200">
    <h2 class="font-medium text-gray-700">Objects ({objects.length})</h2>
  </div>
  <div class="flex-1 overflow-y-auto p-4 space-y-3">
    {#if objects.length === 0}
      <p class="text-gray-400 text-sm text-center py-4">
        Objects created by the AI will appear here
      </p>
    {:else}
      {#each objects as obj (obj.id)}
        <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <pre class="text-xs text-gray-600 overflow-auto">{JSON.stringify(obj, null, 2)}</pre>
        </div>
      {/each}
    {/if}
  </div>
</aside>
