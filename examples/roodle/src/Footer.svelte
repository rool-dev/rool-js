<script lang="ts">
  import Icon from '@iconify/svelte';
</script>

<footer class="bg-white border-t border-slate-200 px-4 py-2">
  <div class="max-w-4xl mx-auto flex items-center justify-center gap-1 text-sm text-slate-500">
    <span>Built with</span>
    <a
      href="https://rool.dev"
      target="_blank"
      rel="noopener noreferrer"
      class="font-medium text-amber-600 hover:text-amber-500"
    >
      Rool
    </a>
    <span class="mx-1">·</span>
    <a
      href="https://github.com/rool-dev/rool-js/tree/main/examples/roodle"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1 text-slate-600 hover:text-slate-800"
    >
      <Icon icon="mdi:github" class="w-4 h-4" />
      <span>Source</span>
    </a>
  </div>
</footer>
