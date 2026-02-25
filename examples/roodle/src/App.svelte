<script lang="ts">
  import { createRool, type ReactiveSpace, type ReactiveCollection, type RoolObject } from '@rool-dev/svelte';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import Icon from '@iconify/svelte';
  import { flip } from 'svelte/animate';
  import Header from './Header.svelte';
  import Footer from './Footer.svelte';
  import SlotCard from './SlotCard.svelte';

  const rool = createRool();
  rool.init();

  interface Event extends RoolObject {
    type: 'event';
    title: string;
    description?: string;
    duration: string;
  }

  interface Slot extends RoolObject {
    type: 'slot';
    datetime: string; // ISO 8601 format with timezone
    yes?: string[]; // array of user names who can make it
    chosen?: boolean; // true if this slot was finalized
  }

  const CONVERSATION_ID = 'scheduling';

  // State
  let currentSpace = $state<ReactiveSpace | null>(null);
  let eventCollection = $state<ReactiveCollection | null>(null);
  let slotsCollection = $state<ReactiveCollection | null>(null);
  let messageInput = $state('');
  let isSending = $state(false);
  let isCreatingPlan = $state(false);
  let messagesContainer: HTMLElement | null = $state(null);
  let showDescription = $state(false);

  // Create form state
  let formTitle = $state('');
  let formDescription = $state('');
  let formDuration = $state('1 hour');
  let formDatePrefs = $state('');

  // Derived
  let event = $derived((eventCollection?.objects[0] ?? null) as Event | null);
  let slots = $derived((slotsCollection?.objects ?? []) as Slot[]);
  let isOrganizer = $derived(currentSpace?.role === 'owner');
  let currentInteractions = $derived(currentSpace?.interactions ?? []);
  let sortedSlots = $derived([...slots].sort((a, b) => a.datetime.localeCompare(b.datetime)));
  let userName = $derived(rool.currentUser?.name ?? rool.currentUser?.email ?? 'Anonymous');
  let collectionsLoading = $derived(eventCollection?.loading || slotsCollection?.loading);

  // URL handling
  function getSpaceIdFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('space');
  }

  function setSpaceIdInUrl(spaceId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('space', spaceId);
    history.replaceState(null, '', url.toString());
  }

  // Auto-scroll chat
  $effect(() => {
    if (currentInteractions.length > 0 && messagesContainer) {
      setTimeout(() => {
        messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
      }, 0);
    }
  });

  // Auto-login for all users (space needs to know who they are)
  $effect(() => {
    if (rool.authenticated === false) {
      rool.login('Roodle');
    }
  });

  // Load space from URL on auth
  $effect(() => {
    const spaceId = getSpaceIdFromUrl();
    if (spaceId && rool.authenticated && !currentSpace) {
      openSpace(spaceId);
    }
  });

  // Set system instruction when event is available
  $effect(() => {
    if (currentSpace && event) {
      currentSpace.setSystemInstruction(buildSystemInstruction(event.title, event.description, event.duration));
    }
  });

  function buildSystemInstruction(title: string, description: string | undefined, duration: string): string {
    return `You are helping schedule: ${title}
${description ? `Purpose: ${description}\n` : ''}Duration: ${duration}

Your job is to maintain 4 possible time slots for this event.

The slot objects should have this exact schema:
- type: "slot"
- datetime: ISO 8601 format with timezone (e.g. "2024-03-15T14:00:00-05:00")
- yes: [array of user names]
- chosen: true (only when finalized by organizer)

Do not use links at all in this space

Rules:
- Create time slots as objects with the exact schema
- When participants share constraints, update the slots accordingly. 
- Record the name of users who accepted a slot in the "yes" array
- Remove and add new slots when needed to maintain 4 options
- It options thin out, you are allowed to go below 4 options, but be creative
- Explain your reasoning briefly when making changes
- Don't repeat the actual slot status in the chat, the user sees the slots directly in the UI
- The user can also delete a slot directly, in this case, create a new slot to replace it.

You are allowed to disregard the above rules if asked to do so to resolve scheduling difficulties
`;
  }

  async function openSpace(spaceId: string) {
    // Clean up previous collections
    eventCollection?.close();
    slotsCollection?.close();

    try {
      currentSpace = await rool.openSpace(spaceId, { conversationId: CONVERSATION_ID });
      eventCollection = currentSpace.collection({ where: { type: 'event' }, limit: 1 });
      slotsCollection = currentSpace.collection({ where: { type: 'slot' } });
    } catch (err) {
      console.error('Failed to open space:', err);
      currentSpace = null;
      eventCollection = null;
      slotsCollection = null;
      // Clear URL if space doesn't exist
      const url = new URL(window.location.href);
      url.searchParams.delete('space');
      history.replaceState(null, '', url.toString());
    }
  }

  async function createPlan() {
    if (!formTitle.trim() || isCreatingPlan || !rool.authenticated) return;

    isCreatingPlan = true;
    try {
      // Create space
      const space = await rool.createSpace(formTitle.trim(), { conversationId: CONVERSATION_ID });
      currentSpace = space;

      // Set up reactive collections
      eventCollection = space.collection({ where: { type: 'event' }, limit: 1 });
      slotsCollection = space.collection({ where: { type: 'slot' } });

      // Enable link sharing
      await space.setLinkAccess('editor');

      // Create event object
      await space.createObject({
        data: {
          type: 'event',
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          duration: formDuration
        },
        ephemeral: true
      });

      // Set system instruction
      await space.setSystemInstruction(buildSystemInstruction(formTitle.trim(), formDescription.trim() || undefined, formDuration));

      // Generate initial slots
      const prefs = formDatePrefs.trim();
      await space.prompt(
        prefs ? `Create initial time slots. Date preferences: ${prefs}` : 'Create initial time slots.',
        { ephemeral: true }
      );

      // Update URL
      setSpaceIdInUrl(space.id);
    } catch (err) {
      console.error('Failed to create plan:', err);
    } finally {
      isCreatingPlan = false;
    }
  }

  async function sendMessage() {
    if (!currentSpace || !messageInput.trim() || isSending) return;

    const text = messageInput.trim();
    messageInput = '';
    isSending = true;

    try {
      await currentSpace.prompt(text);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      isSending = false;
    }
  }

  function formatSlotDateTime(datetime: string): string {
    const date = new Date(datetime);
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) +
      ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function formatMessageTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  async function confirmSlot(slot: Slot) {
    if (!currentSpace || isSending) return;
    // Add user to yes array if not already there
    const currentYes = slot.yes ?? [];
    if (currentYes.includes(userName)) return;
    isSending = true;
    try {
      await currentSpace.updateObject(slot.id, {
        data: { yes: [...currentYes, userName] },
        ephemeral: true
      });
    } finally {
      isSending = false;
    }
  }

  async function rejectSlot(slot: Slot) {
    if (!currentSpace || isSending) return;
    isSending = true;
    try {
      // Delete the slot, then ask AI to create a replacement
      await currentSpace.deleteObjects([slot.id]);
      await currentSpace.prompt(
        `I can't make ${formatSlotDateTime(slot.datetime)}. Create a replacement time slot.`,
        { ephemeral: true }
      );
    } finally {
      isSending = false;
    }
  }

  async function finalizeSlot(slot: Slot) {
    if (!currentSpace || isSending || !isOrganizer) return;
    isSending = true;
    try {
      await currentSpace.checkpoint('Finalize event');
      await currentSpace.prompt(`I have chosen ${formatSlotDateTime(slot.datetime)} as the final time. Remove the other options.`);
    } finally {
      isSending = false;
    }
  }

  async function reopenDiscussion() {
    if (!currentSpace || isSending || !isOrganizer) return;
    isSending = true;
    try {
      await currentSpace.checkpoint('Reopen discussion');
      await currentSpace.prompt(`Reopen the discussion. Remove the chosen flag from the current slot and suggest 3 more alternative time slots.`);
    } finally {
      isSending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
</script>

{#if rool.authenticated === null || rool.authenticated === false}
  <!-- Loading auth state or redirecting to login -->
  <div class="h-dvh bg-slate-50 flex items-center justify-center">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto mb-4"></div>
      <p class="text-slate-500">Loading...</p>
    </div>
  </div>
{:else if !currentSpace && !getSpaceIdFromUrl()}
  <!-- Landing page: Create a plan -->
  <div class="h-dvh bg-slate-50 flex flex-col">
    <Header {rool} {currentSpace} eventTitle={null} />

    <main class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Icon icon="mdi:calendar-clock" class="w-8 h-8 text-white" />
          </div>
          <h1 class="text-2xl font-bold text-slate-800 mb-2">Schedule Anything</h1>
          <p class="text-slate-500">with AI-powered collaboration</p>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1" for="title">
              What are you scheduling?
            </label>
            <input
              id="title"
              type="text"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none"
              placeholder="Team offsite, coffee chat, project kickoff..."
              bind:value={formTitle}
              disabled={isCreatingPlan}
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1" for="description">
              Description <span class="text-slate-400">(optional)</span>
            </label>
            <textarea
              id="description"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none resize-none"
              rows="2"
              placeholder="What's the purpose of this event?"
              bind:value={formDescription}
              disabled={isCreatingPlan}
            ></textarea>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1" for="duration">
              Duration
            </label>
            <input
              id="duration"
              type="text"
              list="duration-options"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none"
              placeholder="1 hour"
              bind:value={formDuration}
              disabled={isCreatingPlan}
            />
            <datalist id="duration-options">
              <option value="30 minutes"></option>
              <option value="1 hour"></option>
              <option value="1.5 hours"></option>
              <option value="2 hours"></option>
              <option value="half day"></option>
              <option value="full day"></option>
            </datalist>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1" for="prefs">
              Date preferences <span class="text-slate-400">(optional)</span>
            </label>
            <input
              id="prefs"
              type="text"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none"
              placeholder="Next week, weekday mornings, avoid Fridays..."
              bind:value={formDatePrefs}
              disabled={isCreatingPlan}
            />
          </div>

          <button
            class="w-full py-3 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            onclick={createPlan}
            disabled={!formTitle.trim() || isCreatingPlan}
          >
            {#if isCreatingPlan}
              <span class="flex items-center justify-center gap-2">
                <Icon icon="mdi:loading" class="w-4 h-4 animate-spin" />
                Setting up...
              </span>
            {:else}
              Get Started
            {/if}
          </button>
        </div>
      </div>
    </main>

    <Footer />
  </div>
{:else}
  <!-- Plan view -->
  <div class="h-dvh bg-slate-50 flex flex-col overflow-hidden">
    <Header {rool} {currentSpace} eventTitle={event?.title ?? null} />

    <!-- Connection state banner -->
    {#if rool.connectionState === 'reconnecting'}
      <div class="bg-amber-100 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
        <Icon icon="mdi:wifi-off" class="w-4 h-4 inline-block mr-1" />
        Reconnecting...
      </div>
    {:else if rool.connectionState === 'disconnected'}
      <div class="bg-red-100 border-b border-red-200 px-4 py-2 text-center text-sm text-red-800">
        <Icon icon="mdi:wifi-off" class="w-4 h-4 inline-block mr-1" />
        Disconnected — changes may not sync
      </div>
    {/if}

    <main class="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-0 p-4">
      {#if !currentSpace}
        <!-- Loading space -->
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto mb-4"></div>
            <p class="text-slate-500">Loading plan...</p>
          </div>
        </div>
      {:else}
        <!-- Event info -->
        {#if event}
          <div class="bg-white rounded-xl border border-slate-200 p-2 sm:p-4 mb-2 sm:mb-4 relative">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-sm sm:text-lg font-semibold text-slate-800 truncate">{event.title}</h2>
              <div class="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-slate-500 shrink-0">
                {#if event.description}
                  <button
                    class="sm:hidden p-1 -m-1 text-slate-400 hover:text-slate-600"
                    onclick={() => showDescription = !showDescription}
                    aria-label="Show event details"
                  >
                    <Icon icon="mdi:information-outline" class="w-4 h-4" />
                  </button>
                {/if}
                <span class="flex items-center gap-1">
                  <Icon icon="mdi:clock-outline" class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span class="hidden sm:inline">{event.duration}</span>
                  <span class="sm:hidden">{event.duration.replace(' hour', 'h').replace(' minutes', 'm')}</span>
                </span>
                {#if isOrganizer}
                  <span class="flex items-center gap-1 text-amber-600">
                    <Icon icon="mdi:crown" class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span class="hidden sm:inline">Organizer</span>
                  </span>
                {/if}
              </div>
            </div>
            {#if event.description}
              <p class="hidden sm:block text-sm text-slate-500 mt-1">{event.description}</p>
            {/if}
            <!-- Mobile tooltip -->
            {#if showDescription && event.description}
              <button
                class="sm:hidden fixed inset-0 z-40"
                onclick={() => showDescription = false}
                aria-label="Close tooltip"
              ></button>
              <div class="sm:hidden absolute right-2 top-full mt-1 z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 max-w-64 shadow-lg">
                {event.description}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Slots -->
        {#if sortedSlots.length > 0}
          <div class="mb-3 sm:mb-4">
            <h3 class="text-xs sm:text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 sm:mb-3">Available Times</h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              {#each sortedSlots as slot (slot.id)}
                <div animate:flip={{ duration: 200 }}>
                  <SlotCard
                    {slot}
                    {isOrganizer}
                    onConfirm={() => confirmSlot(slot)}
                    onReject={() => rejectSlot(slot)}
                    onFinalize={isOrganizer ? () => finalizeSlot(slot) : undefined}
                    onReopen={isOrganizer ? reopenDiscussion : undefined}
                    disabled={isSending}
                  />
                </div>
              {/each}
            </div>
          </div>
        {:else if collectionsLoading || isSending}
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-center">
            <Icon icon="mdi:loading" class="w-8 h-8 text-amber-500 mx-auto mb-2 animate-spin" />
            <p class="text-sm text-slate-500">Loading time slots...</p>
          </div>
        {:else}
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-center">
            <Icon icon="mdi:calendar-question" class="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p class="text-sm text-amber-700">No time slots yet. The AI will suggest some options.</p>
          </div>
        {/if}

        <!-- Chat -->
        <div class="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-4 py-2 border-b border-slate-100">
            <h3 class="text-sm font-semibold text-slate-700">Discussion</h3>
          </div>

          <!-- Messages -->
          <div class="flex-1 overflow-auto p-4 space-y-4" bind:this={messagesContainer}>
            {#if currentInteractions.length === 0 && !isSending}
              <div class="text-center text-slate-400 text-sm py-8">
                <p>Share your availability constraints or preferences.</p>
                <p class="mt-1">Example: "I can't do mornings" or "Prefer next week"</p>
              </div>
            {/if}

            {#each currentInteractions as interaction}
              <!-- User message -->
              <div class="flex flex-col items-end">
                <div class="flex items-center gap-2 mb-1 text-xs text-slate-500">
                  <span class="font-medium">{interaction.userName ?? 'Anonymous'}</span>
                  <span>{formatMessageTime(interaction.timestamp)}</span>
                </div>
                <div class="max-w-[80%] bg-amber-500 text-white rounded-2xl rounded-br-md px-4 py-2">
                  <p class="text-sm whitespace-pre-wrap">{interaction.input}</p>
                </div>
              </div>

              <!-- AI response -->
              {#if interaction.output}
                <div class="flex justify-start">
                  <div class="max-w-[80%] bg-slate-100 rounded-2xl rounded-bl-md px-4 py-2">
                    <div class="markdown-output text-sm text-slate-700">
                      <SvelteMarkdown source={interaction.output} />
                    </div>
                  </div>
                </div>
              {:else}
                <div class="flex justify-start">
                  <div class="max-w-[80%] bg-slate-100 rounded-2xl rounded-bl-md px-4 py-2">
                    {#if interaction.toolCalls && interaction.toolCalls.length > 0}
                      <div class="space-y-1">
                        {#each interaction.toolCalls as toolCall}
                          <div class="flex items-center gap-2 text-sm text-slate-500">
                            <Icon icon="mdi:chevron-right" class="w-4 h-4 text-amber-500" />
                            <span class="font-mono text-xs">{toolCall.name}</span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <div class="flex items-center gap-2 text-slate-400">
                        <Icon icon="mdi:loading" class="w-4 h-4 animate-spin" />
                        <span class="text-sm">Thinking...</span>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            {/each}
          </div>

          <!-- Input -->
          <div class="p-2 sm:p-4 border-t border-slate-100">
            <div class="relative flex items-center">
              <textarea
                class="w-full pl-3 sm:pl-4 pr-10 py-2 text-sm border border-slate-200 rounded-full resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none min-h-[40px] max-h-24"
                placeholder="Your availability..."
                rows="1"
                bind:value={messageInput}
                onkeydown={handleKeydown}
                disabled={isSending}
              ></textarea>
              <button
                class="absolute right-3 p-1 text-amber-500 hover:text-amber-600 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
                onclick={sendMessage}
                disabled={isSending || !messageInput.trim()}
                aria-label="Send message"
              >
                {#if isSending}
                  <Icon icon="mdi:loading" class="w-5 h-5 animate-spin" />
                {:else}
                  <Icon icon="mdi:send" class="w-5 h-5" />
                {/if}
              </button>
            </div>
          </div>
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
    @apply bg-white/50 text-amber-700 px-1.5 py-0.5 rounded text-sm font-mono;
  }

  .markdown-output :global(ul),
  .markdown-output :global(ol) {
    @apply my-2 pl-5;
  }

  .markdown-output :global(li) {
    @apply my-1;
  }

  .markdown-output :global(strong) {
    @apply font-semibold;
  }
</style>
