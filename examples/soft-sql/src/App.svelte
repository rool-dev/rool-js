<script lang="ts">
  import { createRool, type ReactiveSpace } from '@rool-dev/svelte';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import Icon from '@iconify/svelte';
  import Header from './Header.svelte';
  import Footer from './Footer.svelte';

  const rool = createRool();
  rool.init();

  let currentSpace = $state<ReactiveSpace | null>(null);
  let query = $state('');
  let output = $state('');
  let isLoading = $state(false);
  let readOnly = $state(true);

  const CONVERSATION_ID = 'soft-sql';
  const CONVERSATION_NAME = 'Soft SQL';
  const SYSTEM_INSTRUCTION = `Behave like an intelligent SQL interpreter. Respond with simple markdown tables. Translate the objects in the space to the implied structure in your responses.`;

  // Auto-redirect to login when not authenticated
  $effect(() => {
    if (rool.authenticated === false) {
      rool.login('Soft SQL');
    }
  });

  async function handleSpaceChange(spaceId: string | null) {
    // Close previous space if any
    if (currentSpace) {
      currentSpace.close();
      currentSpace = null;
      output = '';
    }

    if (!spaceId) return;

    // Open the space with a fixed conversation ID
    currentSpace = await rool.openSpace(spaceId, { conversationId: CONVERSATION_ID });

    // Rename the conversation (idempotent - safe to call even if already named)
    await currentSpace.renameConversation(CONVERSATION_ID, CONVERSATION_NAME);

    // Set the system instruction
    await currentSpace.setSystemInstruction(SYSTEM_INSTRUCTION);
  }

  async function submitQuery() {
    if (!currentSpace || !query.trim() || isLoading) return;

    isLoading = true;
    try {
      const result = await currentSpace.prompt(query.trim(), { readOnly, ephemeral: true });
      output = result.message ?? '';
    } catch (err) {
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      isLoading = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitQuery();
    }
  }
</script>

{#if !rool.authenticated}
  <!-- Checking auth state or redirecting to login -->
  <div class="min-h-dvh bg-slate-50 flex items-center justify-center">
    <div class="text-center" role="status" aria-live="polite">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" aria-hidden="true"></div>
      <p class="text-slate-500">Loading...</p>
    </div>
  </div>
{:else}
  <div class="h-dvh bg-slate-50 flex flex-col overflow-hidden">
    <Header {rool} {currentSpace} onSpaceChange={handleSpaceChange} />

    <!-- Main content -->
    <main class="flex-1 flex flex-col max-w-6xl mx-auto w-full min-h-0">
      {#if currentSpace}
        <!-- Query input -->
        <div class="p-2">
          <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <textarea
              class="w-full px-4 py-3 font-mono text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none min-h-[80px]"
              bind:value={query}
              onkeydown={handleKeydown}
              placeholder="SELECT * FROM tasks WHERE status = 'pending'"
              disabled={isLoading}
            ></textarea>
            <div class="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-100">
              <label class="flex items-center gap-2 cursor-pointer select-none group">
                <button
                  type="button"
                  role="switch"
                  aria-checked={readOnly}
                  aria-label="Read-only mode"
                  onclick={() => readOnly = !readOnly}
                  class="relative w-9 h-5 rounded-full transition-colors duration-200 {readOnly ? 'bg-emerald-500' : 'bg-slate-300'}"
                >
                  <span class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 {readOnly ? 'translate-x-4' : 'translate-x-0'}"></span>
                </button>
                <span class="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">Read-only</span>
              </label>
              <button
                class="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-lg hover:from-emerald-400 hover:to-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-emerald-500 disabled:hover:to-cyan-500 transition-all duration-200 shadow-sm"
                onclick={submitQuery}
                disabled={isLoading || !query.trim()}
              >
                {#if isLoading}
                  <span class="flex items-center gap-2">
                    <Icon icon="mdi:loading" class="w-4 h-4 animate-spin" />
                    Running
                  </span>
                {:else}
                  Run Query
                {/if}
              </button>
            </div>
          </div>
        </div>

        <!-- Output -->
        <div class="flex-1 p-2 min-h-0 flex flex-col">
          {#if isLoading}
            {@const latestInteraction = currentSpace?.interactions?.at(-1)}
            <div class="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6">
              {#if (latestInteraction?.toolCalls?.length ?? 0) > 0}
                <div class="space-y-2">
                  {#each latestInteraction?.toolCalls ?? [] as toolCall}
                    <div class="flex items-start gap-2 text-sm">
                      <Icon icon="mdi:chevron-right" class="w-4 h-4 text-emerald-500 mt-0.5" />
                      <div>
                        <span class="font-mono text-slate-700">{toolCall.name}</span>
                        {#if toolCall.result}
                          <p class="text-slate-400 text-xs mt-1 font-mono truncate max-w-md">{toolCall.result}</p>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="flex items-center gap-2 text-slate-400">
                  <Icon icon="mdi:loading" class="w-4 h-4 animate-spin" />
                  <span class="text-sm">Processing query...</span>
                </div>
              {/if}
            </div>
          {:else if output}
            <div class="markdown-output flex-1 bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6 overflow-auto min-h-0">
              <SvelteMarkdown source={output} />
            </div>
          {:else}
            <div class="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center p-4">
              <div class="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                <Icon icon="mdi:table" class="w-6 h-6 text-slate-400" />
              </div>
              <p class="text-slate-500 text-sm">Results will appear here</p>
              <p class="text-slate-400 text-xs mt-1">Press Enter or click Run Query</p>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex-1 flex flex-col items-center justify-center text-center p-4 md:py-16">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
            <Icon icon="mdi:folder-open-outline" class="w-8 h-8 text-slate-400" />
          </div>
          <h2 class="text-lg font-semibold text-slate-700 mb-2">No space selected</h2>
          <p class="text-slate-500 text-sm">Choose a space from the dropdown to start querying</p>
        </div>
      {/if}
    </main>

    <Footer />
  </div>
{/if}

<style>
  @reference "tailwindcss";

  /* Markdown output styling */
  .markdown-output :global(table) {
    @apply border-collapse my-4 text-sm min-w-full;
  }

  .markdown-output :global(th),
  .markdown-output :global(td) {
    @apply border border-slate-200 px-3 md:px-4 py-2 md:py-2.5 text-left;
  }

  .markdown-output :global(th) {
    @apply bg-slate-50 font-semibold text-slate-700 text-xs uppercase tracking-wider;
  }

  .markdown-output :global(td) {
    @apply text-slate-600;
  }

  .markdown-output :global(tr:hover) {
    @apply bg-slate-50/50;
  }

  .markdown-output :global(code) {
    @apply bg-slate-100 text-emerald-600 px-1.5 py-0.5 rounded text-sm font-mono;
  }

  .markdown-output :global(pre) {
    @apply bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto my-4 text-sm;
  }

  .markdown-output :global(pre code) {
    @apply bg-transparent text-inherit p-0;
  }

  .markdown-output :global(p) {
    @apply text-slate-600 leading-relaxed my-3;
  }

  .markdown-output :global(h1),
  .markdown-output :global(h2),
  .markdown-output :global(h3) {
    @apply text-slate-800 font-semibold mt-6 mb-3;
  }

  .markdown-output :global(ul),
  .markdown-output :global(ol) {
    @apply my-3 pl-6 text-slate-600;
  }

  .markdown-output :global(li) {
    @apply my-1;
  }

  .markdown-output :global(a) {
    @apply text-emerald-600 hover:text-emerald-500 underline;
  }

  .markdown-output :global(blockquote) {
    @apply border-l-4 border-emerald-500 pl-4 my-4 text-slate-500 italic;
  }
</style>
