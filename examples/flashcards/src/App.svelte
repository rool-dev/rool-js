<script lang="ts">
  import { createRool, type ReactiveSpace, type ReactiveCollection, type RoolObject } from '@rool-dev/svelte';
  import { fly } from 'svelte/transition';
  import { calculateNextReview } from './sm2.js';
  import Icon from '@iconify/svelte';
  import Header from './Header.svelte';
  import FlashcardDisplay from './FlashcardDisplay.svelte';
  import Footer from './Footer.svelte';

  const rool = createRool();
  rool.init();

  interface Card extends RoolObject {
    topic: string;
    front: string;
    back: string;
    dueAt?: number;
    interval?: number;
    easeFactor?: number;
    reviewCount?: number;
  }

  // State
  let currentSpace = $state<ReactiveSpace | null>(null);
  let topicsCollection = $state<ReactiveCollection | null>(null);
  let cardsCollection = $state<ReactiveCollection | null>(null);
  let selectedTopicName = $state<string | null>(null);
  let isLoading = $state(false);
  let isGenerating = $state(false);
  let newTopicName = $state('');
  let showNewTopicForm = $state(false);

  // Derived state
  let topics = $derived(topicsCollection?.objects ?? []);
  let cards = $derived((cardsCollection?.objects ?? []) as Card[]);
  let dueCards = $derived.by(() => {
    const now = Date.now();
    return cards
      .filter((c) => !c.dueAt || c.dueAt <= now)
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  });
  let currentCard = $derived(dueCards[0]);

  const SYSTEM_INSTRUCTION = `You are a flashcard generator. Create cards with:
- front: A clear question testing understanding
- back: A focused answer (1-2 sentences)

Card structure: { type: 'card', topic: '<topic>', front: '...', back: '...', dueAt: 0, interval: 0, easeFactor: 2.5, reviewCount: 0 }`;

  $effect(() => {
    if (rool.authenticated === false) rool.login('Flashcards');
  });

  async function handleSpaceChange(spaceId: string | null) {
    // Cleanup previous space
    topicsCollection?.close();
    cardsCollection?.close();
    currentSpace?.close();
    topicsCollection = null;
    cardsCollection = null;
    selectedTopicName = null;

    if (!spaceId) {
      currentSpace = null;
      return;
    }

    currentSpace = await rool.openSpace(spaceId, { conversationId: 'flashcards' });
    await currentSpace.renameConversation('flashcards', 'Flashcards');
    await currentSpace.setSystemInstruction(SYSTEM_INSTRUCTION);
    topicsCollection = currentSpace.collection({ where: { type: 'topic' } });
  }

  function selectTopic(topicName: string) {
    cardsCollection?.close();
    selectedTopicName = topicName;
    if (currentSpace) {
      cardsCollection = currentSpace.collection({ where: { type: 'card', topic: topicName } });
    }
  }

  function deselectTopic() {
    cardsCollection?.close();
    cardsCollection = null;
    selectedTopicName = null;
  }

  async function createTopic() {
    if (!currentSpace || !newTopicName.trim() || isGenerating) return;

    const topicName = newTopicName.trim();
    isGenerating = true;
    try {
      await currentSpace.checkpoint('Create topic');
      await currentSpace.createObject({ data: { type: 'topic', name: topicName } });
      await currentSpace.prompt(
        `Generate 5 flashcards for "${topicName}". Cover different aspects of the topic.`
      );
      selectTopic(topicName);
      newTopicName = '';
      showNewTopicForm = false;
    } catch (err) {
      console.error('Failed to create topic:', err);
    } finally {
      isGenerating = false;
    }
  }

  async function generateMoreCards() {
    if (!currentSpace || !selectedTopicName || isGenerating) return;

    isGenerating = true;
    try {
      await currentSpace.prompt(
        `Generate 3 more flashcards for "${selectedTopicName}". Make them different from existing cards.`
      );
    } catch (err) {
      console.error('Failed to generate cards:', err);
    } finally {
      isGenerating = false;
    }
  }

  async function submitReview(quality: number) {
    if (!currentSpace || !currentCard) return;

    const card = currentCard;
    const updated = calculateNextReview(quality, card);

    isLoading = true;
    try {
      await currentSpace.checkpoint('Review card');
      await currentSpace.updateObject(card.id, {
        data: { ...updated, reviewCount: (card.reviewCount ?? 0) + 1 }
      });
    } catch (err) {
      console.error('Failed to update card:', err);
    } finally {
      isLoading = false;
    }
  }

  async function dismissCard() {
    if (!currentSpace || !currentCard) return;

    isLoading = true;
    try {
      await currentSpace.checkpoint('Dismiss card');
      await currentSpace.deleteObjects([currentCard.id]);
    } catch (err) {
      console.error('Failed to dismiss card:', err);
    } finally {
      isLoading = false;
    }
  }
</script>

<!-- Reusable UI snippets -->
{#snippet topicList(showSelected: boolean)}
  {#if topics.length === 0}
    <p class="text-sm text-slate-400 px-3 py-2">No topics yet</p>
  {:else}
    {#each topics as topic}
      <button
        class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
          {showSelected && selectedTopicName === topic.name
            ? 'bg-violet-100 text-violet-700 font-medium'
            : 'text-slate-600 hover:bg-slate-100'}"
        onclick={() => selectTopic(topic.name as string)}
      >
        {topic.name}
      </button>
    {/each}
  {/if}
{/snippet}

{#snippet newTopicForm(bgClass: string)}
  {#if isGenerating && showNewTopicForm}
    <div class="mt-4 p-4 text-center">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500 mx-auto"></div>
      <p class="text-sm text-slate-500 mt-2">Creating topic...</p>
    </div>
  {:else if showNewTopicForm}
    <div class="mt-4 p-3 {bgClass} rounded-lg">
      <input
        type="text"
        class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:outline-none"
        placeholder="Topic name..."
        bind:value={newTopicName}
        onkeydown={(e) => e.key === 'Enter' && createTopic()}
      />
      <div class="flex gap-2 mt-2">
        <button
          class="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-violet-500 rounded-lg hover:bg-violet-600 disabled:opacity-50"
          onclick={createTopic}
          disabled={!newTopicName.trim()}
        >
          Create
        </button>
        <button
          class="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded-lg"
          onclick={() => { showNewTopicForm = false; newTopicName = ''; }}
        >
          Cancel
        </button>
      </div>
    </div>
  {:else}
    <button
      class="mt-4 w-full px-3 py-2 text-sm font-medium text-violet-600 bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors"
      onclick={() => showNewTopicForm = true}
    >
      + New Topic
    </button>
  {/if}
{/snippet}

<!-- Main UI -->
{#if !rool.authenticated}
  <div class="min-h-dvh bg-slate-50 flex items-center justify-center">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-500 mx-auto mb-4"></div>
      <p class="text-slate-500">Loading...</p>
    </div>
  </div>
{:else}
  <div class="min-h-dvh bg-slate-50 flex flex-col">
    <Header {rool} {currentSpace} onSpaceChange={handleSpaceChange} />

    <main class="flex-1 flex max-w-5xl mx-auto w-full">
      {#if currentSpace}
        <!-- Desktop sidebar -->
        <aside class="hidden md:flex md:w-64 bg-white border-r border-slate-200 p-4 flex-col">
          <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Topics</h2>
          <div class="flex-1 space-y-1 overflow-y-auto">
            {@render topicList(true)}
          </div>
          {@render newTopicForm('bg-slate-50')}
        </aside>

        <!-- Main content area -->
        <div class="flex-1 p-4 md:p-6 flex flex-col">
          {#if selectedTopicName}
            <!-- Topic header -->
            <div class="mb-4 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <button
                  class="md:hidden p-1.5 -ml-1.5 text-slate-500 hover:text-slate-700"
                  onclick={deselectTopic}
                  aria-label="Back to topics"
                >
                  <Icon icon="mdi:chevron-left" class="w-5 h-5" />
                </button>
                <h2 class="text-lg font-semibold text-slate-800 truncate">{selectedTopicName}</h2>
              </div>
              <span class="text-sm text-slate-500 shrink-0">{dueCards.length} due</span>
            </div>

            <!-- Card review -->
            {#if isGenerating}
              <div class="flex-1 flex items-center justify-center">
                <div class="text-center">
                  <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-500 mx-auto mb-4"></div>
                  <p class="text-slate-500">Generating cards...</p>
                </div>
              </div>
            {:else if currentCard}
              <div class="flex-1 flex flex-col items-center justify-center">
                {#key currentCard.id}
                  <div in:fly={{ x: 50, duration: 200 }}>
                    <FlashcardDisplay card={currentCard} {isLoading} onReview={submitReview} onDismiss={dismissCard} />
                  </div>
                {/key}
              </div>
            {:else}
              <div class="flex-1 flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mb-6">
                  <Icon icon="mdi:check-circle-outline" class="w-8 h-8 text-violet-500" />
                </div>
                <h3 class="text-lg font-semibold text-slate-700 mb-2">All caught up!</h3>
                <p class="text-slate-500 text-sm mb-6">No cards are due right now.</p>
                <button
                  class="px-6 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-violet-500 to-purple-500 rounded-lg hover:from-violet-400 hover:to-purple-400 transition-all disabled:opacity-50"
                  onclick={generateMoreCards}
                  disabled={isGenerating}
                >
                  Generate more cards
                </button>
              </div>
            {/if}
          {:else}
            <!-- No topic selected -->
            <div class="flex-1 flex flex-col">
              <!-- Mobile: topic list -->
              <div class="md:hidden flex-1 flex flex-col">
                <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Topics</h2>
                <div class="flex-1 space-y-1 overflow-y-auto">
                  {@render topicList(false)}
                </div>
                {@render newTopicForm('bg-slate-100')}
              </div>

              <!-- Desktop: placeholder -->
              <div class="hidden md:flex flex-1 flex-col items-center justify-center text-center">
                <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
                  <Icon icon="mdi:cards-outline" class="w-8 h-8 text-slate-400" />
                </div>
                <h2 class="text-lg font-semibold text-slate-700 mb-2">Select a topic</h2>
                <p class="text-slate-500 text-sm">Choose a topic from the sidebar or create a new one</p>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <!-- No space selected -->
        <div class="flex-1 flex flex-col items-center justify-center text-center py-16">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
            <Icon icon="mdi:folder-open-outline" class="w-8 h-8 text-slate-400" />
          </div>
          <h2 class="text-lg font-semibold text-slate-700 mb-2">No space selected</h2>
          <p class="text-slate-500 text-sm">Choose a space from the dropdown to start studying</p>
        </div>
      {/if}
    </main>

    <Footer />
  </div>
{/if}
