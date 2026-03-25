<script lang="ts">
  import Icon from '@iconify/svelte';

  interface Props {
    disabled: boolean;
    onsend: (text: string) => void;
  }

  let { disabled, onsend }: Props = $props();

  let input = $state('');
  let textarea: HTMLTextAreaElement | undefined = $state();

  function resize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  function send() {
    const text = input.trim();
    if (!text || disabled) return;
    input = '';
    resize();
    onsend(text);
  }

  function handleKeydown(e: KeyboardEvent) {
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      send();
    }
  }

  let hasRoolPrefix = $derived(input.trimStart().startsWith('@rool'));
</script>

<div class="absolute bottom-0 left-0 right-0 p-4">
  <div class="flex items-end gap-1 bg-white rounded-2xl px-3 py-2 border border-slate-200 shadow-sm
    {hasRoolPrefix ? 'border-violet-400 ring-1 ring-violet-200' : 'focus-within:border-teal-400'}
    transition-colors">
    <textarea
      bind:this={textarea}
      class="flex-1 bg-transparent outline-none placeholder:text-slate-400 resize-none overflow-y-auto leading-6 py-1 text-sm input-scrollbar"
      placeholder="Message... or @rool to ask AI"
      rows="1"
      bind:value={input}
      onkeydown={handleKeydown}
      oninput={resize}
      {disabled}
    ></textarea>
    <button
      class="p-1.5 rounded-full transition-colors disabled:opacity-30
        {hasRoolPrefix
          ? 'text-violet-500 hover:text-violet-600 hover:bg-violet-100'
          : 'text-slate-500 hover:text-teal-600 hover:bg-slate-100'}"
      onclick={send}
      disabled={disabled || !input.trim()}
      aria-label={hasRoolPrefix ? 'Send to Rool' : 'Send message'}
    >
      {#if disabled}
        <Icon icon="mdi:loading" class="w-5 h-5 animate-spin" />
      {:else if hasRoolPrefix}
        <Icon icon="mdi:robot-outline" class="w-5 h-5" />
      {:else}
        <Icon icon="mdi:arrow-up" class="w-5 h-5" />
      {/if}
    </button>
  </div>
  {#if hasRoolPrefix}
    <p class="text-[10px] text-violet-500 mt-1 ml-3">AI mode &mdash; Rool will respond</p>
  {/if}
</div>

<style>
  @reference "tailwindcss";

  .input-scrollbar { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
  .input-scrollbar::-webkit-scrollbar { width: 4px; }
  .input-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .input-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 2px; }
</style>
