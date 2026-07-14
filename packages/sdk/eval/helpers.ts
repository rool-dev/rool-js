import { expect } from 'chai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { RoolSpace } from '../src/space.js';
import type { RoolObject, CollectionDef, CollectionOptions, FieldDef } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a zip archive fixture by name, returns a Blob.
 */
export function loadArchiveFixture(name: string): Blob {
  const filePath = join(__dirname, 'fixtures', `${name}.zip`);
  const buffer = readFileSync(filePath);
  return new Blob([buffer], { type: 'application/zip' });
}

/**
 * Build a canonical object path for the current SDK object API.
 */
export function objectPath(collection: string, basename: string): string {
  return `/space/${collection}/${basename}.json`;
}

/**
 * Return an object's collection name from its canonical path.
 */
export function collectionOf(objectOrPath: RoolObject | string): string {
  const path = typeof objectOrPath === 'string' ? objectOrPath : objectOrPath.path;
  return path.split('/')[2] ?? '';
}

/**
 * List object JSON paths through the current WebDAV-backed SDK surface.
 */
export async function listObjectPaths(space: RoolSpace): Promise<string[]> {
  const result = await space.webdav.propfind('/space', {
    depth: 'infinity',
    props: ['resourcetype'],
  });

  return result.responses
    .filter(response => !response.isCollection)
    .map(response => response.path)
    .filter(path => /^\/space\/[^/]+\/[^/]+\.json$/.test(path) && !path.endsWith('/.schema.json'))
    .sort();
}

/**
 * Load all current objects in a space.
 */
export async function listObjects(space: RoolSpace): Promise<RoolObject[]> {
  const paths = await listObjectPaths(space);
  if (paths.length === 0) return [];
  const result = await space.getObjects(paths);
  return result.objects.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Parse a JSON structured prompt response. Tolerates markdown code fences.
 */
export function parseJsonMessage<T = unknown>(message: string): T {
  const trimmed = message.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  return JSON.parse(candidate) as T;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type CollectionCreator = {
  createCollection(name: string, fields: FieldDef[] | CollectionDef, options?: CollectionOptions): Promise<CollectionDef>;
};

/**
 * Create a collection with a small retry loop for local eval server transient WebDAV 500s.
 */
export async function createCollectionWithRetry(
  target: CollectionCreator,
  name: string,
  fields: FieldDef[] | CollectionDef,
  options?: CollectionOptions,
): Promise<CollectionDef> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await target.createCollection(name, fields, options);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('500') && !message.includes('Internal Server Error')) throw error;
      await delay(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * Assert that a collection exists in the space schema by exact name.
 */
export async function expectCollection(space: RoolSpace, name: string): Promise<CollectionDef> {
  const schema = await space.readSchema();
  expect(schema[name], `Expected collection "${name}" in schema`).to.exist;
  return schema[name];
}

/**
 * Find a collection in the schema whose fields include all the given field names.
 * Fails if no matching collection is found.
 */
export async function expectCollectionWithFields(space: RoolSpace, fields: string[]): Promise<CollectionDef> {
  const schema = await space.readSchema();
  for (const [, def] of Object.entries(schema)) {
    const fieldNames = def.fields.map(f => f.name);
    if (fields.every(f => fieldNames.includes(f))) {
      return def;
    }
  }
  const names = Object.keys(schema).join(', ') || '(none)';
  expect.fail(`No collection with fields [${fields.join(', ')}] found in schema. Collections: ${names}`);
}

/**
 * Assert that all objects have valid, unique URLs in the specified body field.
 */
export function expectValidUniqueUrls(objects: RoolObject[], field: string): void {
  const urls: string[] = [];

  for (const obj of objects) {
    const value = obj.body[field];
    expect(value, `Object ${obj.path} missing ${field}`).to.be.a('string');

    const url = value as string;
    expect(url.trim().length, `Object ${obj.path} has empty ${field}`).to.be.greaterThan(0);

    // Validate URL format
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      expect.fail(`Object ${obj.path} has invalid URL in ${field}: ${url}`);
    }
    expect(parsed!.protocol, `URL should be http(s): ${url}`).to.match(/^https?:$/);

    urls.push(url);
  }

  // Check uniqueness
  const unique = new Set(urls);
  expect(unique.size, `Expected ${objects.length} unique URLs, found ${unique.size}`).to.equal(objects.length);
}

/**
 * Assert that all URLs in the specified body field are fetchable.
 */
export async function expectUrlsFetchable(space: RoolSpace, objects: RoolObject[], field: string): Promise<void> {
  for (const obj of objects) {
    const url = obj.body[field] as string;
    if (!url) continue;

    try {
      const response = await space.fetch(url);
      const blob = await response.blob();
      expect(blob.size, `URL returned empty content for ${obj.path}: ${url}`).to.be.greaterThan(0);
    } catch (error) {
      expect.fail(`Failed to fetch URL for ${obj.path}: ${url} - ${error}`);
    }
  }
}
