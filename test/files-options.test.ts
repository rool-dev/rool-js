import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient } from "../src/index.js";

test("file options expose the upload limit for their destination", async () => {
  const paths: string[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      assert.equal(init?.method, "OPTIONS");
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      paths.push(url.pathname);

      const headers = new Headers({
        "Accept-Ranges": "bytes",
        Allow: "OPTIONS, GET, PUT",
        DAV: "1, sync-collection, rool-create-parents",
      });
      if (url.pathname.includes("/rool-drive")) {
        headers.set("Rool-Max-Upload-Bytes", "104857600");
      }
      if (url.pathname.includes("/space")) {
        headers.set("Rool-Max-Upload-Bytes", "26214400");
      }
      return new Response(null, { status: 204, headers });
    },
  });
  const files = client.machine("machine 1").files;

  assert.equal((await files.options()).maxUploadBytes, null);
  assert.equal(
    (await files.options("/rool-drive/report.pdf")).maxUploadBytes,
    104857600,
  );
  assert.equal((await files.options("/space")).maxUploadBytes, 26214400);
  assert.deepEqual(paths, [
    "/v2/machines/machine%201/dav",
    "/v2/machines/machine%201/dav/rool-drive/report.pdf",
    "/v2/machines/machine%201/dav/space",
  ]);
});

test("file options reject an invalid upload limit", async () => {
  const client = new RoolClient({
    fetch: async () =>
      new Response(null, {
        status: 204,
        headers: { "Rool-Max-Upload-Bytes": "many" },
      }),
  });

  await assert.rejects(
    () => client.machine("machine").files.options("/rool-drive"),
    /OPTIONS returned invalid Rool-Max-Upload-Bytes: many/,
  );
});
