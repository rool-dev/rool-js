const MACHINE_URI_RE = /^rool-machine(?::|%3A)(\/.+)$/i;
const ROOL_DRIVE_PREFIX = '/rool-drive/';

export type MachineResource =
  | { kind: 'object'; path: string }
  | { kind: 'file'; path: string };

/**
 * Resolve a Rool machine resource from either a canonical `rool-machine:/...`
 * URI or a bare machine path such as `/rool-drive/...`.
 *
 * Returns null for ordinary strings, malformed machine paths, and unsupported
 * machine areas.
 */
export function resolveMachineResource(input: string): MachineResource | null {
  const path = machinePathFromInput(input);
  if (!path) return null;

  if (path.startsWith(ROOL_DRIVE_PREFIX)) {
    return { kind: 'file', path };
  }

  if (isObjectPath(path)) {
    return { kind: 'object', path };
  }

  return null;
}

function machinePathFromInput(input: string): string | null {
  const match = MACHINE_URI_RE.exec(input);
  const encodedPath = match ? match[1] : input.startsWith('/') ? input : null;
  if (!encodedPath) return null;

  try {
    const path = encodedPath.split('/').map(decodeURIComponent).join('/');
    validateMachinePath(path);
    return path;
  } catch {
    return null;
  }
}

function isObjectPath(path: string): boolean {
  return /^\/space\/[a-zA-Z][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/.test(path);
}

function validateMachinePath(path: string): void {
  if (!path.startsWith('/')) throw new Error('Invalid machine path');
  if (path.includes('\\')) throw new Error('Invalid machine path');
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid machine path');

  const parts = path.split('/').slice(1);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('Invalid machine path');
  }
}
