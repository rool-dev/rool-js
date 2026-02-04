<script lang="ts">
  import { createRool, type SpaceHandle } from '@rool-dev/svelte';
  import SpaceView from './SpaceView.svelte';

  // Initialize Rool
  const rool = createRool();
  rool.init();

  // Local state
  let space = $state<SpaceHandle | null>(null);
  let newSpaceName = $state('');

  // Actions
  function login() {
    rool.login('Svelte Chat Demo');
  }

  function logout() {
    if (space) {
      space.close();
      space = null;
    }
    rool.logout();
  }

  async function openSpace(id: string) {
    if (space) {
      space.close();
    }
    space = await rool.openSpace(id);
  }

  async function createSpace() {
    if (!newSpaceName.trim()) return;
    if (space) {
      space.close();
    }
    space = await rool.createSpace(newSpaceName.trim());
    newSpaceName = '';
  }

  function closeSpace() {
    if (space) {
      space.close();
      space = null;
    }
  }
</script>

<div class="header">
  <h1>Rool - Svelte Chat Demo</h1>
  <div>
    {#if rool.authenticated}
      <button onclick={logout}>Logout</button>
    {/if}
  </div>
</div>

{#if !rool.authenticated}
  <!-- Login Screen -->
  <div class="card">
    <p>Sign in to access your spaces.</p>
    <button onclick={login}>Sign In</button>
  </div>

{:else if !space}
  <!-- Space Selection -->
  <div class="card">
    <h2>Your Spaces</h2>

    {#if rool.spacesLoading}
      <p class="loading">Loading spaces...</p>
    {:else if rool.spacesError}
      <p class="error">Error: {rool.spacesError.message}</p>
    {:else if !rool.spaces || rool.spaces.length === 0}
      <p>No spaces yet. Create one to get started.</p>
    {:else}
      <div class="space-list">
        {#each rool.spaces as s}
          <div class="space-item">
            <span>{s.name}</span>
            <button onclick={() => openSpace(s.id)}>Open</button>
          </div>
        {/each}
      </div>
    {/if}

    <hr style="margin: 1rem 0" />

    <div class="input-row">
      <input
        type="text"
        placeholder="New space name"
        bind:value={newSpaceName}
        onkeydown={(e) => e.key === 'Enter' && createSpace()}
      />
      <button onclick={createSpace} disabled={!newSpaceName.trim()}>
        Create Space
      </button>
    </div>
  </div>

{:else}
  <SpaceView {space} onClose={closeSpace} />
{/if}
