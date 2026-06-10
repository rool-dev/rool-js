// =============================================================================
// Object location helpers
//
// An object lives at a "location" — a path of the form
// `/space/<collection>/<basename>.json`. The collection is the parent
// directory; the basename is the filename without `.json`. The two together
// fully identify the object inside its space.
//
// Functions here normalize user-provided strings, parse locations into their
// parts, and build canonical locations from validated parts.
// =============================================================================

const COLLECTION_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const BASENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const FULL_LOCATION_RE = /^\/space\/([^/]+)\/([^/]+)\.json$/;

export interface ParsedLocation {
  collection: string;
  basename: string;
}

/**
 * Build a canonical location string from a collection and basename.
 * Validates both parts. Throws on invalid input.
 */
export function loc(collection: string, basename: string): string {
  if (!COLLECTION_RE.test(collection)) {
    throw new Error(`Invalid collection "${collection}". Must start with a letter and contain only alphanumeric characters, hyphens, and underscores.`);
  }
  if (!BASENAME_RE.test(basename)) {
    throw new Error(`Invalid basename "${basename}". Must start with an alphanumeric character and contain only alphanumeric characters, hyphens, and underscores.`);
  }
  return `/space/${collection}/${basename}.json`;
}

/**
 * Parse a canonical location string into its collection and basename.
 * Throws on malformed input. Use {@link normalizeLocation} first if the
 * input might be a short form like `"article/welcome"`.
 */
export function parseLocation(location: string): ParsedLocation {
  const match = FULL_LOCATION_RE.exec(location);
  if (!match) throw new Error(`Invalid location "${location}". Expected /space/<collection>/<basename>.json.`);
  const [, collection, basename] = match;
  if (!COLLECTION_RE.test(collection) || !BASENAME_RE.test(basename)) {
    throw new Error(`Invalid location "${location}".`);
  }
  return { collection, basename };
}

/**
 * Normalize a user-provided location to the canonical full form.
 *
 * Accepts:
 * - `/space/<collection>/<basename>.json` — canonical
 * - `<collection>/<basename>` — short form
 * - `<collection>/<basename>.json` — short form with extension
 *
 * Always returns the canonical form. Throws on malformed input.
 */
export function normalizeLocation(input: string): string {
  if (input.startsWith('/space/')) {
    parseLocation(input); // validate
    return input;
  }
  // Short form: "collection/basename" or "collection/basename.json"
  const stripped = input.endsWith('.json') ? input.slice(0, -5) : input;
  const slash = stripped.indexOf('/');
  if (slash <= 0 || stripped.indexOf('/', slash + 1) !== -1) {
    throw new Error(`Invalid location "${input}". Expected /space/<collection>/<basename>.json or <collection>/<basename>.`);
  }
  return loc(stripped.slice(0, slash), stripped.slice(slash + 1));
}

/** Return true if `input` is a syntactically valid (full or short) location. */
export function isLocation(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  try {
    normalizeLocation(input);
    return true;
  } catch {
    return false;
  }
}
