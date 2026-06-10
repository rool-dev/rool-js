import assert from 'node:assert/strict';
import test from 'node:test';
import { RoolChannel } from '../src/channel.js';
import type { RoolWebDAV, WebDAVRequestInit, WebDAVWriteResult } from '../src/webdav.js';
import type { GraphQLClient } from '../src/graphql.js';
import type { RestClient } from '../src/rest.js';
import type { Channel } from '../src/types.js';

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

class FakeRestClient {
  calls: string[][] = [];

  async getObjects(_spaceId: string, locations: string[]) {
    this.calls.push(locations);
    return {
      objects: locations
        .filter((location) => !location.includes('/missing-'))
        .map((location) => ({
          path: location,
          body: { path: location },
        })),
      missing: locations.filter((location) => location.includes('/missing-')),
    };
  }
}

function channel(dav: FakeWebDAV, rest: RestClient = {} as RestClient): RoolChannel {
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
    objectStats: {},
    schema: { tasks: { fields: [{ name: 'title', type: { kind: 'string' } }] } },
    meta: {},
    channel: rawChannel,
    channelId: 'main',
    graphqlClient: graphql,
    restClient: rest,
    webdav: dav as unknown as RoolWebDAV,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onClose: () => {},
  });
}

test('channel object CRUD uses object WebDAV instead of GraphQL', async () => {
  const dav = new FakeWebDAV();
  const ch = channel(dav);

  const created = await ch.putObject('/space/tasks/first.json', { title: 'First' });
  assert.deepEqual(created.object, {
    path: '/space/tasks/first.json',
    body: { title: 'First' },
  });
  assert.deepEqual(JSON.parse(dav.files.get('/space/tasks/first.json')!.body), { title: 'First' });

  const headers = new Headers((dav.calls[0].init as { headers: HeadersInit }).headers);
  assert.equal(dav.calls[0].method, 'PUT');
  assert.equal(dav.calls[0].path, '/space/tasks/first.json');
  assert.equal(headers.get('X-Rool-Channel-Id'), 'main');
  assert.equal(headers.get('X-Rool-Conversation-Id'), 'default');

  const loaded = await ch.getObject('/space/tasks/first.json');
  assert.equal(loaded?.body.title, 'First');

  const updated = await ch.patchObject('/space/tasks/first.json', {
    data: { title: 'Updated', done: false, obsolete: null },
  });
  assert.deepEqual(updated.object.body, { title: 'Updated', done: false });

  const moved = await ch.moveObject('/space/tasks/first.json', '/space/tasks/renamed.json');
  assert.equal(moved.object.path, '/space/tasks/renamed.json');
  assert.equal(dav.files.has('/space/tasks/first.json'), false);
  assert.equal(dav.files.has('/space/tasks/renamed.json'), true);

  await ch.deleteObjects(['/space/tasks/renamed.json']);
  assert.equal(dav.files.has('/space/tasks/renamed.json'), false);
});

test('channel getObjects normalizes machine paths, dedupes, chunks, and preserves missing paths', async () => {
  const rest = new FakeRestClient();
  const ch = channel(new FakeWebDAV(), rest as unknown as RestClient);
  const locations = [
    '/space/tasks/first.json',
    '/space/tasks/first.json',
    '/space/tasks/missing-one.json',
    ...Array.from({ length: 499 }, (_, i) => `/space/tasks/item-${i}.json`),
  ];

  const result = await ch.getObjects(locations);

  assert.equal(rest.calls.length, 2);
  assert.equal(rest.calls[0].length, 500);
  assert.equal(rest.calls[1].length, 1);
  assert.equal(rest.calls[0][0], '/space/tasks/first.json');
  assert.equal(rest.calls[0][1], '/space/tasks/missing-one.json');
  assert.equal(result.objects[0].path, '/space/tasks/first.json');
  assert.deepEqual(result.missing, ['/space/tasks/missing-one.json']);
});

test('channel object paths reject dotfiles and nested paths', async () => {
  const rest = new FakeRestClient();
  const ch = channel(new FakeWebDAV(), rest as unknown as RestClient);

  await assert.rejects(() => ch.getObject('/space/.meta.json'), /Object path must be/);
  await assert.rejects(() => ch.getObjects(['/space/tasks/.schema.json']), /Object path must be/);
  await assert.rejects(() => ch.putObject('/space/tasks/nested/first.json', { title: 'Nested' }), /Object path must be/);
  assert.equal(rest.calls.length, 0);
});

test('channel collection schema writes use object WebDAV', async () => {
  const dav = new FakeWebDAV();
  const ch = channel(dav);

  await ch.createCollection('notes', [{ name: 'title', type: { kind: 'string' } }], { schemaOrgType: 'CreativeWork' });
  assert.equal(dav.calls[0].method, 'MKCOL');
  assert.equal(dav.calls[0].path, '/space/notes');
  assert.equal(dav.calls[1].method, 'PUT');
  assert.equal(dav.calls[1].path, '/space/notes/.schema.json');
  assert.deepEqual(ch.getSchema().notes, { fields: [{ name: 'title', type: { kind: 'string' } }], schemaOrgType: 'CreativeWork' });

  await ch.alterCollection('notes', { fields: [{ name: 'done', type: { kind: 'boolean' } }], schemaOrgType: 'Action' });
  assert.deepEqual(JSON.parse(dav.files.get('/space/notes/.schema.json')!.body), { fields: [{ name: 'done', type: { kind: 'boolean' } }], schemaOrgType: 'Action' });

  await ch.dropCollection('notes');
  assert.equal(dav.calls.at(-1)?.method, 'DELETE');
  assert.equal(dav.calls.at(-1)?.path, '/space/notes');
  assert.equal('notes' in ch.getSchema(), false);
});
