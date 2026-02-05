import { createRool } from '@rool-dev/svelte';

export const rool = createRool();

// Initialize once when module loads - processes auth callbacks
rool.init();
