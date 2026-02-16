<script lang="ts">
  import type { RoolObject } from '@rool-dev/svelte';

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
    { quality: 0, label: 'Again', style: 'text-red-600 bg-red-50 hover:bg-red-100' },
    { quality: 1, label: 'Hard', style: 'text-orange-600 bg-orange-50 hover:bg-orange-100' },
    { quality: 2, label: 'Good', style: 'text-green-600 bg-green-50 hover:bg-green-100' },
    { quality: 3, label: 'Easy', style: 'text-blue-600 bg-blue-50 hover:bg-blue-100' }
  ] as const;
</script>

<div class="w-full max-w-lg perspective-[1000px]">
  <div
    class="relative transition-transform duration-500 transform-3d {showAnswer ? 'rotate-y-180' : ''}"
  >
    <!-- Front face -->
    <div class="bg-white rounded-xl shadow-lg border border-slate-200 backface-hidden">
      <div class="p-8 min-h-50 flex items-center justify-center">
        <p class="text-lg text-center text-slate-800">{card.front}</p>
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
    <div class="absolute inset-0 bg-white rounded-xl shadow-lg border border-slate-200 backface-hidden rotate-y-180">
      <div class="p-8 min-h-50 flex items-center justify-center">
        <p class="text-lg text-center text-slate-800">{card.back}</p>
      </div>
      <div class="px-8 pb-8 space-y-3">
        <p class="text-xs text-center text-slate-400 uppercase tracking-wider">How did you do?</p>
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
  class="mt-4 text-sm text-slate-400 hover:text-slate-600 transition-colors"
  onclick={onDismiss}
  disabled={isLoading}
>
  Dismiss this card
</button>
