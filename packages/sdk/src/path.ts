const MACHINE_URI_RE = /^rool-machine(?::|%3A)(.*)$/i;

export function machinePath(input: string, ctx: { spaceId?: string } = {}): string {
  let value = input.trim();
  const machine = MACHINE_URI_RE.exec(value);
  if (machine) value = machine[1] || '/';

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    value = new URL(value).pathname;
  }

  let parts = value.split('/').filter(Boolean).map(decodePart);
  if (ctx.spaceId && parts[0] === 'space' && parts[1] === ctx.spaceId) {
    parts = parts.slice(2);
  } else if (ctx.spaceId && parts[0] === 'dav' && parts[1] === ctx.spaceId) {
    parts = ['rool-drive', ...parts.slice(2)];
  }

  const path = parts.length ? `/${parts.join('/')}` : '/';
  if (path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) {
    throw new Error('Invalid machine path');
  }
  return path;
}

export function isObjectPath(input: string): boolean {
  try {
    const parts = machinePath(input).split('/').filter(Boolean);
    return (
      parts.length === 3 &&
      parts[0] === 'space' &&
      !parts[1].startsWith('.') &&
      !parts[2].startsWith('.') &&
      parts[2].endsWith('.json')
    );
  } catch {
    return false;
  }
}

export function machineUri(path: string): string {
  return `rool-machine:${machinePath(path).split('/').map(encodeURIComponent).join('/')}`;
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
