<script lang="ts">
  import { createRool, generateId, type ReactiveChannel, type ReactiveChannelList, type ChannelInfo } from '@rool-dev/svelte';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import Icon from '@iconify/svelte';
  import Header from './Header.svelte';
  import Footer from './Footer.svelte';
  import EffortSelector, { type PromptEffort } from './EffortSelector.svelte';

  const rool = createRool();
  rool.init();

  // State
  let currentSpaceId = $state<string | null>(null);
  let channelList = $state<ReactiveChannelList | null>(null);
  let currentChannel = $state<ReactiveChannel | null>(null);
  let selectedChannelId = $state<string | null>(null);
  let isSending = $state(false);
  let messageInput = $state('');
  let effort = $state<PromptEffort>('STANDARD');
  let messagesContainer: HTMLElement | null = $state(null);
  let inputElement: HTMLTextAreaElement | null = $state(null);
  let editingChannelId = $state<string | null>(null);
  let editingName = $state('');

  function resizeTextarea() {
    if (!inputElement) return;
    inputElement.style.height = 'auto';
    inputElement.style.height = Math.min(inputElement.scrollHeight, 250) + 'px';
  }

  // Derived state
  let channels = $derived(channelList?.list ?? []);
  let currentInteractions = $derived(currentChannel?.interactions ?? []);
  let currentSpaceInfo = $derived(rool.spaces?.find(s => s.id === currentSpaceId));
  let selectedChannel = $derived(channels.find(c => c.id === selectedChannelId));

  // Auto-login if not authenticated
  $effect(() => {
    if (rool.authenticated === false) rool.login('Chat');
  });

  // Auto-scroll to bottom on new messages
  $effect(() => {
    if (currentInteractions.length > 0 && messagesContainer) {
      setTimeout(() => {
        messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
      }, 0);
    }
  });

  function resetState() {
    selectedChannelId = null;
    messageInput = '';
  }

  async function handleSpaceChange(spaceId: string | null) {
    currentChannel?.close();
    currentChannel = null;
    channelList?.close();
    channelList = null;
    currentSpaceId = null;
    resetState();

    if (!spaceId) return;

    currentSpaceId = spaceId;
    channelList = rool.channels(spaceId);
  }

  // Select first channel when space changes and has channels
  $effect(() => {
    if (currentSpaceId && channels.length > 0 && !selectedChannelId) {
      selectChannel(channels[0].id);
    }
  });

  async function selectChannel(channelId: string) {
    if (!currentSpaceId) return;
    currentChannel?.close();
    currentChannel = null;
    selectedChannelId = channelId;
    currentChannel = await rool.openChannel(currentSpaceId, channelId);
  }

  async function createNewChannel() {
    if (!currentSpaceId) return;
    const id = generateId();
    await rool.renameChannel(currentSpaceId, id, 'New Chat');
    await selectChannel(id);
    // Start editing the new channel name
    editingChannelId = id;
    editingName = 'New Chat';
  }

  function startEditing(conv: ChannelInfo, e: MouseEvent) {
    e.stopPropagation();
    editingChannelId = conv.id;
    editingName = conv.name ?? '';
  }

  function cancelEdit() {
    editingChannelId = null;
    editingName = '';
  }

  async function saveEdit() {
    if (!currentSpaceId || !editingChannelId || !editingName.trim()) {
      cancelEdit();
      return;
    }
    await rool.renameChannel(currentSpaceId, editingChannelId, editingName.trim());
    cancelEdit();
  }

  function handleEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  async function deleteChannel(channelId: string, e: MouseEvent) {
    e.stopPropagation();
    if (!currentSpaceId) return;

    await rool.deleteChannel(currentSpaceId, channelId);

    // If we deleted the selected channel, close it
    if (selectedChannelId === channelId) {
      currentChannel?.close();
      currentChannel = null;
      selectedChannelId = null;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // On touch devices (coarse pointer), don't submit on Enter - no easy Shift access
    // On devices with fine pointer (mouse/trackpad), Enter submits (Shift+Enter for newline)
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function sendMessage() {
    if (!currentSpaceId || !messageInput.trim() || isSending) return;

    // Create channel if none selected
    if (!selectedChannelId) {
      await createNewChannel();
    }

    if (!currentChannel) return;

    const text = messageInput.trim();
    messageInput = '';
    resizeTextarea();
    isSending = true;

    try {
      const effortOption = effort === 'STANDARD' ? undefined : effort;
      await currentChannel.prompt(text, { effort: effortOption });
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      isSending = false;
    }
  }
</script>

{#if !rool.authenticated}
  <div class="h-dvh bg-slate-50 flex items-center justify-center">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
      <p class="text-slate-500">Loading...</p>
    </div>
  </div>
{:else}
  <div class="h-dvh bg-slate-50 flex flex-col overflow-hidden">
    <Header {rool} spaceName={currentSpaceInfo?.name ?? null} spaceId={currentSpaceId} onSpaceChange={handleSpaceChange} />

    <main class="flex-1 flex max-w-5xl mx-auto w-full min-h-0">
      {#if currentSpaceId}
        <!-- Sidebar (channels) - hidden on mobile when channel selected -->
        <aside class="hidden md:flex md:w-64 bg-white border-r border-slate-200 p-4 flex-col">
          <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Conversations</h2>
          <div class="flex-1 space-y-1 overflow-y-auto">
            {#if channels.length === 0}
              <p class="text-sm text-slate-400 px-3 py-2">No conversations yet</p>
            {:else}
              {#each channels as conv}
                {#if editingChannelId === conv.id}
                  <div class="flex items-center gap-1 px-2 py-1">
                    <input
                      type="text"
                      class="flex-1 min-w-0 px-2 py-1 text-sm border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      bind:value={editingName}
                      onkeydown={handleEditKeydown}
                      onblur={saveEdit}
                    />
                  </div>
                {:else}
                  <div
                    class="group flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors {selectedChannelId === conv.id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}"
                  >
                    <button
                      class="flex-1 text-left truncate"
                      onclick={() => selectChannel(conv.id)}
                    >
                      {conv.name ?? 'Untitled'}
                    </button>
                    <button
                      class="p-1 opacity-0 group-hover:opacity-100 hover:text-indigo-600 transition-opacity"
                      onclick={(e) => startEditing(conv, e)}
                      aria-label="Rename conversation"
                    >
                      <Icon icon="mdi:pencil" class="w-4 h-4" />
                    </button>
                    <button
                      class="p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                      onclick={(e) => deleteChannel(conv.id, e)}
                      aria-label="Delete conversation"
                    >
                      <Icon icon="mdi:delete-outline" class="w-4 h-4" />
                    </button>
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
          <button
            class="mt-4 w-full px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
            onclick={createNewChannel}
          >
            + New Conversation
          </button>
        </aside>

        <!-- Chat area -->
        <div class="flex-1 flex flex-col min-h-0 relative">
          {#if selectedChannelId}
            <!-- Mobile header with back button -->
            <div class="flex items-center gap-2 p-4 border-b border-slate-200 bg-white md:hidden">
              <button
                class="p-1.5 -ml-1.5 text-slate-500 hover:text-slate-700"
                onclick={() => { currentChannel?.close(); currentChannel = null; selectedChannelId = null; }}
                aria-label="Back to conversations"
              >
                <Icon icon="mdi:chevron-left" class="w-5 h-5" />
              </button>
              <span class="font-medium text-slate-800 truncate">
                {selectedChannel?.name ?? 'Chat'}
              </span>
            </div>

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
          {:else}
            <!-- Mobile: Channel list when none selected -->
            <div class="md:hidden flex-1 flex flex-col p-4">
              <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Conversations</h2>
              <div class="flex-1 space-y-1 overflow-y-auto">
                {#if channels.length === 0}
                  <p class="text-sm text-slate-400 py-2">No conversations yet</p>
                {:else}
                  {#each channels as conv}
                    {#if editingChannelId === conv.id}
                      <div class="flex items-center gap-1 px-2 py-1">
                        <input
                          type="text"
                          class="flex-1 min-w-0 px-2 py-1 text-sm border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          bind:value={editingName}
                          onkeydown={handleEditKeydown}
                          onblur={saveEdit}
                        />
                      </div>
                    {:else}
                      <div class="flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors text-slate-600 hover:bg-slate-100">
                        <button
                          class="flex-1 text-left truncate"
                          onclick={() => selectChannel(conv.id)}
                        >
                          {conv.name ?? 'Untitled'}
                        </button>
                        <button
                          class="p-1 hover:text-indigo-600"
                          onclick={(e) => startEditing(conv, e)}
                          aria-label="Rename conversation"
                        >
                          <Icon icon="mdi:pencil" class="w-4 h-4" />
                        </button>
                        <button
                          class="p-1 hover:text-red-500"
                          onclick={(e) => deleteChannel(conv.id, e)}
                          aria-label="Delete conversation"
                        >
                          <Icon icon="mdi:delete-outline" class="w-4 h-4" />
                        </button>
                      </div>
                    {/if}
                  {/each}
                {/if}
              </div>
              <button
                class="mt-4 w-full px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                onclick={createNewChannel}
              >
                + New Conversation
              </button>
            </div>

            <!-- Desktop: Empty state when no channel selected -->
            <div class="hidden md:flex flex-1 flex-col items-center justify-center text-center">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
                <Icon icon="mdi:chat-outline" class="w-8 h-8 text-slate-400" />
              </div>
              <h2 class="text-lg font-semibold text-slate-700 mb-2">Select a conversation</h2>
              <p class="text-slate-500 text-sm">Choose a conversation from the sidebar or start a new one</p>
            </div>
          {/if}
        </div>
      {:else}
        <!-- No space selected -->
        <div class="flex-1 flex flex-col items-center justify-center text-center p-4">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
            <Icon icon="mdi:folder-open-outline" class="w-8 h-8 text-slate-400" />
          </div>
          <h2 class="text-lg font-semibold text-slate-700 mb-2">No space selected</h2>
          <p class="text-slate-500 text-sm">Choose a space from the dropdown to start chatting</p>
        </div>
      {/if}
    </main>

    <Footer />
  </div>
{/if}

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
