/**
 * Transport smoke for prompt attachments as machine resources against local rool-server.
 *
 * This deliberately avoids object create/update operations so it can run against
 * a local server even when the VM/object filesystem is unavailable. It validates:
 *   - SDK accepts machine-path attachments for /space objects and /rool-drive files
 *   - SDK uploads local base64 input to WebDAV and sends a machine ref
 *   - server accepts the refs and stores canonical rool-machine:/... strings on the interaction
 *   - prompt input is not polluted by hidden/injected file-ref text
 *
 * Run from packages/sdk:
 *   pnpm exec tsx scripts/machine-attachments-smoke.ts
 */
import {
  machinePath,
  machineUri,
  RoolClient,
  type Interaction,
} from '../src/index.js';
import { NodeAuthProvider } from '../src/auth-node.js';

const API_URL = process.env.ROOL_API_URL ?? 'http://localhost:1357';
const AUTH_URL = process.env.ROOL_AUTH_URL ?? 'https://dev.rool.dev/auth';

function step(name: string): void {
  console.log(`\n=== ${name} ===`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function path(input: string): string {
  return machinePath(input);
}

function machineRef(path: string): string {
  return machineUri(path);
}

function latestPromptInteraction(interactions: Interaction[]): Interaction {
  const ix = [...interactions].reverse().find((entry) => entry.operation === 'prompt');
  assert(ix, 'expected a prompt interaction in history');
  return ix;
}

async function main(): Promise<void> {
  const client = new RoolClient({
    apiUrl: API_URL,
    authUrl: AUTH_URL,
    authProvider: new NodeAuthProvider(),
  });

  step('initialize');
  const authed = await client.initialize();
  assert(authed, 'expected to be authenticated (dev creds via NodeAuthProvider)');
  console.log('signed in as', client.currentUser?.email);

  step('create space');
  const space = await client.createSpace(`machine attachments transport ${new Date().toISOString()}`);
  console.log('space id:', space.id);

  let channel: Awaited<ReturnType<typeof space.openChannel>> | undefined;
  try {
    channel = await space.openChannel('main');
    console.log('channel:', channel.channelId, 'conversation:', channel.conversationId);

    step('prepare machine resources');
    // The server validates object refs syntactically and uses them as focused
    // object locations when present. This smoke is transport-focused, so the
    // object does not need to exist.
    const objectResource = path('/space/note/target.json');
    const objectRef = machineRef(objectResource);
    assert(objectRef === 'rool-machine:/space/note/target.json', 'object ref should encode canonically');
    console.log('object ref:', objectRef);

    step('prepare existing WebDAV file resource');
    await space.webdav.mkcol('/rool-drive/docs').catch((error: unknown) => {
      const status = (error as { status?: number })?.status;
      if (status !== 405) throw error;
    });
    const fileText = `existing file smoke ${Date.now()}\n`;
    await space.webdav.put('/rool-drive/docs/existing-attachment.txt', fileText, {
      contentType: 'text/plain',
    });
    const fileResource = path('/rool-drive/docs/existing-attachment.txt');
    const fileRef = machineRef(fileResource);
    console.log('file ref:', fileRef);

    step('prompt with object resource, existing file resource, and local upload');
    const localText = `local upload smoke ${Date.now()}\n`;
    const localUpload = {
      data: Buffer.from(localText, 'utf8').toString('base64'),
      contentType: 'text/plain',
      filename: 'local-upload.txt',
    };
    const promptText = 'Reply with exactly: attachments smoke ok';
    const { message } = await channel.prompt(promptText, {
      effort: 'QUICK',
      readOnly: true,
      attachments: [objectResource, fileResource, localUpload],
    });
    console.log('AI:', message);

    step('validate interaction attachments');
    const interaction = latestPromptInteraction(channel.getInteractions());
    assert(interaction.input === promptText, 'prompt input should not contain hidden/injected machine refs');
    assert(interaction.attachments?.length === 3, `expected 3 stored attachments, got ${interaction.attachments?.length ?? 0}`);
    assert(interaction.attachments.includes(objectRef), 'stored attachments should include object machine ref');
    assert(interaction.attachments.includes(fileRef), 'stored attachments should include existing file machine ref');
    const uploadedRef = interaction.attachments.find((ref) => ref.includes(`/rool-drive/attachments/${channel.conversationId}/local-upload.txt`));
    assert(uploadedRef, `expected uploaded local file ref under attachments/${channel.conversationId}/local-upload.txt`);
    console.log('stored attachments:', interaction.attachments);

    step('fetch file refs through machine paths');
    for (const ref of [fileRef, uploadedRef]) {
      const fetchedResource = path(ref);
      assert(fetchedResource.startsWith('/rool-drive/'), `${ref} should resolve as file path`);
      const response = await space.fetchPath(fetchedResource);
      assert(response.ok, `fetch ${ref} should succeed: ${response.status}`);
      const text = await response.text();
      assert(text.length > 0, `${ref} should have content`);
      console.log(ref, '→', JSON.stringify(text.slice(0, 80)));
    }

    channel.close();
  } finally {
    step('cleanup');
    channel?.close();
    await client.deleteSpace(space.id).catch((error: unknown) => {
      console.warn('cleanup deleteSpace failed:', error);
    });
    client.destroy();
    console.log('space deleted');
  }

  console.log('\n✅ machine attachment transport smoke test passed');
}

main().catch((err) => {
  console.error('\n❌ machine attachment transport smoke test failed:', err);
  process.exitCode = 1;
});
