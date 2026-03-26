<script lang="ts">
  import type { RoolObject } from '@rool-dev/extension';

  interface Card extends RoolObject {
    front: string;
    back: string;
  }

  interface Props {
    card: Card;
    isLoading: boolean;
    onReview: (quality: number) => void;
    onDismiss: () => void;
  }

  let { card, isLoading, onReview, onDismiss }: Props = $props();

  // Local state - resets automatically when component remounts via {#key}
  let showAnswer = $state(false);

  const REVIEW_BUTTONS = [
    { quality: 0, label: 'Again', style: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50' },
    { quality: 1, label: 'Hard', style: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/50' },
    { quality: 2, label: 'Good', style: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50' },
    { quality: 3, label: 'Easy', style: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50' }
  ] as const;
</script>

<div class="w-full sm:min-w-80 max-w-lg perspective-[1000px]">
  <div
    class="relative transition-transform duration-500 transform-3d {showAnswer ? 'rotate-y-180' : ''}"
  >
    <!-- Front face -->
    <div class="bg-white dark:bg-neutral-900 rounded-xl shadow-lg border border-slate-200 dark:border-neutral-700 backface-hidden">
      <div class="p-8 min-h-50 flex items-center justify-center">
        <p class="text-lg text-center text-slate-800 dark:text-neutral-100">{card.front}</p>
      </div>
      <div class="px-8 pb-8">
        <button
          class="w-full py-3 text-sm font-medium text-white bg-linear-to-r from-violet-500 to-purple-500 rounded-lg hover:from-violet-400 hover:to-purple-400 transition-all"
          onclick={() => showAnswer = true}
        >
          Show Answer
        </button>
      </div>
    </div>

    <!-- Back face -->
    <div class="absolute inset-0 bg-white dark:bg-neutral-900 rounded-xl shadow-lg border border-slate-200 dark:border-neutral-700 backface-hidden rotate-y-180">
      <div class="p-8 min-h-50 flex items-center justify-center">
        <p class="text-lg text-center text-slate-800 dark:text-neutral-100">{card.back}</p>
      </div>
      <div class="px-8 pb-8 space-y-3">
        <p class="text-xs text-center text-slate-400 dark:text-neutral-500 uppercase tracking-wider">How did you do?</p>
        <div class="grid grid-cols-4 gap-2">
          {#each REVIEW_BUTTONS as { quality, label, style }}
            <button
              class="py-2.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 {style}"
              onclick={() => onReview(quality)}
              disabled={isLoading}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Dismiss button -->
<button
  class="mt-4 text-sm text-slate-400 dark:text-neutral-500 hover:text-slate-600 dark:hover:text-neutral-300 transition-colors"
  onclick={onDismiss}
  disabled={isLoading}
>
  Dismiss this card
</button>
