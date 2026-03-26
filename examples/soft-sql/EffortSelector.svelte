<script lang="ts" module>
  export type PromptEffort = 'QUICK' | 'STANDARD' | 'REASONING' | 'RESEARCH';
</script>

<script lang="ts">
  import Icon from '@iconify/svelte';

  const effortOptions: { value: PromptEffort; icon: string; label: string }[] = [
    { value: 'QUICK', icon: 'mdi:lightning-bolt', label: 'Quick' },
    { value: 'STANDARD', icon: 'mdi:message-text', label: 'Standard' },
    { value: 'REASONING', icon: 'mdi:brain', label: 'Reasoning' },
    { value: 'RESEARCH', icon: 'mdi:book-search', label: 'Research' },
  ];

  let { value = $bindable<PromptEffort>('STANDARD') } = $props();
  let menuOpen = $state(false);

  const currentEffort = $derived(effortOptions.find(e => e.value === value)!);

  function selectEffort(effort: PromptEffort) {
    value = effort;
    menuOpen = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.effort-selector')) {
      menuOpen = false;
    }
  }

  $effect(() => {
    if (menuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  });
</script>

<div class="effort-selector relative">
  <button
    type="button"
    onclick={() => menuOpen = !menuOpen}
    class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors
      {value === 'STANDARD'
        ? 'text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-700'
        : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'}"
    title={currentEffort.label}
  >
    <Icon icon={currentEffort.icon} class="w-4 h-4" />
    <span class="hidden sm:inline">{currentEffort.label}</span>
    <Icon icon="mdi:chevron-down" class="w-3 h-3 transition-transform {menuOpen ? 'rotate-180' : ''}" />
  </button>

  {#if menuOpen}
    <div class="absolute top-full left-0 mt-1 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 min-w-35 z-50">
      {#each effortOptions as option}
        <button
          type="button"
          onclick={() => selectEffort(option.value)}
          class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors
            {value === option.value ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-neutral-200'}"
        >
          <Icon icon={option.icon} class="w-4 h-4" />
          <span class="flex-1">{option.label}</span>
          {#if value === option.value}
            <Icon icon="mdi:check" class="w-4 h-4" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
