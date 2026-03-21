<script lang="ts">
  import type { ReactiveAppChannel, ReactiveAppConversationHandle } from '@rool-dev/app';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import Icon from '@iconify/svelte';
  import EffortSelector, { type PromptEffort } from './EffortSelector.svelte';

  interface Props {
    channel: ReactiveAppChannel;
  }

  let { channel }: Props = $props();

  // ---------------------------------------------------------------------------
  // Conversation management
  // ---------------------------------------------------------------------------

  let activeId = $state('default');
  let activeHandle: ReactiveAppConversationHandle | null = $state(null);
  let sidebarOpen = $state(false);

  // Create/cleanup reactive conversation handle when active ID changes
  $effect(() => {
    const handle = channel.conversation(activeId);
    activeHandle = handle;
    return () => handle.close();
  });

  let currentInteractions = $derived(activeHandle?.interactions ?? []);

  function displayName(conv: { id: string; name: string | null }): string {
    return conv.name || (conv.id === 'default' ? 'Chat' : 'Untitled');
  }

  function newChat() {
    activeId = Math.random().toString(36).slice(2, 8);
    sidebarOpen = false;
  }

  function selectConversation(id: string) {
    activeId = id;
    sidebarOpen = false;
  }

  async function deleteConversation(id: string) {
    await channel.deleteConversation(id);
    if (activeId === id) activeId = 'default';
  }

  // Inline rename
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  function startRename(id: string, name: string | null) {
    editingId = id;
    editingName = name ?? '';
  }

  async function commitRename() {
    if (!editingId) return;
    const name = editingName.trim();
    if (name) {
      if (editingId === activeId && activeHandle) {
        await activeHandle.rename(name);
      } else {
        const h = channel.conversation(editingId);
        await h.rename(name);
        h.close();
      }
    }
    editingId = null;
  }

  function autofocus(el: HTMLElement) {
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  let isSending = $state(false);
  let messageInput = $state('');
  let effort = $state<PromptEffort>('STANDARD');
  let messagesContainer: HTMLElement | undefined = $state();
  let inputElement: HTMLTextAreaElement | undefined = $state();

  function resizeTextarea() {
    if (!inputElement) return;
    inputElement.style.height = 'auto';
    inputElement.style.height = Math.min(inputElement.scrollHeight, 250) + 'px';
  }

  // Auto-scroll to bottom on new messages
  $effect(() => {
    if (currentInteractions.length > 0 && messagesContainer) {
      setTimeout(() => {
        messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
      }, 0);
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function sendMessage() {
    if (!messageInput.trim() || isSending || !activeHandle) return;

    const text = messageInput.trim();
    messageInput = '';
    resizeTextarea();
    isSending = true;

    try {
      const effortOption = effort === 'STANDARD' ? undefined : effort;
      await activeHandle.prompt(text, { effort: effortOption });
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      isSending = false;
    }
  }
</script>

<div class="h-full flex overflow-hidden">
  <!-- Mobile backdrop -->
  {#if sidebarOpen}
    <button
      class="fixed inset-0 bg-black/20 z-10 md:hidden"
      onclick={() => sidebarOpen = false}
      aria-label="Close sidebar"
    ></button>
  {/if}

  <!-- Sidebar -->
  <div class="
    w-72 bg-white border-r border-slate-200 flex flex-col shrink-0
    fixed inset-y-0 left-0 z-20 transition-transform duration-200
    md:relative md:translate-x-0
    {sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
  ">
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <span class="font-semibold text-slate-700 text-sm">Conversations</span>
      <button
        class="p-1 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-slate-100 transition-colors"
        onclick={newChat}
        title="New conversation"
      >
        <Icon icon="mdi:plus" class="w-5 h-5" />
      </button>
    </div>

    <div class="flex-1 overflow-auto py-1">
      {#each channel.conversations as conv (conv.id)}
        <div
          class="group flex items-center gap-1 mx-2 my-0.5 px-3 py-2 rounded-lg cursor-pointer transition-colors
            {activeId === conv.id
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-600 hover:bg-slate-50'}"
        >
          {#if editingId === conv.id}
            <input
              class="flex-1 text-sm bg-white border border-indigo-300 rounded px-2 py-0.5 outline-none min-w-0"
              bind:value={editingName}
              onkeydown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { editingId = null; }
              }}
              onblur={commitRename}
              use:autofocus
            />
          {:else}
            <button
              class="flex-1 text-left text-sm truncate min-w-0"
              onclick={() => selectConversation(conv.id)}
              ondblclick={() => startRename(conv.id, conv.name)}
            >
              {displayName(conv)}
            </button>
            {#if conv.id !== 'default'}
              <button
                class="p-0.5 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all shrink-0"
                onclick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                title="Delete conversation"
              >
                <Icon icon="mdi:close" class="w-3.5 h-3.5" />
              </button>
            {/if}
          {/if}
        </div>
      {:else}
        <p class="px-4 py-8 text-sm text-slate-400 text-center">No conversations yet</p>
      {/each}
    </div>
  </div>

  <!-- Main chat area -->
  <div class="flex-1 flex flex-col min-h-0 relative bg-slate-50">
    <!-- Mobile menu button -->
    <button
      class="absolute top-3 left-3 z-10 p-1.5 rounded-lg bg-white/80 backdrop-blur border border-slate-200 text-slate-500 hover:text-slate-700 md:hidden"
      onclick={() => sidebarOpen = true}
      aria-label="Open sidebar"
    >
      <Icon icon="mdi:menu" class="w-5 h-5" />
    </button>

    <!-- Messages -->
    <div class="flex-1 overflow-auto min-h-0 p-4 pb-24 space-y-4" bind:this={messagesContainer}>
      {#if currentInteractions.length === 0}
        <div class="flex-1 flex flex-col items-center justify-center h-full text-center">
          <div class="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6">
            <Icon icon="mdi:chat-outline" class="w-8 h-8 text-indigo-500" />
          </div>
          <h3 class="text-lg font-semibold text-slate-700 mb-2">Start a conversation</h3>
          <p class="text-slate-500 text-sm">Send a message to begin chatting</p>
        </div>
      {:else}
        {#each currentInteractions as interaction}
          <!-- User message -->
          <div class="flex justify-end">
            <div class="max-w-[80%] bg-indigo-500 text-white rounded-2xl rounded-br-md px-4 py-2">
              <p class="text-sm whitespace-pre-wrap">{interaction.input}</p>
            </div>
          </div>

          <!-- Assistant response -->
          {#if interaction.output}
            <div class="markdown-output text-sm text-slate-700">
              <SvelteMarkdown source={interaction.output} />
            </div>
          {:else}
            <!-- Loading state -->
            <div class="text-slate-400">
              {#if interaction.toolCalls && interaction.toolCalls.length > 0}
                <div class="space-y-1">
                  {#each interaction.toolCalls as toolCall}
                    <div class="flex items-center gap-2 text-sm text-slate-500">
                      <Icon icon="mdi:chevron-right" class="w-4 h-4 text-indigo-500" />
                      <span class="font-mono text-xs">{toolCall.name}</span>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="flex items-center gap-2">
                  <Icon icon="mdi:loading" class="w-4 h-4 animate-spin" />
                  <span class="text-sm">Thinking...</span>
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    <!-- Input area -->
    <div class="absolute bottom-0 left-0 right-0 p-4">
      <div class="flex items-end gap-1 bg-white rounded-3xl px-2 py-2 border border-slate-200 shadow-sm focus-within:border-indigo-400 transition-colors">
        <EffortSelector bind:value={effort} />
        <textarea
          bind:this={inputElement}
          class="flex-1 bg-transparent outline-none placeholder:text-slate-400 resize-none overflow-y-auto leading-6 py-1 input-scrollbar"
          placeholder="Type a message..."
          rows="1"
          bind:value={messageInput}
          onkeydown={handleKeydown}
          oninput={resizeTextarea}
          disabled={isSending}
        ></textarea>
        <button
          class="p-1.5 rounded-full text-slate-500 hover:text-indigo-500 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-colors"
          onclick={sendMessage}
          disabled={isSending || !messageInput.trim()}
          aria-label="Send message"
        >
          {#if isSending}
            <Icon icon="mdi:loading" class="w-5 h-5 animate-spin" />
          {:else}
            <Icon icon="mdi:arrow-up" class="w-5 h-5" />
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  @reference "tailwindcss";

  .markdown-output :global(p) {
    @apply leading-relaxed my-2;
  }

  .markdown-output :global(p:first-child) {
    @apply mt-0;
  }

  .markdown-output :global(p:last-child) {
    @apply mb-0;
  }

  .markdown-output :global(code) {
    @apply bg-slate-100 text-indigo-600 px-1.5 py-0.5 rounded text-sm font-mono;
  }

  .markdown-output :global(pre) {
    @apply bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto my-3 text-sm;
  }

  .markdown-output :global(pre code) {
    @apply bg-transparent text-inherit p-0;
  }

  .markdown-output :global(ul),
  .markdown-output :global(ol) {
    @apply my-2 pl-5;
  }

  .markdown-output :global(li) {
    @apply my-1;
  }

  .markdown-output :global(a) {
    @apply text-indigo-600 hover:text-indigo-500 underline;
  }

  .markdown-output :global(blockquote) {
    @apply border-l-4 border-indigo-500 pl-4 my-3 text-slate-500 italic;
  }

  .markdown-output :global(h1),
  .markdown-output :global(h2),
  .markdown-output :global(h3) {
    @apply text-slate-800 font-semibold mt-4 mb-2;
  }

  .markdown-output :global(table) {
    @apply border-collapse my-3 text-sm;
  }

  .markdown-output :global(th),
  .markdown-output :global(td) {
    @apply border border-slate-200 px-3 py-2 text-left;
  }

  .markdown-output :global(th) {
    @apply bg-slate-50 font-semibold;
  }

  .input-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: #cbd5e1 transparent;
  }

  .input-scrollbar::-webkit-scrollbar {
    width: 4px;
  }

  .input-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .input-scrollbar::-webkit-scrollbar-thumb {
    background-color: #cbd5e1;
    border-radius: 2px;
  }
</style>
