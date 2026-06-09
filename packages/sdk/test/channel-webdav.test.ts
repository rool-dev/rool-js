import assert from 'node:assert/strict';
import test from 'node:test';
import { RoolChannel } from '../src/channel.js';
import type { RoolWebDAV, WebDAVRequestInit, WebDAVWriteResult } from '../src/webdav.js';
import type { GraphQLClient } from '../src/graphql.js';
import type { RestClient } from '../src/rest.js';
import type { Channel, RoolObject } from '../src/types.js';

class FakeWebDAV {
  files = new Map<string, { body: string; etag: string }>();
  calls: Array<{ method: string; path: string; init?: unknown }> = [];
  nextEtag = 1;

  async get(path: string): Promise<Response> {
    this.calls.push({ method: 'GET', path });
    const file = this.files.get(path);
    if (!file) return new Response('missing', { status: 404, statusText: 'Not Found' });
    return new Response(file.body, {
      status: 200,
      headers: { ETag: file.etag, 'Content-Type': 'application/json' },
    });
  }

  async put(path: string, body: BodyInit, options: Record<string, unknown> = {}): Promise<WebDAVWriteResult> {
    this.calls.push({ method: 'PUT', path, init: options });
    const existing = this.files.get(path);
    if (options.ifNoneMatch === '*' && existing) return { status: 412 as 201, etag: null, location: null };
    if (options.ifMatch && existing?.etag !== options.ifMatch) return { status: 412 as 201, etag: null, location: null };
    const text = typeof body === 'string' ? body : await new Response(body).text();
    const etag = `"v${this.nextEtag++}"`;
    this.files.set(path, { body: text, etag });
    return { status: existing ? 204 : 201, etag, location: null };
  }

  async delete(path: string, options: Record<string, unknown> = {}): Promise<void> {
    this.calls.push({ method: 'DELETE', path, init: options });
    this.files.delete(path);
  }

  async mkcol(path: string, options: Record<string, unknown> = {}): Promise<void> {
    this.calls.push({ method: 'MKCOL', path, init: options });
  }

  async move(source: string, destination: string, options: Record<string, unknown> = {}): Promise<WebDAVWriteResult> {
    this.calls.push({ method: 'MOVE', path: source, init: { ...options, destination } });
    const file = this.files.get(source);
    if (!file) throw new Error('missing source');
    const etag = `"v${this.nextEtag++}"`;
    this.files.set(destination, { body: file.body, etag });
    this.files.delete(source);
    return { status: 201, etag, location: null };
  }

  async request(method: string, path = '', init?: WebDAVRequestInit): Promise<Response> {
    this.calls.push({ method, path, init });
    return new Response(null, { status: method === 'MKCOL' ? 201 : 204 });
  }
}

function channel(dav: FakeWebDAV): RoolChannel {
  const graphql = {} as unknown as GraphQLClient;

  const rawChannel: Channel = {
    createdAt: Date.now(),
    createdBy: 'user_1',
    conversations: {},
  };

  return new RoolChannel({
    id: 'sp_123',
    name: 'Test Space',
    role: 'owner',
    linkAccess: 'none',
    userId: 'user_1',
    objectLocations: ['/space/tasks/first.json'],
    objectStats: {},
    schema: { tasks: { fields: [{ name: 'title', type: { kind: 'string' } }] } },
    meta: {},
    channel: rawChannel,
    channelId: 'main',
    graphqlClient: graphql,
    restClient: {} as RestClient,
    webdav: dav as unknown as RoolWebDAV,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onClose: () => {},
  });
}

test('channel object CRUD uses object WebDAV instead of GraphQL', async () => {
  const dav = new FakeWebDAV();
  const ch = channel(dav);

  const created = await ch.createObject('tasks', { title: 'First' }, { basename: 'first' });
  assert.deepEqual(created.object, {
    location: '/space/tasks/first.json',
    collection: 'tasks',
    basename: 'first',
    body: { title: 'First' },
  });
  assert.deepEqual(JSON.parse(dav.files.get('/space/tasks/first.json')!.body), { title: 'First' });

  const headers = new Headers((dav.calls[0].init as { headers: HeadersInit }).headers);
  assert.equal(dav.calls[0].method, 'PUT');
  assert.equal(dav.calls[0].path, '/space/tasks/first.json');
  assert.equal((dav.calls[0].init as { ifNoneMatch: string }).ifNoneMatch, '*');
  assert.equal(headers.get('X-Rool-Channel-Id'), 'main');
  assert.equal(headers.get('X-Rool-Conversation-Id'), 'default');

  const loaded = await ch.getObject('/space/tasks/first.json');
  assert.equal(loaded?.body.title, 'First');

  const updated = await ch.updateObject('/space/tasks/first.json', {
    data: { title: 'Updated', done: false, obsolete: null },
  });
  assert.deepEqual(updated.object.body, { title: 'Updated', done: false });

  const moved = await ch.moveObject('/space/tasks/first.json', '/space/tasks/renamed.json');
  assert.equal(moved.object.location, '/space/tasks/renamed.json');
  assert.equal(dav.files.has('/space/tasks/first.json'), false);
  assert.equal(dav.files.has('/space/tasks/renamed.json'), true);

  await ch.deleteObjects(['/space/tasks/renamed.json']);
  assert.equal(dav.files.has('/space/tasks/renamed.json'), false);
});

test('channel collection schema writes use object WebDAV', async () => {
  const dav = new FakeWebDAV();
  const ch = channel(dav);

  await ch.createCollection('notes', [{ name: 'title', type: { kind: 'string' } }]);
  assert.equal(dav.calls[0].method, 'MKCOL');
  assert.equal(dav.calls[0].path, '/space/notes/');
  assert.equal(dav.calls[1].method, 'PUT');
  assert.equal(dav.calls[1].path, '/space/notes/.schema.json');
  assert.deepEqual(ch.getSchema().notes, { fields: [{ name: 'title', type: { kind: 'string' } }] });

  await ch.alterCollection('notes', [{ name: 'done', type: { kind: 'boolean' } }]);
  assert.deepEqual(JSON.parse(dav.files.get('/space/notes/.schema.json')!.body), { fields: [{ name: 'done', type: { kind: 'boolean' } }] });

  await ch.dropCollection('notes');
  assert.equal(dav.calls.at(-1)?.method, 'DELETE');
  assert.equal(dav.calls.at(-1)?.path, '/space/notes/');
  assert.equal('notes' in ch.getSchema(), false);
});

test('structured findObjects runs locally over WebDAV objects', async () => {
  const dav = new FakeWebDAV();
  dav.files.set('/space/tasks/first.json', { body: JSON.stringify({ title: 'First', done: false }), etag: '"v1"' });
  dav.files.set('/space/tasks/second.json', { body: JSON.stringify({ title: 'Second', done: true }), etag: '"v2"' });

  const ch = channel(dav);
  ch._applyResyncData({
    meta: {},
    schema: ch.getSchema(),
    objectLocations: ['/space/tasks/second.json', '/space/tasks/first.json'],
    objectStats: {},
    channel: { createdAt: Date.now(), createdBy: 'user_1', conversations: {} },
  });

  const result = await ch.findObjects({ collection: 'tasks', where: { done: false } });
  assert.deepEqual(result.objects.map((object: RoolObject) => object.location), ['/space/tasks/first.json']);
  assert.equal(result.message, 'Found 1 object.');
});
