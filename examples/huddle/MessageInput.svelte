<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '@iconify/svelte';

  interface Props {
    disabled: boolean;
    mentions: Array<{ id: string; name: string }>;
    onsend: (text: string) => void;
  }

  let { disabled, mentions, onsend }: Props = $props();

  let input = $state('');
  let textarea: HTMLTextAreaElement | undefined = $state();

  // Mention autocomplete state
  let mentionQuery = $state<string | null>(null);
  let mentionStart = $state(0);
  let selectedIndex = $state(0);

  let filteredMentions = $derived(
    mentionQuery !== null
      ? mentions.filter((m) => m.name.toLowerCase().startsWith(mentionQuery!))
      : [],
  );

  let hasRoolMention = $derived(/@rool\b/i.test(input));

  function resize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  function detectMention() {
    if (!textarea) {
      mentionQuery = null;
      return;
    }
    const pos = textarea.selectionStart;
    const text = input.slice(0, pos);
    const match = text.match(/(^|\s)@(\w*)$/);
    if (match) {
      mentionQuery = match[2].toLowerCase();
      mentionStart = pos - match[2].length - 1; // position of @
      selectedIndex = 0;
    } else {
      mentionQuery = null;
    }
  }

  function insertMention(name: string) {
    if (!textarea) return;
    const handle = name.replace(/\s+/g, '_');
    const pos = textarea.selectionStart;
    const before = input.slice(0, mentionStart);
    const after = input.slice(pos);
    input = before + '@' + handle + ' ' + after;
    mentionQuery = null;
    const newPos = mentionStart + 1 + handle.length + 1;
    tick().then(() => {
      textarea?.setSelectionRange(newPos, newPos);
      textarea?.focus();
      resize();
    });
  }

  function send() {
    const text = input.trim();
    if (!text || disabled) return;
    input = '';
    resize();
    onsend(text);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Mention autocomplete navigation
    if (filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % filteredMentions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + filteredMentions.length) % filteredMentions.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentions[selectedIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mentionQuery = null;
        return;
      }
    }

    // Normal send on Enter
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="absolute bottom-0 left-0 right-0 p-4">
  <!-- Mention autocomplete popup -->
  {#if filteredMentions.length > 0}
    <div class="mb-1 ml-1 bg-white dark:bg-neutral-800 rounded-lg border border-slate-200 dark:border-neutral-700 shadow-lg py-1 max-h-40 overflow-y-auto">
      {#each filteredMentions as mention, i}
        <button
          class="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-neutral-700
            {i === selectedIndex ? 'bg-slate-100 dark:bg-neutral-700' : ''}"
          onmousedown={(e) => { e.preventDefault(); insertMention(mention.name); }}
        >
          {#if mention.id === 'agent'}
            <Icon icon="mdi:robot-outline" class="w-4 h-4 text-violet-500 shrink-0" />
          {:else}
            <span class="w-4 h-4 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-[10px] font-bold flex items-center justify-center shrink-0">
              {mention.name[0]?.toUpperCase()}
            </span>
          {/if}
          <span class="text-slate-700 dark:text-neutral-200">{mention.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="flex items-end gap-1 bg-white dark:bg-neutral-800 rounded-2xl px-3 py-2 border border-slate-200 dark:border-neutral-600 shadow-sm
    {hasRoolMention ? 'border-violet-400 ring-1 ring-violet-200 dark:ring-violet-800' : 'focus-within:border-teal-400'}
    transition-colors">
    <textarea
      bind:this={textarea}
      class="flex-1 bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-neutral-500 resize-none overflow-y-auto leading-6 py-1 text-sm input-scrollbar text-slate-700 dark:text-neutral-100"
      placeholder="Message... or @ to mention"
      spellcheck="false"
      rows="1"
      bind:value={input}
      onkeydown={handleKeydown}
      oninput={() => { resize(); detectMention(); }}
      onclick={detectMention}
      {disabled}
    ></textarea>
    <button
      class="p-1.5 rounded-full transition-colors disabled:opacity-30
        {hasRoolMention
          ? 'text-violet-500 hover:text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-900/30'
          : 'text-slate-500 hover:text-teal-600 hover:bg-slate-100 dark:hover:bg-neutral-700'}"
      onclick={send}
      disabled={disabled || !input.trim()}
      aria-label={hasRoolMention ? 'Send to Rool' : 'Send message'}
    >
      {#if disabled}
        <Icon icon="mdi:loading" class="w-5 h-5 animate-spin" />
      {:else if hasRoolMention}
        <Icon icon="mdi:robot-outline" class="w-5 h-5" />
      {:else}
        <Icon icon="mdi:arrow-up" class="w-5 h-5" />
      {/if}
    </button>
  </div>
  {#if hasRoolMention}
    <p class="text-[10px] text-violet-500 dark:text-violet-400 mt-1 ml-3">AI mode &mdash; Rool will respond</p>
  {/if}
</div>

<style>
  @reference "tailwindcss";

  .input-scrollbar { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
  .input-scrollbar::-webkit-scrollbar { width: 4px; }
  .input-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .input-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 2px; }
</style>
