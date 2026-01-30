import type { RoolSpaceData } from './types.js';

export interface JsonLdDocument {
  '@context': {
    '@vocab': string;
    id: string;
  };
  '@graph': JsonLdNode[];
}

export interface JsonLdNode {
  id: string;
  [key: string]: unknown;
}

export interface ParsedImport {
  objects: Array<{
    id: string;
    data: Record<string, unknown>;
    relations: Array<{ relation: string; targetId: string }>;
  }>;
}

/**
 * Convert space data to JSON-LD format.
 * Filters out orphan links (links to non-existent objects) to ensure clean exports.
 */
export function toJsonLd(data: RoolSpaceData): JsonLdDocument {
  const objectIds = new Set(Object.keys(data.objects));

  const graph = Object.values(data.objects).map(entry => {
    const node: JsonLdNode = { ...entry.data } as JsonLdNode;

    // Add relations as arrays of target IDs, filtering out orphans
    for (const [relation, targets] of Object.entries(entry.links)) {
      const validTargets = targets.filter(id => objectIds.has(id));
      if (validTargets.length > 0) {
        node[relation] = validTargets;
      }
    }

    return node;
  });

  return {
    '@context': {
      '@vocab': 'https://rool.dev/schema/',
      'id': '@id',
    },
    '@graph': graph,
  };
}

/**
 * Parse JSON-LD into objects and relations for import.
 *
 * Uses two-pass parsing to distinguish relations from data:
 * - First pass: collect all object IDs in the graph
 * - Second pass: string arrays where ALL values are valid object IDs are treated as relations;
 *   otherwise they are treated as data fields
 */
export function fromJsonLd(jsonld: unknown): ParsedImport {
  if (typeof jsonld !== 'object' || jsonld === null) {
    throw new Error('Invalid JSON-LD: expected object');
  }

  const doc = jsonld as Record<string, unknown>;
  const graph = doc['@graph'];
  if (!Array.isArray(graph)) {
    throw new Error('Invalid JSON-LD: missing @graph array');
  }

  // First pass: collect all object IDs
  const objectIds = new Set<string>();
  for (const node of graph) {
    if (typeof node !== 'object' || node === null) continue;
    const nodeObj = node as Record<string, unknown>;
    const id = nodeObj.id as string;
    if (id) {
      objectIds.add(id);
    }
  }

  // Second pass: parse objects and distinguish relations from data
  const objects: ParsedImport['objects'] = [];

  for (const node of graph) {
    if (typeof node !== 'object' || node === null) continue;
    const nodeObj = node as Record<string, unknown>;

    const id = nodeObj.id as string;
    if (!id) {
      throw new Error('Invalid JSON-LD: object missing id');
    }

    const data: Record<string, unknown> = { id };
    const relations: Array<{ relation: string; targetId: string }> = [];

    for (const [key, value] of Object.entries(nodeObj)) {
      if (key === 'id' || key.startsWith('@')) continue;

      // Check if value is an array of strings where ALL values are valid object IDs
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(v => typeof v === 'string' && objectIds.has(v))
      ) {
        // All values are object IDs - treat as relations
        for (const targetId of value) {
          relations.push({ relation: key, targetId });
        }
      } else {
        // Not all values are object IDs - treat as data
        data[key] = value;
      }
    }

    objects.push({ id, data, relations });
  }

  return { objects };
}

/**
 * Recursively find all string values in a JSON-LD document.
 * Used to detect media URLs for archive export.
 */
export function findAllStrings(doc: JsonLdDocument): Set<string> {
  const strings = new Set<string>();

  function scan(value: unknown): void {
    if (typeof value === 'string') {
      strings.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        scan(item);
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) {
        scan(v);
      }
    }
  }

  scan(doc['@graph']);
  return strings;
}

/**
 * Rewrite string values in a JSON-LD document using a mapping.
 * Returns a new document (does not mutate the original).
 */
export function rewriteStrings(
  doc: JsonLdDocument,
  mapping: Map<string, string>
): JsonLdDocument {
  function rewrite(value: unknown): unknown {
    if (typeof value === 'string') {
      return mapping.get(value) ?? value;
    } else if (Array.isArray(value)) {
      return value.map(rewrite);
    } else if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = rewrite(v);
      }
      return result;
    }
    return value;
  }

  return {
    '@context': doc['@context'],
    '@graph': rewrite(doc['@graph']) as JsonLdNode[],
  };
}
