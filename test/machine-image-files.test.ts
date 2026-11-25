import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { RoolClient } from "../src/index.js";
import { openArchive } from "../src/machine-image-files.js";

const encoder = new TextEncoder();

function header(name: string, size: number, type: string): Uint8Array {
  const block = new Uint8Array(512);
  block.set(encoder.encode(name).subarray(0, 100));
  block.set(encoder.encode("0000644\0"), 100);
  block.set(encoder.encode(size.toString(8).padStart(11, "0") + "\0"), 124);
  block[156] = type.charCodeAt(0);
  block.set(encoder.encode("ustar\0"), 257);
  block.fill(0x20, 148, 156);
  block.set(encoder.encode(block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 "), 148);
  return block;
}

function entry(name: string, content: string, type = "0"): Uint8Array {
  const data = encoder.encode(content);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return Buffer.concat([header(name, data.length, type), padded]);
}

const pax = (records: Record<string, string>) =>
  Object.entries(records).map(([key, value]) => {
    const body = ` ${key}=${value}\n`;
    let length = body.length + 1;
    while (String(length).length + body.length !== length) length = String(length).length + body.length;
    return `${length}${body}`;
  }).join("");

const longName = "opt/" + "deep/".repeat(40) + "file.txt";
const tar = Buffer.concat([
  entry("etc/", "", "5"),
  entry("./etc/rool/theme.json", '{"mode":"dark"}'),
  entry("etc/hosts", "127.0.0.1 localhost\n"),
  entry("etc/link", "", "2"),
  entry("PaxHeaders/x", pax({ path: longName, mtime: "1795600000.5" }), "x"),
  entry("opt/truncated", "long"),
  entry("././@LongLink", "usr/share/another-long-name\0", "L"),
  entry("usr/share/short", "gnu"),
  new Uint8Array(1024),
]);

test("an archive gives each regular file by its path in the machine", async () => {
  const archive = await openArchive(gzipSync(tar));
  assert.deepEqual(archive.paths, ["/etc/hosts", "/etc/rool/theme.json", "/" + longName, "/usr/share/another-long-name"].sort());
  assert.equal(await archive.text("/etc/rool/theme.json"), '{"mode":"dark"}');
  assert.deepEqual([...(await archive.read("/etc/hosts"))!], [...encoder.encode("127.0.0.1 localhost\n")]);
  assert.equal(archive.size("/etc/hosts"), 20);
  assert.equal(await archive.text("/" + longName), "long");
  assert.equal(await archive.text("/usr/share/another-long-name"), "gnu");
  assert.equal(await archive.read("/etc"), undefined);
  assert.equal(await archive.read("/etc/link"), undefined);
  assert.equal(archive.size("/etc/link"), undefined);
  assert.deepEqual((await openArchive(new Uint8Array(0))).paths, []);
});

test("a file is read whatever the size of the pieces the archive unpacks in, and the last of a path wins", async () => {
  const big = "x".repeat(200_000);
  const archive = await openArchive(gzipSync(Buffer.concat([
    entry("var/big", big),
    entry("etc/twice", "first"),
    entry("etc/twice", "second"),
    new Uint8Array(1024),
  ])));
  assert.equal(await archive.text("/var/big"), big);
  assert.equal(await archive.text("/etc/twice"), "second");
  assert.equal(archive.size("/etc/twice"), 6);
  assert.deepEqual(archive.paths, ["/etc/twice", "/var/big"]);
});

test("a file an archive names but ends before reads as absent, and what is no archive fails", async () => {
  const cut = await openArchive(gzipSync(Buffer.concat([entry("etc/a", "a"), header("etc/b", 900, "0")])));
  assert.equal(await cut.text("/etc/a"), "a");
  assert.equal(await cut.read("/etc/b"), undefined);
  await assert.rejects(openArchive(new Uint8Array([1, 2, 3, 4])));
  // A gzip of something that is no tar is not listed as files.
  await assert.rejects(openArchive(gzipSync(Buffer.from("just some text, long enough to fill a block ".repeat(20)))), /cannot be read/);
});

test("a revision's and a listed machine image's files are fetched as their archive", async () => {
  const paths: string[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input) => {
      const { pathname } = new URL(String(input));
      paths.push(pathname);
      if (pathname.includes("/revisions/1/")) {
        return Response.json({ type: "about:blank", title: "Machine image", status: 404, code: "machine_image_no_files", detail: "The revision has no files." }, { status: 404, headers: { "Content-Type": "application/problem+json" } });
      }
      return new Response(gzipSync(tar), { headers: { "Content-Type": "application/gzip" } });
    },
  });
  assert.equal(await (await client.machineImage("img/1").files(2)).text("/etc/hosts"), "127.0.0.1 localhost\n");
  assert.equal((await client.hub.machineImages.files("hub/1")).paths.length, 4);
  assert.deepEqual((await client.machineImage("img/1").files(1)).paths, []);
  assert.deepEqual(paths, [
    "/v2/machine-images/img%2F1/revisions/2/files",
    "/v2/hub/machine-images/hub%2F1/files",
    "/v2/machine-images/img%2F1/revisions/1/files",
  ]);
});
