<script>
  import { rool } from './rool.js';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';

  let currentSpace = $state(null);
  let query = $state('');
  let output = $state('');
  let isLoading = $state(false);
  let readOnly = $state(true);

  const CONVERSATION_ID = 'soft-sql';
  const CONVERSATION_NAME = 'Soft SQL';
  const SYSTEM_INSTRUCTION = `Behave like an intelligent SQL interpreter. Respond with simple markdown tables. Translate the objects in the space to the implied structure in your responses.`;

  async function handleSpaceChange(spaceId) {
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
      const result = await currentSpace.prompt(query.trim(), { readOnly });
      output = result.message ?? '';
    } catch (err) {
      output = `Error: ${err.message}`;
    } finally {
      isLoading = false;
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitQuery();
    }
  }
</script>

{#if !rool.authenticated}
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
    <div class="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 text-center max-w-sm w-full">
      <div class="w-16 h-16 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-xl mx-auto mb-6 flex items-center justify-center shadow-lg">
        <span class="text-2xl font-bold text-white font-mono">&gt;_</span>
      </div>
      <h1 class="text-2xl font-bold text-white mb-2">Soft SQL</h1>
      <p class="text-slate-400 text-sm mb-8">Query your spaces with natural language</p>
      <button
        class="w-full py-3 px-6 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-emerald-400 hover:to-cyan-400 transition-all duration-200 shadow-lg hover:shadow-emerald-500/25"
        onclick={() => rool.login('Soft SQL')}
      >
        Sign in to continue
      </button>
    </div>
  </div>
{:else}
  <div class="min-h-screen bg-slate-50 flex flex-col">
    <!-- Header -->
    <header class="bg-white border-b border-slate-200 px-6 py-4">
      <div class="max-w-5xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-lg flex items-center justify-center">
              <span class="text-xs font-bold text-white font-mono">&gt;_</span>
            </div>
            <span class="font-semibold text-slate-800">Soft SQL</span>
          </div>
          <div class="h-6 w-px bg-slate-200"></div>
          {#if rool.spacesLoading}
            <span class="text-sm text-slate-400">Loading...</span>
          {:else if rool.spacesError}
            <span class="text-sm text-red-500">Failed to load spaces</span>
          {:else}
            <select
              class="px-3 py-1.5 text-sm bg-slate-100 border-0 rounded-lg text-slate-700 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none min-w-[180px] cursor-pointer"
              onchange={(e) => handleSpaceChange(e.target.value || null)}
            >
              <option value="">Select a space...</option>
              {#each rool.spaces ?? [] as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <button
          class="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          onclick={() => rool.logout()}
        >
          Sign out
        </button>
      </div>
    </header>

    <!-- Main content -->
    <main class="flex-1 flex flex-col max-w-5xl mx-auto w-full">
      {#if currentSpace}
        <!-- Query input -->
        <div class="p-6 pb-0">
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
                    <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
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
        <div class="flex-1 p-6 overflow-auto">
          {#if isLoading}
            {@const latestInteraction = currentSpace?.interactions?.at(-1)}
            {#if latestInteraction?.toolCalls?.length > 0}
              <div class="space-y-2">
                {#each latestInteraction.toolCalls as toolCall}
                  <div class="flex items-start gap-2 text-sm">
                    <span class="text-emerald-500 mt-0.5">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                      </svg>
                    </span>
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
                <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span class="text-sm">Processing query...</span>
              </div>
            {/if}
          {:else if output}
            <div class="markdown-output bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <SvelteMarkdown source={output} />
            </div>
          {:else}
            <div class="flex flex-col items-center justify-center h-full text-center py-16">
              <div class="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                <svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3zm0 4h16M9 4v3m6-3v3"></path>
                </svg>
              </div>
              <p class="text-slate-500 text-sm">Results will appear here</p>
              <p class="text-slate-400 text-xs mt-1">Press Enter or click Run Query</p>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex-1 flex flex-col items-center justify-center text-center py-16">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
            <svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>
            </svg>
          </div>
          <h2 class="text-lg font-semibold text-slate-700 mb-2">No space selected</h2>
          <p class="text-slate-500 text-sm">Choose a space from the dropdown to start querying</p>
        </div>
      {/if}
    </main>
  </div>
{/if}

<style>
  @reference "tailwindcss";

  /* Markdown output styling */
  .markdown-output :global(table) {
    @apply border-collapse w-full my-4 text-sm;
  }

  .markdown-output :global(th),
  .markdown-output :global(td) {
    @apply border border-slate-200 px-4 py-2.5 text-left;
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
