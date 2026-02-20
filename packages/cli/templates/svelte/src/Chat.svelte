<script lang="ts">
  import type { ReactiveSpace } from '@rool-dev/svelte';

  interface Props {
    space: ReactiveSpace;
  }

  let { space }: Props = $props();

  let input = $state('');
  let isSending = $state(false);
  let messagesEl: HTMLElement | null = $state(null);

  let interactions = $derived(space.interactions);

  // Auto-scroll on new messages
  $effect(() => {
    if (interactions.length > 0 && messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  async function send() {
    if (!input.trim() || isSending) return;

    const text = input.trim();
    input = '';
    isSending = true;

    try {
      await space.checkpoint();
      await space.prompt(text);
    } finally {
      isSending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="w-full shrink-0 snap-start md:flex-1 md:shrink md:snap-align-none flex flex-col min-w-0">
  <div class="flex-1 overflow-y-auto p-4 space-y-4" bind:this={messagesEl}>
    {#if interactions.length === 0}
      <div class="text-center py-16 text-gray-500">
        <p class="text-lg mb-2">Welcome!</p>
        <p class="text-sm">Ask the AI to create objects, answer questions, or help with tasks.</p>
      </div>
    {:else}
      {#each interactions as msg (msg.id)}
        <div class="flex justify-end">
          <div class="max-w-[75%] bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2">
            <p class="text-sm whitespace-pre-wrap">{msg.input}</p>
          </div>
        </div>
        <div class="flex justify-start">
          <div class="max-w-[75%] bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-2 shadow-sm">
            {#if msg.output}
              <p class="text-sm text-gray-700 whitespace-pre-wrap">{msg.output}</p>
            {:else}
              <p class="text-sm text-gray-400 italic">Thinking...</p>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="border-t border-gray-200 bg-white p-4">
    <div class="flex gap-2">
      <textarea
        class="flex-1 px-4 py-2 border border-gray-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] max-h-32"
        placeholder="Type a message..."
        rows="1"
        bind:value={input}
        onkeydown={handleKeydown}
        disabled={isSending}
      ></textarea>
      <button
        class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50"
        onclick={send}
        disabled={isSending || !input.trim()}
      >
        {isSending ? '...' : 'Send'}
      </button>
    </div>
  </div>
</div>
