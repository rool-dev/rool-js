import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RoolClient,
  RoolFileError,
  type MachineFileDeleteTarget,
  type MachineFilePath,
} from "../src/index.js";

test("multiple file deletion is bounded and preserves target results", async () => {
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const requestHeaders = new Map<string, Headers>();
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      assert.equal(init?.method, "DELETE");
      requestHeaders.set(url.pathname, new Headers(init?.headers));
      activeRequests++;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests--;

      if (url.pathname.endsWith("/file-3.txt")) {
        return new Response("stale", {
          status: 412,
          statusText: "Precondition Failed",
        });
      }
      return new Response(null, { status: 204 });
    },
  });
  const files = client.machine("machine-1").files;
  const targets: (MachineFilePath | MachineFileDeleteTarget)[] = Array.from(
    { length: 10 },
    (_, index) => `/rool-drive/file-${index}.txt` as MachineFilePath,
  );
  targets[3] = {
    path: "/rool-drive/file-3.txt",
    ifMatch: '"expected"',
  };

  const results = await files.deleteMultiple(targets);

  assert.equal(maximumActiveRequests, 8);
  assert.equal(results.length, targets.length);
  for (const [index, result] of results.entries()) {
    assert.equal(result.path, `/rool-drive/file-${index}.txt`);
    assert.equal(result.ok, index !== 3);
  }
  const failed = results[3];
  assert.equal(failed?.ok, false);
  if (failed?.ok === false) {
    assert.ok(failed.error instanceof RoolFileError);
    assert.equal(failed.error.status, 412);
  }
  assert.equal(
    requestHeaders
      .get("/v2/machines/machine-1/dav/rool-drive/file-3.txt")
      ?.get("If-Match"),
    '"expected"',
  );
});
