import { expect } from 'chai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { RoolSpace } from '../src/space.js';
import type { RoolObject, CollectionDef } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a JSON-LD fixture by name.
 */
export function loadFixture(name: string): unknown {
  const filePath = join(__dirname, 'fixtures', `${name}.jsonld`);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Load a zip archive fixture by name, returns a Blob.
 */
export function loadArchiveFixture(name: string): Blob {
  const filePath = join(__dirname, 'fixtures', `${name}.zip`);
  const buffer = readFileSync(filePath);
  return new Blob([buffer], { type: 'application/zip' });
}

/**
 * Assert that a collection exists in the space schema by exact name.
 */
export function expectCollection(space: RoolSpace, name: string): CollectionDef {
  const schema = space.getSchema();
  expect(schema[name], `Expected collection "${name}" in schema`).to.exist;
  return schema[name];
}

/**
 * Find a collection in the schema whose props include all the given field names.
 * Fails if no matching collection is found.
 */
export function expectCollectionWithFields(space: RoolSpace, fields: string[]): CollectionDef {
  const schema = space.getSchema();
  for (const [name, def] of Object.entries(schema)) {
    const propNames = def.props.map(p => p.name);
    if (fields.every(f => propNames.includes(f))) {
      return def;
    }
  }
  const names = Object.keys(schema).join(', ') || '(none)';
  expect.fail(`No collection with fields [${fields.join(', ')}] found in schema. Collections: ${names}`);
}

/**
 * Assert that all objects have valid, unique URLs in the specified field.
 */
export function expectValidUniqueUrls(objects: RoolObject[], field: string): void {
  const urls: string[] = [];

  for (const obj of objects) {
    const value = obj[field];
    expect(value, `Object ${obj.id} missing ${field}`).to.be.a('string');

    const url = value as string;
    expect(url.trim().length, `Object ${obj.id} has empty ${field}`).to.be.greaterThan(0);

    // Validate URL format
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      expect.fail(`Object ${obj.id} has invalid URL in ${field}: ${url}`);
    }
    expect(parsed!.protocol, `URL should be http(s): ${url}`).to.match(/^https?:$/);

    urls.push(url);
  }

  // Check uniqueness
  const unique = new Set(urls);
  expect(unique.size, `Expected ${objects.length} unique URLs, found ${unique.size}`).to.equal(objects.length);
}

/**
 * Assert that all URLs in the specified field are actually fetchable via space.fetchMedia().
 */
export async function expectUrlsFetchable(space: RoolSpace, objects: RoolObject[], field: string): Promise<void> {
  for (const obj of objects) {
    const url = obj[field] as string;
    if (!url) continue;

    try {
      const response = await space.fetchMedia(url);
      const blob = await response.blob();
      expect(blob.size, `URL returned empty content for ${obj.id}: ${url}`).to.be.greaterThan(0);
    } catch (error) {
      expect.fail(`Failed to fetch URL for ${obj.id}: ${url} - ${error}`);
    }
  }
}
