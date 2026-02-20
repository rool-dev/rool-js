<script lang="ts">
  import type { ReactiveSpace } from '@rool-dev/svelte';

  interface Props {
    appName: string;
    space: ReactiveSpace | null;
    onLogout: () => void;
  }

  let { appName, space, onLogout }: Props = $props();
</script>

<header class="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
  <h1 class="text-lg font-semibold text-gray-900">{appName}</h1>
  <div class="flex items-center gap-3">
    {#if space}
      <span class="text-sm text-gray-500 hidden sm:inline">{space.name}</span>
    {/if}
    <button
      class="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
      onclick={onLogout}
    >
      Sign out
    </button>
  </div>
</header>
