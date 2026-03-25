<script lang="ts">
  import type { ReactiveChannel, ReactiveWatch } from '@rool-dev/extension';
  import Icon from '@iconify/svelte';
  import TopicSidebar from './TopicSidebar.svelte';
  import MessageFeed from './MessageFeed.svelte';
  import MessageInput from './MessageInput.svelte';

  interface Props {
    channel: ReactiveChannel;
  }

  let { channel }: Props = $props();

  // ---------------------------------------------------------------------------
  // Huddles (topics)
  // ---------------------------------------------------------------------------

  const huddles = channel.watch({ collection: 'huddle' });

  let activeHuddleId = $state<string | null>(null);
  let activeHuddle = $derived(huddles.objects.find((h) => h.id === activeHuddleId));
  let sidebarOpen = $state(false);

  // ---------------------------------------------------------------------------
  // Messages for the active huddle
  // ---------------------------------------------------------------------------

  let messagesWatch: ReactiveWatch | null = $state(null);

  $effect(() => {
    const id = activeHuddleId;
    if (!id) {
      messagesWatch = null;
      return;
    }
    const w = channel.watch({ collection: 'huddle_message', where: { huddle: id } });
    messagesWatch = w;
    return () => w.close();
  });

  // ---------------------------------------------------------------------------
  // Sending messages
  // ---------------------------------------------------------------------------

  let isSending = $state(false);

  async function handleSend(text: string) {
    if (!activeHuddleId || isSending) return;

    const isRool = text.trimStart().startsWith('@rool');
    const senderName = channel.user.name ?? channel.userId;

    // Create the user's message
    await channel.createObject({
      data: {
        huddle: activeHuddleId,
        text: text,
        sender: channel.userId,
        senderName,
        timestamp: Date.now(),
        fromAgent: false,
      },
    });

    // If @rool, invoke the agent
    if (isRool) {
      isSending = true;
      try {
        const prompt = text.replace(/^\s*@rool\s*/i, '').trim() || 'Help';
        const messageIds = messagesWatch?.objects.map((m) => m.id) ?? [];
        const { message } = await channel.prompt(prompt, {
          objectIds: [activeHuddleId, ...messageIds],
          ephemeral: true,
        });

        // Create the agent response as a message
        await channel.createObject({
          data: {
            huddle: activeHuddleId,
            text: message,
            sender: 'agent',
            senderName: 'Rool',
            timestamp: Date.now(),
            fromAgent: true,
          },
        });
      } catch (err) {
        // Create an error message so the user sees what happened
        await channel.createObject({
          data: {
            huddle: activeHuddleId,
            text: `Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`,
            sender: 'agent',
            senderName: 'Rool',
            timestamp: Date.now(),
            fromAgent: true,
          },
        });
      } finally {
        isSending = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Delete huddle (cascade messages)
  // ---------------------------------------------------------------------------

  async function deleteHuddle(huddleId: string) {
    const messageIds = messagesWatch && activeHuddleId === huddleId
      ? messagesWatch.objects.map((m) => m.id)
      : [];

    // If deleting a different huddle, fetch its messages
    let idsToDelete = [huddleId, ...messageIds];
    if (activeHuddleId !== huddleId) {
      const { objects } = await channel.findObjects({
        collection: 'huddle_message',
        where: { huddle: huddleId },
        ephemeral: true,
      });
      idsToDelete = [huddleId, ...objects.map((m) => m.id)];
    }

    if (activeHuddleId === huddleId) {
      activeHuddleId = null;
    }
    await channel.deleteObjects(idsToDelete);
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
    w-64 bg-white border-r border-slate-200 flex flex-col shrink-0
    fixed inset-y-0 left-0 z-20 transition-transform duration-200
    md:relative md:translate-x-0
    {sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
  ">
    <TopicSidebar
      {channel}
      {huddles}
      {activeHuddleId}
      onselect={(id) => activeHuddleId = id}
      oncreate={() => {}}
      ondelete={deleteHuddle}
      onclose={() => sidebarOpen = false}
    />
  </div>

  <!-- Main area -->
  <div class="flex-1 flex flex-col min-h-0 relative bg-slate-50">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-white">
      <button
        class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
        onclick={() => sidebarOpen = true}
        aria-label="Open sidebar"
      >
        <Icon icon="mdi:menu" class="w-5 h-5" />
      </button>
      {#if activeHuddle}
        <Icon icon="mdi:pound" class="w-4 h-4 text-slate-400" />
        <span class="font-semibold text-slate-700 text-sm">{activeHuddle.name}</span>
        {#if activeHuddle.description}
          <span class="text-xs text-slate-400 hidden sm:inline">&mdash; {activeHuddle.description}</span>
        {/if}
      {:else}
        <span class="text-sm text-slate-400">Select a huddle</span>
      {/if}
    </div>

    {#if activeHuddleId && messagesWatch}
      <MessageFeed
        messages={messagesWatch}
        currentUserId={channel.userId}
        huddleName={activeHuddle?.name as string ?? ''}
        {isSending}
      />
      <MessageInput
        disabled={isSending}
        onsend={handleSend}
      />
    {:else}
      <!-- No huddle selected -->
      <div class="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div class="w-20 h-20 bg-teal-100 rounded-2xl flex items-center justify-center mb-6">
          <Icon icon="mdi:account-group-outline" class="w-10 h-10 text-teal-500" />
        </div>
        <h2 class="text-xl font-semibold text-slate-700 mb-2">Huddle</h2>
        <p class="text-slate-500 text-sm max-w-xs">
          Create a huddle to start chatting with your team. Type <code class="bg-slate-100 px-1 rounded text-teal-600">@rool</code> in any huddle to bring AI into the conversation.
        </p>
      </div>
    {/if}
  </div>
</div>
