import * as readline from 'node:readline';
import { type RoolClient, type RoolSpace } from '@rool-dev/sdk';
import { parseArgs } from './args.js';
import { getClient } from './client.js';
import { formatMarkdown } from './format.js';

export async function chat(args: string[]): Promise<void> {
  const { space: spaceName, conversation: conversationId, url: apiUrl, rest } = parseArgs(args);
  const prompt = rest.join(' ');

  const client = await getClient(apiUrl);

  // Find or create space by name
  const spaces = await client.listSpaces();
  const spaceInfo = spaces.find(s => s.name === spaceName);

  let space: RoolSpace;
  if (spaceInfo) {
    space = await client.openSpace(spaceInfo.id, { conversationId });
  } else {
    space = await client.createSpace(spaceName, { conversationId });
  }

  if (prompt) {
    // One-shot mode
    try {
      await sendPrompt(space, prompt);
    } finally {
      space.close();
      client.destroy();
    }
  } else {
    // Interactive mode
    await interactiveMode(space, client);
  }
}

function clearStatusLine(): void {
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
}

async function sendPrompt(space: RoolSpace, prompt: string): Promise<void> {
  // Subscribe to progress updates
  const onUpdate = () => {
    const latest = space.getInteractions().at(-1);
    if (!latest || latest.output !== null) return;

    const tool = latest.toolCalls.at(-1);
    clearStatusLine();
    process.stdout.write(tool ? `[${tool.name}]` : 'Thinking...');
  };

  space.on('conversationUpdated', onUpdate);

  try {
    const result = await space.prompt(prompt);
    clearStatusLine();
    console.log(formatMarkdown(result.message));
  } catch (err) {
    clearStatusLine();
    throw err;
  } finally {
    space.off('conversationUpdated', onUpdate);
  }
}

async function interactiveMode(space: RoolSpace, client: RoolClient): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  console.log('Interactive mode. Type "exit" or press Ctrl+D to quit.');
  console.log('');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input === 'exit' || input === 'quit') {
      rl.close();
      return;
    }

    if (!input) {
      rl.prompt();
      return;
    }

    try {
      await sendPrompt(space, input);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('');
    space.close();
    client.destroy();
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    rl.close();
  });
}
