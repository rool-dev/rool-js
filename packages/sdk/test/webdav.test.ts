import assert from 'node:assert/strict';
import test from 'node:test';
import { RoolWebDAV } from '../src/webdav.js';
import type { AuthManager } from '../src/auth.js';

function auth(): AuthManager {
  return {
    getTokens: async () => ({ accessToken: 'access-token', roolToken: 'rool-token' }),
  } as AuthManager;
}

test('WebDAV URLs use machine paths', () => {
  const dav = new RoolWebDAV({ webdavUrl: 'https://api.test/', spaceId: 'sp ace', authManager: auth() });

  assert.equal(dav.href('/rool-drive/docs/report.pdf'), '/space/sp%20ace/rool-drive/docs/report.pdf');
  assert.equal(dav.href('/rool-drive/docs', { collection: true }), '/space/sp%20ace/rool-drive/docs/');
  assert.equal(dav.url('/rool-drive/docs/report.pdf'), 'https://api.test/space/sp%20ace/rool-drive/docs/report.pdf');
});

test('WebDAV root path addresses the aggregate space WebDAV root', () => {
  const dav = new RoolWebDAV({ webdavUrl: 'https://api.test/node/1/', spaceId: 'sp_123', authManager: auth() });

  assert.equal(dav.href('/'), '/space/sp_123/');
  assert.equal(dav.url('/'), 'https://api.test/node/1/space/sp_123/');
});

test('WebDAV maps machine /space paths to the object WebDAV root', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 201, headers: { ETag: '"v1"' } });
  }) as typeof fetch;

  try {
    const dav = new RoolWebDAV({
      webdavUrl: 'https://api.test',
      spaceId: 'sp_123',
      authManager: auth(),
    });

    const result = await dav.put('/space/tasks/task-one.json', JSON.stringify({ title: 'Task' }), {
      contentType: 'application/json',
      ifNoneMatch: '*',
    });

    assert.equal(result.etag, '"v1"');
    assert.equal(calls[0].url, 'https://api.test/space/sp_123/space/tasks/task-one.json');
    assert.equal(calls[0].init.method, 'PUT');
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer access-token');
    assert.equal(headers.get('X-Rool-Token'), 'rool-token');
    assert.equal(headers.get('If-None-Match'), '*');
    assert.equal(headers.get('Content-Type'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WebDAV retries shard refusal against the rerouted base URL', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push(`${String(init?.method)} ${String(url)}`);
    return new Response(null, { status: calls.length === 1 ? 421 : 200 });
  }) as typeof fetch;

  try {
    const dav = new RoolWebDAV({
      webdavUrl: 'https://api.test/node/old',
      spaceId: 'sp_123',
      authManager: auth(),
      onRefused: async () => 'https://api.test/node/new',
    });

    await dav.head('/space/tasks/task-one.json');
    assert.deepEqual(calls, [
      'HEAD https://api.test/node/old/space/sp_123/space/tasks/task-one.json',
      'HEAD https://api.test/node/new/space/sp_123/space/tasks/task-one.json',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WebDAV reroutes an idempotent request when the node fetch throws opaquely', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push(`${String(init?.method)} ${String(url)}`);
    // A node that rolled fully away rejects the fetch (LB 5xx has no CORS), so
    // there's no readable status — only a throw.
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const dav = new RoolWebDAV({
      webdavUrl: 'https://api.test/node/old',
      spaceId: 'sp_123',
      authManager: auth(),
      onRefused: async () => 'https://api.test/node/new',
    });

    await dav.head('/rool-drive/Ostemadder/illustration.png');
    assert.deepEqual(calls, [
      'HEAD https://api.test/node/old/space/sp_123/rool-drive/Ostemadder/illustration.png',
      'HEAD https://api.test/node/new/space/sp_123/rool-drive/Ostemadder/illustration.png',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WebDAV does not retry a non-idempotent method on an opaque throw', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push(`${String(init?.method)} ${String(url)}`);
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;

  try {
    const dav = new RoolWebDAV({
      webdavUrl: 'https://api.test/node/old',
      spaceId: 'sp_123',
      authManager: auth(),
      onRefused: async () => 'https://api.test/node/new',
    });

    // MKCOL isn't safe to re-send blindly, so the throw propagates after one try.
    await assert.rejects(dav.request('MKCOL', '/rool-drive/docs', { collection: true }), /Failed to fetch/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PROPFIND parses new server hrefs back to root-relative paths', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/space/sp_123/space/tasks/</d:href>
        <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
      </d:response>
      <d:response>
        <d:href>/space/sp_123/space/tasks/task-one.json</d:href>
        <d:propstat><d:prop><d:getetag>"v1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
      </d:response>
    </d:multistatus>`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(xml, { status: 207 })) as typeof fetch;

  try {
    const dav = new RoolWebDAV({ webdavUrl: 'https://api.test', spaceId: 'sp_123', authManager: auth() });
    const result = await dav.propfind('/space/tasks/', { depth: '1' });

    assert.deepEqual(result.responses.map((r) => r.path), ['/space/tasks', '/space/tasks/task-one.json']);
    assert.equal(result.responses[0].isCollection, true);
    assert.equal(result.responses[1].props.getetag, '"v1"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
