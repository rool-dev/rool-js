import { isLocation } from './locations.js';

export const MACHINE_REF_SCHEME = 'rool-machine:' as const;
export const MACHINE_REF_PREFIX = 'rool-machine:/' as const;

export type MachineRef = `${typeof MACHINE_REF_PREFIX}${string}`;

export type ResolvedMachineRef =
  | { kind: 'object'; uri: MachineRef; path: string; location: string }
  | { kind: 'file'; uri: MachineRef; path: string; filePath: string }
  | { kind: 'unsupported'; uri: MachineRef; path: string };

/** Build a canonical `rool-machine:` URI for an absolute machine path. */
export function machineRef(path: string): MachineRef {
  validateMachinePath(path);
  return `${MACHINE_REF_SCHEME}${encodeMachinePath(path)}` as MachineRef;
}

/** Parse a `rool-machine:` URI and return its absolute machine path. */
export function parseMachineRef(uri: string): string {
  if (!uri.startsWith(MACHINE_REF_SCHEME)) {
    throw new Error('Invalid machine ref: expected rool-machine: URI');
  }

  const encodedPath = uri.slice(MACHINE_REF_SCHEME.length);
  if (!encodedPath.startsWith('/')) {
    throw new Error('Invalid machine ref: expected absolute path');
  }

  const path = encodedPath.split('/').map(decodeURIComponent).join('/');
  validateMachinePath(path);
  return path;
}

/** Classify a valid `rool-machine:` URI for the current SDK capability set. */
export function resolveMachineRef(uri: string): ResolvedMachineRef {
  const path = parseMachineRef(uri);
  const ref = machineRef(path);

  const isObjectPath: boolean = isLocation(path);
  if (isObjectPath) {
    return { kind: 'object', uri: ref, path, location: path };
  }

  if (path.startsWith('/rool-drive/')) {
    return {
      kind: 'file',
      uri: ref,
      path,
      filePath: path.slice('/rool-drive/'.length),
    };
  }

  return { kind: 'unsupported', uri: ref, path };
}

/**
 * Classify a machine link as it appears in browser/Markdown href attributes.
 * Returns null for non-machine links and invalid machine links.
 */
export function resolveMachineHref(href: string): ResolvedMachineRef | null {
  const match = /^rool-machine(?::|%3A)(\/.+)$/i.exec(href);
  if (!match) return null;

  try {
    return resolveMachineRef(`${MACHINE_REF_SCHEME}${match[1]}`);
  } catch {
    return null;
  }
}

function validateMachinePath(path: string): void {
  if (!path.startsWith('/')) throw new Error('Invalid machine path: expected absolute path');
  if (path.includes('\\')) throw new Error('Invalid machine path');
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid machine path');

  const parts = path.split('/').slice(1);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('Invalid machine path');
  }
}

function encodeMachinePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
