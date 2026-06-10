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
import { RoolClient, loc, parseLocation, resolveMachineResource } from '../src/index.js';
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
    const objectResource = resolveMachineResource('/space/note/target.json');
    assert(objectResource?.kind === 'object', 'object path resolves');
    assert(objectResource.path === '/space/note/target.json', 'object resource has machine path');
    assert(resolveMachineResource('rool-machine%3A/space/note/target.json')?.kind === 'object', 'encoded object uri resolves');
    assert(resolveMachineResource('rool:/settings/sharing') === null, 'app links are not machine resources');
    const fileResource = resolveMachineResource('/rool-drive/docs/readme.md');
    assert(fileResource?.kind === 'file', 'file path resolves');
    assert(fileResource.path === '/rool-drive/docs/readme.md', 'file resource has machine path');

    step('openChannel');
    const channel = await space.openChannel('main');
    console.log('channel:', channel.channelId, 'role:', channel.role);

    step('createCollection');
    await channel.createCollection('note', [
      { name: 'title', type: { kind: 'string' } },
      { name: 'body', type: { kind: 'maybe', inner: { kind: 'string' } } },
    ]);
    console.log('collections:', Object.keys(channel.getSchema()));

    step('createObject (auto basename)');
    const { object: a } = await channel.createObject('note', { title: 'Hello', body: 'World' });
    assert(a.collection === 'note', 'collection should be note');
    assert(a.body.title === 'Hello', 'title preserved');
    assert(!('id' in a.body) && !('type' in a.body), 'body must not contain id/type');
    assert(a.location.startsWith('/space/note/') && a.location.endsWith('.json'), 'canonical location');
    console.log('created:', a.location);

    step('createObject (pinned basename)');
    const { object: b } = await channel.createObject('note', { title: 'Pinned' }, { basename: 'welcome' });
    assert(b.location === loc('note', 'welcome'), 'pinned basename');
    console.log('created:', b.location);

    step('getObject');
    const got = await channel.getObject(b.location);
    assert(got !== undefined && got.body.title === 'Pinned', 'got pinned object');
    console.log('got:', got!.location, '→', got!.body);

    step('getObject (short-form input)');
    const gotShort = await channel.getObject('note/welcome');
    assert(gotShort !== undefined, 'short form accepted');
    assert(gotShort!.location === b.location, 'short-form resolves to canonical');
    console.log('got via short form ok');

    step('updateObject');
    const { object: updated } = await channel.updateObject(b.location, { data: { title: 'Pinned & updated' } });
    assert(updated.body.title === 'Pinned & updated', 'title updated');
    console.log('updated:', updated.body);

    step('updateObject (delete field via null)');
    const { object: trimmed } = await channel.updateObject(a.location, { data: { body: null } });
    assert(!('body' in trimmed.body), 'body field removed');
    console.log('trimmed:', trimmed.body);

    step('moveObject');
    const newLoc = loc('note', 'renamed');
    const { object: moved } = await channel.moveObject(b.location, newLoc);
    assert(moved.location === newLoc, 'object now lives at new location');
    const { collection, basename } = parseLocation(moved.location);
    assert(collection === 'note' && basename === 'renamed', 'parsed parts match');
    console.log('moved:', b.location, '→', moved.location);

    step('list objects via WebDAV');
    const listing = await space.webdav.propfind('/space/note/', { depth: '1' });
    const locations = listing.responses
      .filter((response) => !response.isCollection && response.path.endsWith('.json') && !response.path.endsWith('/.schema.json'))
      .map((response) => response.path);
    assert(locations.includes(a.location), 'listing has a');
    assert(locations.includes(newLoc), 'listing has moved object at new location');
    assert(!locations.includes(b.location), 'listing no longer has old location');
    console.log('locations:', locations);

    step('bulk get and filter objects');
    const found = await channel.getObjects(locations);
    assert(found.objects.length >= 2, `expected at least 2 notes, got ${found.objects.length}`);
    const filtered = found.objects.filter((object) => object.body.title === 'Hello');
    assert(filtered.length === 1, `expected exactly 1, got ${filtered.length}`);
    assert(filtered[0].location === a.location, 'where filter matches');
    console.log('filtered ok');

    step('stat (cached audit info, may be absent before resync)');
    const s = channel.stat(a.location);
    if (s) assert(s.location === a.location, 'stat carries location');
    console.log('stat:', s ?? '(not cached yet)');

    step('prompt (read-only, QUICK)');
    const { message } = await channel.prompt('In one sentence, how many notes are there?', {
      effort: 'QUICK',
      readOnly: true,
    });
    console.log('AI:', message);

    step('deleteObjects');
    await channel.deleteObjects([a.location, newLoc]);
    assert(await channel.getObject(a.location) === undefined, 'a was removed');
    assert(await channel.getObject(newLoc) === undefined, 'moved object removed');
    const afterDeleteListing = await space.webdav.propfind('/space/note/', { depth: '1' });
    const afterDelete = afterDeleteListing.responses
      .filter((response) => !response.isCollection && response.path.endsWith('.json') && !response.path.endsWith('/.schema.json'))
      .map((response) => response.path);
    console.log('deleted ok, locations:', afterDelete);

    channel.close();
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
