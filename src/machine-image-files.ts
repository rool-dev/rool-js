import { RoolProblem } from "./problem.js";

/** The files of a machine image revision, read from its archive. The archive
 *  stays compressed in memory; a file is unpacked when it is read. */
export interface MachineImageArchive {
  /** The path of every regular file, as in the machine (`/etc/rool/theme.json`), sorted. */
  readonly paths: readonly string[];
  /** A file's size in bytes; undefined for a path that is no regular file in it. */
  size(path: string): number | undefined;
  /** A file's bytes; undefined for a path that is no regular file in it. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** A file as UTF-8 text. */
  text(path: string): Promise<string | undefined>;
}

// What the server stores at most, and a little.
const ARCHIVE_MAX_BYTES = 17 * 1024 * 1024;
// One file is unpacked whole to be shown; a larger one is not for showing.
const FILE_MAX_BYTES = 64 * 1024 * 1024;
// An archive that unpacks to more than this is not walked to its end.
const UNPACKED_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const BLOCK = 512;

/** Fetches a revision's archive and indexes it. A revision without files reads as empty. */
export async function fetchMachineImageArchive(
  request: () => Promise<Response>,
): Promise<MachineImageArchive> {
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (error instanceof RoolProblem && error.code === "machine_image_no_files") return openArchive(new Uint8Array(0));
    throw error;
  }
  const tooLarge = () => new Error("The machine image files are too large to open");
  if (Number(response.headers.get("Content-Length")) > ARCHIVE_MAX_BYTES) throw tooLarge();
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (compressed.length > ARCHIVE_MAX_BYTES) throw tooLarge();
  return openArchive(compressed);
}

const decoder = new TextDecoder();

// The unpacked archive as it comes, a piece at a time: nothing is kept but what is taken.
class Unpacking {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array(0);
  private at = 0;
  private total = 0;

  constructor(compressed: Uint8Array) {
    const gunzip = new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>;
    this.reader = new Blob([compressed as BlobPart]).stream().pipeThrough(gunzip).getReader();
  }

  private async more(): Promise<boolean> {
    const { done, value } = await this.reader.read();
    if (done) return false;
    this.total += value.length;
    if (this.total > UNPACKED_MAX_BYTES) throw new Error("The machine image files are too large to open");
    this.chunk = value;
    this.at = 0;
    return true;
  }

  /** The next `length` bytes; null when the archive ends first. */
  async take(length: number): Promise<Uint8Array | null> {
    const out = new Uint8Array(length);
    for (let filled = 0; filled < length; ) {
      if (this.at === this.chunk.length && !(await this.more())) return null;
      const part = this.chunk.subarray(this.at, this.at + (length - filled));
      out.set(part, filled);
      filled += part.length;
      this.at += part.length;
    }
    return out;
  }

  /** False when the archive ends first. */
  async skip(length: number): Promise<boolean> {
    for (let left = length; left > 0; ) {
      if (this.at === this.chunk.length && !(await this.more())) return false;
      const step = Math.min(left, this.chunk.length - this.at);
      this.at += step;
      left -= step;
    }
    return true;
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => {});
  }
}

function field(block: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && block[end] !== 0) end++;
  return decoder.decode(block.subarray(start, end));
}

// A pax extended header: records of "<length> <key>=<value>\n".
function paxRecords(data: Uint8Array): Record<string, string> {
  const records: Record<string, string> = {};
  for (let at = 0; at < data.length; ) {
    let space = at;
    while (space < data.length && data[space] !== 0x20) space++;
    const length = Number(decoder.decode(data.subarray(at, space)));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = decoder.decode(data.subarray(space + 1, at + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
  return records;
}

// A tar header carries the sum of its own bytes, with the sum's field read as spaces. What
// is not a tar fails here, and is not listed as files.
function isHeader(block: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return parseInt(field(block, 148, 8).trim(), 8) === sum;
}

// As the machine has it: rooted, without "./" or a directory's trailing slash.
const machinePath = (name: string): string => "/" + name.replace(/^\.?\/+/, "").replace(/\/+$/, "");

// Records that only name the next entry are small; one that claims more is not read.
const NAME_RECORD_MAX_BYTES = 1024 * 1024;

// Walks a tar (ustar, with the pax and GNU records for long names) from its start. `visit`
// sees each regular file, with its place among them, and says whether its bytes are wanted;
// `taken` gets them, and a true answer ends the walk there.
async function walk(
  compressed: Uint8Array,
  visit: (path: string, size: number, index: number) => boolean,
  taken: (data: Uint8Array) => boolean,
): Promise<void> {
  if (compressed.length === 0) return;
  const tar = new Unpacking(compressed);
  try {
    let next: { path?: string; size?: number } = {};
    let index = 0;
    for (;;) {
      const header = await tar.take(BLOCK);
      if (!header || header.every((byte) => byte === 0)) return;
      if (!isHeader(header)) throw new Error("The machine image files cannot be read");
      const type = String.fromCharCode(header[156] || 0x30);
      const ownSize = parseInt(field(header, 124, 12).trim() || "0", 8) || 0;
      // A pax size is for the entry the records describe, not for another record before it.
      const size = "xLgK".includes(type) ? ownSize : (next.size ?? ownSize);
      const padding = Math.ceil(size / BLOCK) * BLOCK - size;
      if (type === "x" || type === "L") {
        if (size > NAME_RECORD_MAX_BYTES) throw new Error("The machine image files cannot be read");
        const data = await tar.take(size);
        if (!data || !(await tar.skip(padding))) return;
        if (type === "L") next = { ...next, path: field(data, 0, data.length) };
        else {
          const records = paxRecords(data);
          next = { path: records.path, size: records.size === undefined ? undefined : Number(records.size) };
        }
        continue;
      }
      const prefix = field(header, 345, 155);
      const name = next.path ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
      const regular = type === "0" || type === "7";
      if (type !== "g" && type !== "K") next = {};
      const path = machinePath(name);
      if (regular && visit(path, size, index++)) {
        if (size > FILE_MAX_BYTES) throw new Error(`${path} is too large to open`);
        const data = await tar.take(size);
        if (!data || taken(data)) return;
        if (!(await tar.skip(padding))) return;
      } else if (!(await tar.skip(size + padding))) return;
    }
  } finally {
    await tar.close();
  }
}

/** Indexes a gzipped tar. Nothing of it is unpacked for keeping until a file is read. */
export async function openArchive(compressed: Uint8Array): Promise<MachineImageArchive> {
  // A path can come more than once; the last is the one an unpacking leaves.
  const files = new Map<string, { size: number; index: number }>();
  await walk(compressed, (path, size, index) => { files.set(path, { size, index }); return false; }, () => false);
  const paths = [...files.keys()].sort();
  const read = async (path: string): Promise<Uint8Array | undefined> => {
    const file = files.get(path);
    if (!file) return undefined;
    let found: Uint8Array | undefined;
    // Unpacks up to the file and no further.
    await walk(compressed, (_path, _size, index) => index === file.index, (data) => { found = data; return true; });
    return found;
  };
  return {
    paths,
    size: (path) => files.get(path)?.size,
    read,
    text: async (path) => {
      const data = await read(path);
      return data === undefined ? undefined : decoder.decode(data);
    },
  };
}
