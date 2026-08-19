import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient } from "../src/index.js";

const ROUTE_CHANGED_HEADER = "Rool-Machine-Route-Changed";

function problemResponse(status: number, headers: HeadersInit = {}): Response {
  return new Response(
    JSON.stringify({
      type: "https://docs.rool.dev/sdk/#problem-test",
      title: "Test response",
      status,
      code: "test",
      detail: "Test response",
    }),
    {
      status,
      headers: {
        "Content-Type": "application/problem+json",
        ...headers,
      },
    },
  );
}

function routeChangedResponse(): Response {
  return problemResponse(421, { [ROUTE_CHANGED_HEADER]: "1" });
}

function uploadStream(bytes: readonly number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

function fileResponse(): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/v2/machines/machine-1/dav/rool-drive/file.bin</d:href>
    <d:propstat><d:prop>
      <d:creationdate>2026-08-16T10:00:00.000Z</d:creationdate>
      <d:displayname>file.bin</d:displayname>
      <d:getcontentlength>3</d:getcontentlength>
      <d:getcontenttype>application/octet-stream</d:getcontenttype>
      <d:getetag>&quot;created&quot;</d:getetag>
      <d:getlastmodified>Sun, 16 Aug 2026 10:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
      <r:access xmlns:r="urn:rool:dav">
        <r:current-user><r:read/><r:write/></r:current-user>
        <r:readable-by><r:machine-members/></r:readable-by>
        <r:writable-by><r:machine-editors/></r:writable-by>
      </r:access>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`,
    {
      status: 201,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    },
  );
}

test("marked 421 retries replay an ordinary request body", async () => {
  const bodies: BodyInit[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (_input, init) => {
      assert.ok(init?.body);
      bodies.push(init.body);
      if (bodies.length === 1) return routeChangedResponse();
      return new Response(JSON.stringify({ name: "Renamed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const settings = await client
    .machine("machine-1")
    .settings.replace({ name: "Renamed" });

  assert.deepEqual(settings, { name: "Renamed" });
  assert.deepEqual(bodies, ['{"name":"Renamed"}', '{"name":"Renamed"}']);
});

test("unmarked and unrelated failures are never retried", async (context) => {
  const cases: Array<[string, () => Response]> = [
    ["unmarked 421", () => problemResponse(421)],
    [
      "wrong marker value",
      () => problemResponse(421, { [ROUTE_CHANGED_HEADER]: "true" }),
    ],
    ["marked 503", () => problemResponse(503, { [ROUTE_CHANGED_HEADER]: "1" })],
  ];

  for (const [name, response] of cases) {
    await context.test(name, async () => {
      let calls = 0;
      const client = new RoolClient({
        apiUrl: "https://api.example.test",
        fetch: async () => {
          calls++;
          return response();
        },
      });

      await assert.rejects(client.machine("machine-1").settings.get());
      assert.equal(calls, 1);
    });
  }
});

test("network failures are never retried", async () => {
  const failure = new TypeError("network failed");
  let calls = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async () => {
      calls++;
      throw failure;
    },
  });

  await assert.rejects(
    client.machine("machine-1").settings.get(),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});

test("aborting during route-change backoff prevents another attempt", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  let calls = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async () => {
      calls++;
      setTimeout(() => controller.abort(reason), 10);
      return routeChangedResponse();
    },
  });

  await assert.rejects(
    client
      .machine("machine-1")
      .files.read("/rool-drive/file.bin", { signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(calls, 1);
});

test("a directly passed ReadableStream is not retried", async () => {
  let calls = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async () => {
      calls++;
      return routeChangedResponse();
    },
  });

  await assert.rejects(
    client
      .machine("machine-1")
      .files.write("/rool-drive/file.bin", uploadStream([1, 2, 3])),
  );
  assert.equal(calls, 1);
});

test("a stream factory creates a fresh upload body for every attempt", async () => {
  const received: number[][] = [];
  const progress: number[] = [];
  let factoryCalls = 0;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (_input, init) => {
      assert.ok(init?.body instanceof ReadableStream);
      received.push([
        ...new Uint8Array(await new Response(init.body).arrayBuffer()),
      ]);
      if (received.length === 1) return routeChangedResponse();
      return fileResponse();
    },
  });

  const written = await client.machine("machine-1").files.write(
    "/rool-drive/file.bin",
    () => {
      factoryCalls++;
      return uploadStream([1, 2, 3]);
    },
    {
      onUploadProgress: ({ transferredBytes }) =>
        progress.push(transferredBytes),
    },
  );

  assert.equal(written.path, "/rool-drive/file.bin");
  assert.equal(factoryCalls, 2);
  assert.deepEqual(received, [
    [1, 2, 3],
    [1, 2, 3],
  ]);
  assert.deepEqual(progress, [0, 3, 0, 3]);
});
