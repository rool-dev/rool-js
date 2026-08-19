import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient, type MachineFileUploadProgress } from "../src/index.js";

class FakeXmlHttpRequestUpload {
  onload: ((event: ProgressEvent) => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;
}

class FakeXmlHttpRequest {
  static lastRequest: FakeXmlHttpRequest;
  static completesRequests = true;

  readonly upload = new FakeXmlHttpRequestUpload();
  readonly headers = new Headers();
  method = "";
  url = "";
  body: XMLHttpRequestBodyInit | null = null;
  response: ArrayBuffer | null = null;
  responseType: XMLHttpRequestResponseType = "";
  status = 201;
  statusText = "Created";
  withCredentials = false;
  aborted = false;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  constructor() {
    FakeXmlHttpRequest.lastRequest = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  getAllResponseHeaders(): string {
    return "Content-Type: application/xml; charset=utf-8\r\nPreference-Applied: return=representation\r\n";
  }

  send(body: XMLHttpRequestBodyInit | null): void {
    this.body = body;
    if (!(body instanceof Blob)) throw new Error("Expected a Blob upload");
    if (!FakeXmlHttpRequest.completesRequests) return;

    this.response = new TextEncoder().encode(fileInfoXml())
      .buffer as ArrayBuffer;
    queueMicrotask(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 2,
        total: body.size,
      } as ProgressEvent);
      this.upload.onload?.({
        lengthComputable: true,
        loaded: body.size,
        total: body.size,
      } as ProgressEvent);
      this.onload?.();
    });
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

function installFakeXmlHttpRequest(): () => void {
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "XMLHttpRequest",
  );
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: FakeXmlHttpRequest,
    writable: true,
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, "XMLHttpRequest", previous);
      return;
    }
    Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  };
}

function fileInfoXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/v2/machines/machine-1/dav/rool-drive/file.bin</d:href>
    <d:propstat><d:prop>
      <d:creationdate>2026-03-03T10:00:00.000Z</d:creationdate>
      <d:displayname>file.bin</d:displayname>
      <d:getcontentlength>4</d:getcontentlength>
      <d:getcontenttype>application/octet-stream</d:getcontenttype>
      <d:getetag>&quot;created&quot;</d:getetag>
      <d:getlastmodified>Tue, 03 Mar 2026 10:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
      <r:access xmlns:r="urn:rool:dav">
        <r:current-user><r:read/><r:write/></r:current-user>
        <r:readable-by><r:machine-members/></r:readable-by>
        <r:writable-by><r:machine-editors/></r:writable-by>
      </r:access>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
}

function fileResponse(): Response {
  return new Response(fileInfoXml(), {
    status: 201,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

test("Blob uploads use native browser upload progress", async (context) => {
  context.after(installFakeXmlHttpRequest());
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    getAccessToken: () => "access-token",
  });
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const progress: MachineFileUploadProgress[] = [];

  const result = await client
    .machine("machine-1")
    .files.write("/rool-drive/file.bin", blob, {
      contentType: "application/octet-stream",
      onUploadProgress: (update) => progress.push(update),
    });

  const request = FakeXmlHttpRequest.lastRequest;
  assert.equal(request.method, "PUT");
  assert.equal(
    request.url,
    "https://api.example.test/v2/machines/machine-1/dav/rool-drive/file.bin",
  );
  assert.strictEqual(request.body, blob);
  assert.equal(request.headers.get("Authorization"), "Bearer access-token");
  assert.equal(request.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(request.headers.get("Prefer"), "return=representation");
  assert.deepEqual(progress, [
    { transferredBytes: 0, totalBytes: 4 },
    { transferredBytes: 2, totalBytes: 4 },
    { transferredBytes: 4, totalBytes: 4 },
  ]);
  assert.deepEqual(result, {
    path: "/rool-drive/file.bin",
    name: "file.bin",
    kind: "file",
    size: 4,
    contentType: "application/octet-stream",
    etag: '"created"',
    createdAt: "2026-03-03T10:00:00.000Z",
    lastModified: "Tue, 03 Mar 2026 10:00:00 GMT",
    ownerId: undefined,
    access: {
      currentUser: { read: true, write: true },
      readableBy: ["machine-members"],
      writableBy: ["machine-editors"],
    },
  });
});

test("aborting a native browser upload aborts its request", async (context) => {
  context.after(installFakeXmlHttpRequest());
  FakeXmlHttpRequest.completesRequests = false;
  context.after(() => {
    FakeXmlHttpRequest.completesRequests = true;
  });
  const client = new RoolClient({ apiUrl: "https://api.example.test" });
  const controller = new AbortController();
  let uploadStarted: () => void;
  const started = new Promise<void>((resolve) => {
    uploadStarted = resolve;
  });
  const reason = new Error("cancelled");

  const writing = client
    .machine("machine-1")
    .files.write("/rool-drive/file.bin", new Blob(["body"]), {
      onUploadProgress: ({ transferredBytes }) => {
        if (transferredBytes === 0) uploadStarted();
      },
      signal: controller.signal,
    });
  await started;
  controller.abort(reason);

  await assert.rejects(writing, (error) => error === reason);
  assert.equal(FakeXmlHttpRequest.lastRequest.aborted, true);
});

test("stream uploads report progress through fetch", async () => {
  const received: number[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (_input, init) => {
      assert.ok(init?.body instanceof ReadableStream);
      received.push(
        ...new Uint8Array(await new Response(init.body).arrayBuffer()),
      );
      return fileResponse();
    },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  });
  const progress: MachineFileUploadProgress[] = [];

  await client.machine("machine-1").files.write("/rool-drive/file.bin", body, {
    onUploadProgress: (update) => progress.push(update),
  });

  assert.deepEqual(received, [1, 2, 3, 4, 5]);
  assert.deepEqual(
    progress.map(({ transferredBytes }) => transferredBytes),
    [0, 2, 5],
  );
  assert.equal(
    progress.every((update) => !("totalBytes" in update)),
    true,
  );
});

test("uploads without progress pass the body directly to fetch", async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
  let requestBody: BodyInit | null | undefined;
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (_input, init) => {
      requestBody = init?.body;
      return fileResponse();
    },
  });

  await client.machine("machine-1").files.write("/rool-drive/file.bin", blob);

  assert.strictEqual(requestBody, blob);
});
