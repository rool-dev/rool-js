<script lang="ts">
  import type { ReactiveWatch, RoolObject } from '@rool-dev/extension';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import Icon from '@iconify/svelte';

  interface Props {
    messages: ReactiveWatch;
    currentUserId: string;
    huddleName: string;
    isSending: boolean;
  }

  let { messages, currentUserId, huddleName, isSending }: Props = $props();

  let container: HTMLElement | undefined = $state();

  let sorted = $derived(
    [...messages.objects].sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
  );

  // Auto-scroll when new messages arrive
  $effect(() => {
    if (sorted.length > 0 && container) {
      setTimeout(() => {
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }, 0);
    }
  });

  function formatTime(ts: unknown): string {
    if (typeof ts !== 'number') return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
</script>

<div class="flex-1 overflow-auto min-h-0 p-4 pb-24 space-y-3" bind:this={container}>
  {#if sorted.length === 0 && !messages.loading}
    <div class="flex flex-col items-center justify-center h-full text-center">
      <div class="w-16 h-16 bg-teal-100 rounded-2xl flex items-center justify-center mb-6">
        <Icon icon="mdi:pound" class="w-8 h-8 text-teal-500" />
      </div>
      <h3 class="text-lg font-semibold text-slate-700 mb-2"># {huddleName}</h3>
      <p class="text-slate-500 text-sm">Start the conversation. Type <code class="bg-slate-100 px-1 rounded text-teal-600">@rool</code> to talk to the AI.</p>
    </div>
  {:else}
    {#each sorted as msg (msg.id)}
      {@const isOwn = msg.sender === currentUserId}
      {@const isAgent = msg.fromAgent === true}

      <div class="flex items-start gap-2.5 {isOwn && !isAgent ? 'flex-row-reverse' : ''}">
        <!-- Avatar -->
        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold
          {isAgent ? 'bg-violet-100 text-violet-600' : isOwn ? 'bg-teal-100 text-teal-600' : 'bg-slate-200 text-slate-600'}">
          {#if isAgent}
            <Icon icon="mdi:robot-outline" class="w-4 h-4" />
          {:else}
            {initials(msg.senderName as string || '?')}
          {/if}
        </div>

        <!-- Message bubble -->
        <div class="max-w-[75%] min-w-0">
          <div class="flex items-baseline gap-2 mb-0.5 {isOwn && !isAgent ? 'flex-row-reverse' : ''}">
            <span class="text-xs font-semibold {isAgent ? 'text-violet-600' : 'text-slate-700'}">
              {isAgent ? 'Rool' : msg.senderName || 'Unknown'}
            </span>
            <span class="text-[10px] text-slate-400">{formatTime(msg.timestamp)}</span>
          </div>
          <div class="rounded-2xl px-3.5 py-2 text-sm
            {isAgent
              ? 'bg-violet-50 text-slate-700 rounded-tl-md markdown-output'
              : isOwn
                ? 'bg-teal-500 text-white rounded-tr-md'
                : 'bg-white border border-slate-200 text-slate-700 rounded-tl-md'}">
            {#if isAgent}
              <SvelteMarkdown source={msg.text as string} />
            {:else}
              <p class="whitespace-pre-wrap">{msg.text}</p>
            {/if}
          </div>
        </div>
      </div>
    {/each}

    {#if isSending}
      <div class="flex items-center gap-2 text-slate-400 pl-10">
        <Icon icon="mdi:loading" class="w-4 h-4 animate-spin" />
        <span class="text-sm">Rool is thinking...</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  @reference "tailwindcss";

  .markdown-output :global(p) {
    @apply leading-relaxed my-1;
  }
  .markdown-output :global(p:first-child) { @apply mt-0; }
  .markdown-output :global(p:last-child) { @apply mb-0; }
  .markdown-output :global(code) {
    @apply bg-violet-100/50 text-violet-700 px-1 py-0.5 rounded text-xs font-mono;
  }
  .markdown-output :global(pre) {
    @apply bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto my-2 text-xs;
  }
  .markdown-output :global(pre code) { @apply bg-transparent text-inherit p-0; }
  .markdown-output :global(ul), .markdown-output :global(ol) { @apply my-1 pl-4; }
  .markdown-output :global(li) { @apply my-0.5; }
</style>
