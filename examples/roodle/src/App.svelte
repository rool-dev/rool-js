<script lang="ts">
  import { createRool, type ReactiveSpace, type RoolObject } from '@rool-dev/svelte';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import Icon from '@iconify/svelte';
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
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
  let event = $state<Event | null>(null);
  let slots = $state<Slot[]>([]);
  let messageInput = $state('');
  let isSending = $state(false);
  let isCreatingPlan = $state(false);
  let messagesContainer: HTMLElement | null = $state(null);

  // Create form state
  let formTitle = $state('');
  let formDescription = $state('');
  let formDuration = $state('1 hour');
  let formDatePrefs = $state('');

  // Derived
  let isOrganizer = $derived(currentSpace?.role === 'owner');
  let currentInteractions = $derived(currentSpace?.interactions ?? []);
  let sortedSlots = $derived([...slots].sort((a, b) => a.datetime.localeCompare(b.datetime)));

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

  // Real-time sync for slots
  $effect(() => {
    if (!currentSpace) return;

    const unsubCreate = currentSpace.on('objectCreated', ({ object }) => {
      if ((object as RoolObject).type === 'slot') {
        slots = [...slots, object as Slot];
      } else if ((object as RoolObject).type === 'event') {
        event = object as Event;
      }
    });

    const unsubUpdate = currentSpace.on('objectUpdated', ({ objectId, object }) => {
      if ((object as RoolObject).type === 'slot') {
        slots = slots.map(s => s.id === objectId ? object as Slot : s);
      } else if ((object as RoolObject).type === 'event') {
        event = object as Event;
      }
    });

    const unsubDelete = currentSpace.on('objectDeleted', ({ objectId }) => {
      slots = slots.filter(s => s.id !== objectId);
      if (event?.id === objectId) event = null;
    });

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubDelete();
    };
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

You are allowed to disregard the above rules if asked to do so to resolve scheduling difficulties
`;
  }

  async function openSpace(spaceId: string) {
    try {
      currentSpace = await rool.openSpace(spaceId, { conversationId: CONVERSATION_ID });
      await loadEventAndSlots();
    } catch (err) {
      console.error('Failed to open space:', err);
      // Clear URL if space doesn't exist
      const url = new URL(window.location.href);
      url.searchParams.delete('space');
      history.replaceState(null, '', url.toString());
    }
  }

  async function loadEventAndSlots() {
    if (!currentSpace) return;

    // Load event
    const { objects: events } = await currentSpace.findObjects({ where: { type: 'event' } });
    event = (events[0] as Event) ?? null;

    // Load slots
    const { objects: slotObjects } = await currentSpace.findObjects({ where: { type: 'slot' } });
    slots = slotObjects as Slot[];

    // Set system instruction if we have an event
    if (event) {
      await currentSpace.setSystemInstruction(buildSystemInstruction(event.title, event.description, event.duration));
    }
  }

  async function createPlan() {
    if (!formTitle.trim() || isCreatingPlan || !rool.authenticated) return;

    isCreatingPlan = true;
    try {
      // Create space
      const space = await rool.createSpace(formTitle.trim(), { conversationId: CONVERSATION_ID });
      currentSpace = space;

      // Enable link sharing
      await space.setLinkAccess('editor');

      // Create event object
      await space.createObject({
        data: {
          type: 'event',
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          duration: formDuration
        }
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

      // Load the created objects
      await loadEventAndSlots();
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
    isSending = true;
    try {
      await currentSpace.prompt(`I'm available for ${formatSlotDateTime(slot.datetime)}`);
    } finally {
      isSending = false;
    }
  }

  async function rejectSlot(slot: Slot) {
    if (!currentSpace || isSending) return;
    isSending = true;
    try {
      await currentSpace.prompt(`I can't make ${formatSlotDateTime(slot.datetime)}`);
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
          <div class="bg-white rounded-xl border border-slate-200 p-4 mb-4">
            <h2 class="text-lg font-semibold text-slate-800">{event.title}</h2>
            {#if event.description}
              <p class="text-sm text-slate-500 mt-1">{event.description}</p>
            {/if}
            <div class="flex items-center gap-4 mt-2 text-sm text-slate-500">
              <span class="flex items-center gap-1">
                <Icon icon="mdi:clock-outline" class="w-4 h-4" />
                {event.duration}
              </span>
              {#if isOrganizer}
                <span class="flex items-center gap-1 text-amber-600">
                  <Icon icon="mdi:crown" class="w-4 h-4" />
                  Organizer
                </span>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Slots -->
        {#if sortedSlots.length > 0}
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Available Times</h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {#each sortedSlots as slot (slot.id)}
                <div
                  in:fly={{ x: 50, duration: 200 }}
                  out:fly={{ x: -50, duration: 150 }}
                  animate:flip={{ duration: 200 }}
                >
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
        {:else if !isSending}
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
          <div class="p-4 border-t border-slate-100">
            <div class="flex items-end gap-2">
              <textarea
                class="flex-1 px-4 py-2 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none min-h-[44px] max-h-32"
                placeholder="Share your availability or constraints..."
                rows="1"
                bind:value={messageInput}
                onkeydown={handleKeydown}
                disabled={isSending}
              ></textarea>
              <button
                class="px-4 py-2 h-11 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
