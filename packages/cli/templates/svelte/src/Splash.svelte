<script lang="ts">
  interface Props {
    appName: string;
    onLogin: () => void;
  }

  let { appName, onLogin }: Props = $props();
</script>

<div class="min-h-dvh flex flex-col items-center justify-center bg-gray-50 p-8">
  <div class="text-center max-w-sm">
    <h1 class="text-3xl font-bold text-gray-900 mb-2">{appName}</h1>
    <p class="text-gray-500 mb-8">Sign in to get started</p>
    <button
      class="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors"
      onclick={onLogin}
    >
      Sign in
    </button>
  </div>
</div>
