<script lang="ts">
  import { createRool, type ReactiveSpace } from '@rool-dev/svelte';
  import Splash from './Splash.svelte';
  import Header from './Header.svelte';
  import Chat from './Chat.svelte';
  import Objects from './Objects.svelte';

  const APP_NAME = 'Rool App';

  const rool = createRool();
  rool.init();

  let space = $state<ReactiveSpace | null>(null);

  // Open space when ready
  $effect(() => {
    if (rool.authenticated && rool.spaces && !space) {
      openSpace();
    }
  });

  async function openSpace() {
    const spaces = rool.spaces!;
    const existing = spaces.find(s => s.name === APP_NAME);

    space = existing
      ? await rool.openSpace(existing.id, { conversationId: 'main' })
      : await rool.createSpace(APP_NAME, { conversationId: 'main' });
  }
</script>

{#if rool.authenticated === undefined}
  <div class="min-h-dvh flex items-center justify-center bg-gray-50">
    <p class="text-gray-500">Loading...</p>
  </div>
{:else if rool.authenticated === false}
  <Splash appName={APP_NAME} onLogin={() => rool.login(APP_NAME)} />
{:else}
  <div class="min-h-dvh flex flex-col bg-gray-50">
    <Header appName={APP_NAME} {space} onLogout={() => rool.logout()} />

    {#if !space}
      <div class="flex-1 flex items-center justify-center">
        <p class="text-gray-500">Loading space...</p>
      </div>
    {:else}
      <!-- Mobile: horizontal swipe with scroll-snap. Desktop: side-by-side -->
      <div class="flex-1 flex overflow-x-auto snap-x snap-mandatory md:overflow-visible min-h-0">
        <Chat {space} />
        <Objects {space} />
      </div>
    {/if}
  </div>
{/if}
