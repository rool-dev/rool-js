import { RoolClient, type RoolSpace } from '@rool-dev/sdk';
import './app.css';

const APP_NAME = 'Rool App';

const client = new RoolClient();
const app = document.getElementById('app')!;

let logEl: HTMLElement;
let inputEl: HTMLInputElement;
let buttonEl: HTMLButtonElement;

// --- Rendering ---

function renderSplash() {
  app.innerHTML = `
    <div class="min-h-dvh flex flex-col items-center justify-center bg-gray-50 p-8">
      <div class="text-center max-w-sm">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">${APP_NAME}</h1>
        <p class="text-gray-500 mb-8">Sign in to get started</p>
        <button id="login-btn" class="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg">
          Sign in
        </button>
      </div>
    </div>
  `;
  document.getElementById('login-btn')!.onclick = () => client.login(APP_NAME);
}

function renderApp(space: RoolSpace) {
  app.innerHTML = `
    <div class="min-h-dvh flex flex-col bg-gray-900 text-gray-100 font-mono text-sm">
      <header class="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <span class="text-gray-400">${APP_NAME}</span>
        <button id="logout-btn" class="text-gray-500 hover:text-gray-300">logout</button>
      </header>
      <div id="log" class="flex-1 overflow-y-auto p-4 space-y-1"></div>
      <form id="prompt-form" class="border-t border-gray-700 p-4">
        <div class="flex gap-2">
          <span class="text-green-400">&gt;</span>
          <input
            type="text"
            id="prompt-input"
            placeholder="Type a prompt..."
            class="flex-1 bg-transparent outline-none text-gray-100 placeholder-gray-600"
            autocomplete="off"
          />
          <button type="submit" id="submit-btn" class="text-gray-500 hover:text-gray-300 disabled:opacity-50">
            send
          </button>
        </div>
      </form>
    </div>
  `;

  logEl = document.getElementById('log')!;
  inputEl = document.getElementById('prompt-input') as HTMLInputElement;
  buttonEl = document.getElementById('submit-btn') as HTMLButtonElement;

  document.getElementById('logout-btn')!.onclick = () => {
    client.logout();
    location.reload();
  };

  const form = document.getElementById('prompt-form') as HTMLFormElement;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    log('prompt', text);
    inputEl.value = '';
    inputEl.disabled = true;
    buttonEl.disabled = true;

    try {
      await space.checkpoint();
      const { message } = await space.prompt(text);
      log('response', message);
    } catch (err) {
      log('error', err instanceof Error ? err.message : String(err));
    } finally {
      inputEl.disabled = false;
      buttonEl.disabled = false;
      inputEl.focus();
    }
  };

  // Subscribe to space events
  space.on('objectCreated', ({ objectId, object }) => {
    log('objectCreated', `${objectId}: ${JSON.stringify(object)}`);
  });

  space.on('objectUpdated', ({ objectId, object }) => {
    log('objectUpdated', `${objectId}: ${JSON.stringify(object)}`);
  });

  space.on('objectDeleted', ({ objectId }) => {
    log('objectDeleted', objectId);
  });

  space.on('linked', ({ sourceId, relation, targetId }) => {
    log('linked', `${sourceId} --${relation}--> ${targetId}`);
  });

  space.on('unlinked', ({ sourceId, relation, targetId }) => {
    log('unlinked', `${sourceId} --${relation}--> ${targetId}`);
  });

  log('info', `Connected to space "${space.name}"`);
  log('info', 'Type a prompt to create or modify objects. Events will appear here.');
  inputEl.focus();
}

function log(type: string, content: string) {
  const line = document.createElement('div');
  const colors: Record<string, string> = {
    prompt: 'text-green-400',
    response: 'text-blue-400',
    info: 'text-gray-500',
    error: 'text-red-400',
    objectCreated: 'text-yellow-400',
    objectUpdated: 'text-yellow-400',
    objectDeleted: 'text-orange-400',
    linked: 'text-purple-400',
    unlinked: 'text-purple-400',
  };
  const color = colors[type] || 'text-gray-400';

  line.innerHTML = `<span class="${color}">[${type}]</span> <span class="text-gray-300">${escapeHtml(content)}</span>`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Main ---

async function main() {
  const authenticated = await client.initialize();

  if (!authenticated) {
    renderSplash();
    return;
  }

  // Find or create a space for this app
  const spaces = await client.listSpaces();
  const existing = spaces.find((s) => s.name === APP_NAME);

  const space = existing ? await client.openSpace(existing.id) : await client.createSpace(APP_NAME);

  renderApp(space);
}

main().catch(console.error);
