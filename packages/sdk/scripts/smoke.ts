/**
 * Smoke test against the local rool-server.
 *
 * Exercises the SDK's new location-based surface end-to-end:
 *   create space → create collection → create object →
 *   get → update → move → find → delete → prompt → cleanup.
 *
 * Run with:
 *   pnpm tsx scripts/smoke.ts
 */
import { RoolClient, machinePath, machineUri } from '../src/index.js';
import { NodeAuthProvider } from '../src/auth-node.js';

const API_URL = process.env.ROOL_API_URL ?? 'http://localhost:1357';
const AUTH_URL = process.env.ROOL_AUTH_URL ?? 'https://dev.rool.dev/auth';

function step(name: string): void {
  console.log(`\n=== ${name} ===`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main(): Promise<void> {
  const client = new RoolClient({
    apiUrl: API_URL,
    authUrl: AUTH_URL,
    authProvider: new NodeAuthProvider(),
  });

  step('initialize');
  const authed = await client.initialize();
  assert(authed, 'expected to be authenticated (dev creds at ~/.config/rool/credentials-6b4ae982.json)');
  console.log('signed in as', client.currentUser?.email);

  step('createSpace');
  const space = await client.createSpace(`smoke ${new Date().toISOString()}`);
  console.log('space id:', space.id);

  try {
    step('machine resource helpers');
    const objectResource = machinePath('/space/note/target.json');
    assert(objectResource === '/space/note/target.json', 'object path resolves');
    assert(machinePath('rool-machine%3A/space/note/target.json') === '/space/note/target.json', 'encoded object uri resolves');
    const fileResource = machinePath('/rool-drive/docs/readme.md');
    assert(fileResource === '/rool-drive/docs/readme.md', 'file path resolves');
    assert(machineUri(fileResource) === 'rool-machine:/rool-drive/docs/readme.md', 'file path serializes');

    step('conversation');
    const conversation = space.conversation('main');
    console.log('conversation:', conversation.conversationId, 'role:', space.role);

    step('createCollection');
    await conversation.createCollection('note', [
      { name: 'title', type: { kind: 'string' } },
      { name: 'body', type: { kind: 'maybe', inner: { kind: 'string' } } },
    ]);
    console.log('collections:', Object.keys(space.getSchema()));

    step('putObject');
    const { object: a } = await conversation.putObject('/space/note/hello.json', { title: 'Hello', body: 'World' });
    assert(a.path === '/space/note/hello.json', 'path should be exact');
    assert(a.body.title === 'Hello', 'title preserved');
    assert(!('id' in a.body) && !('type' in a.body), 'body must not contain id/type');
    console.log('put:', a.path);

    step('putObject (second)');
    const { object: b } = await conversation.putObject('/space/note/welcome.json', { title: 'Pinned' });
    assert(b.path === '/space/note/welcome.json', 'exact path');
    console.log('put:', b.path);

    step('getObject');
    const got = await space.getObject(b.path);
    assert(got !== undefined && got.body.title === 'Pinned', 'got pinned object');
    console.log('got:', got!.path, '→', got!.body);

    step('patchObject');
    const { object: updated } = await conversation.patchObject(b.path, { data: { title: 'Pinned & updated' } });
    assert(updated.body.title === 'Pinned & updated', 'title updated');
    console.log('updated:', updated.body);

    step('patchObject (delete field via null)');
    const { object: trimmed } = await conversation.patchObject(a.path, { data: { body: null } });
    assert(!('body' in trimmed.body), 'body field removed');
    console.log('trimmed:', trimmed.body);

    step('moveObject');
    const newPath = '/space/note/renamed.json';
    const { object: moved } = await conversation.moveObject(b.path, newPath);
    assert(moved.path === newPath, 'object now lives at new path');
    console.log('moved:', b.path, '→', moved.path);

    step('list objects via WebDAV');
    const listing = await space.webdav.propfind('/space/note', { depth: '1' });
    const locations = listing.responses
      .filter((response) => !response.isCollection && response.path.endsWith('.json') && !response.path.endsWith('/.schema.json'))
      .map((response) => response.path);
    assert(locations.includes(a.path), 'listing has a');
    assert(locations.includes(newPath), 'listing has moved object at new path');
    assert(!locations.includes(b.path), 'listing no longer has old path');
    console.log('locations:', locations);

    step('bulk get and filter objects');
    const found = await space.getObjects(locations);
    assert(found.objects.length >= 2, `expected at least 2 notes, got ${found.objects.length}`);
    const filtered = found.objects.filter((object) => object.body.title === 'Hello');
    assert(filtered.length === 1, `expected exactly 1, got ${filtered.length}`);
    assert(filtered[0].path === a.path, 'where filter matches');
    console.log('filtered ok');

    step('stat (cached audit info, may be absent before resync)');
    const s = space.stat(a.path);
    if (s) assert(s.path === a.path, 'stat carries path');
    console.log('stat:', s ?? '(not cached yet)');

    step('prompt (read-only, QUICK)');
    const { message } = await conversation.prompt('In one sentence, how many notes are there?', {
      effort: 'QUICK',
      readOnly: true,
    });
    console.log('AI:', message);

    step('deleteObjects');
    await conversation.deleteObjects([a.path, newPath]);
    assert(await space.getObject(a.path) === undefined, 'a was removed');
    assert(await space.getObject(newPath) === undefined, 'moved object removed');
    const afterDeleteListing = await space.webdav.propfind('/space/note', { depth: '1' });
    const afterDelete = afterDeleteListing.responses
      .filter((response) => !response.isCollection && response.path.endsWith('.json') && !response.path.endsWith('/.schema.json'))
      .map((response) => response.path);
    console.log('deleted ok, locations:', afterDelete);

    space.close();
  } finally {
    step('cleanup');
    await client.deleteSpace(space.id);
    console.log('space deleted');
    client.destroy();
  }

  console.log('\n✅ smoke test passed');
}

main().catch((err) => {
  console.error('\n❌ smoke test failed:', err);
  process.exitCode = 1;
});
