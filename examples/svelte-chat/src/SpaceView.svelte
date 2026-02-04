<script lang="ts">
  import { generateId, type SpaceHandle } from '@rool-dev/svelte';

  interface Props {
    space: SpaceHandle;
    onClose: () => void;
  }

  let { space, onClose }: Props = $props();

  // Local state
  let promptText = $state('');
  let sending = $state(false);

  function selectConversation(id: string) {
    space.setConversationId(id);
  }

  async function newConversation() {
    const id = generateId();
    await space.renameConversation(id, 'New Chat');
    space.setConversationId(id);
  }

  async function sendPrompt() {
    if (!promptText.trim() || sending) return;

    const text = promptText.trim();
    promptText = '';
    sending = true;

    try {
      await space.prompt(text);
    } catch (err) {
      console.error('Prompt failed:', err);
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }
</script>

<div class="card">
  <div class="header">
    <h2>{space.info.name}</h2>
    <button onclick={onClose}>← Back</button>
  </div>

  <!-- Conversation Selector -->
  <div class="sidebar">
    {#if space.conversationsLoading}
      <span class="loading">Loading...</span>
    {:else if space.conversations && space.conversations.length > 0}
      {#each space.conversations as conv}
        <button
          style={conv.id === space.conversationId ? 'background: #1e40af' : ''}
          onclick={() => selectConversation(conv.id)}
        >
          {conv.name ?? 'Untitled'}
        </button>
      {/each}
    {/if}
    <button onclick={newConversation}>+ New</button>
  </div>

  <!-- Messages -->
  <div class="messages">
    {#if space.interactions.length === 0}
      <p class="loading">No messages yet. Start a conversation!</p>
    {:else}
      {#each space.interactions as interaction}
        <div class="message user">
          <div class="message-meta">You · {interaction.operation}</div>
          <div>{interaction.input}</div>
        </div>
        {#if interaction.output}
          <div class="message assistant">
            <div class="message-meta">Assistant</div>
            <div>{interaction.output}</div>
          </div>
        {:else}
          <div class="message assistant">
            <div class="loading">Thinking...</div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Input -->
  <div class="input-row">
    <textarea
      rows="2"
      placeholder="Type a message..."
      bind:value={promptText}
      onkeydown={handleKeydown}
      disabled={sending}
    ></textarea>
    <button onclick={sendPrompt} disabled={!promptText.trim() || sending}>
      {sending ? '...' : 'Send'}
    </button>
  </div>
</div>
