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
        ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
        : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'}"
    title={currentEffort.label}
  >
    <Icon icon={currentEffort.icon} class="w-4 h-4" />
    <span class="hidden sm:inline">{currentEffort.label}</span>
    <Icon icon="mdi:chevron-down" class="w-3 h-3 transition-transform {menuOpen ? 'rotate-180' : ''}" />
  </button>

  {#if menuOpen}
    <div class="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-35 z-50">
      {#each effortOptions as option}
        <button
          type="button"
          onclick={() => selectEffort(option.value)}
          class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 transition-colors
            {value === option.value ? 'text-emerald-600' : 'text-slate-700'}"
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
