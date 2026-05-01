/**
 * `rool-extension preview status` — list known preview sessions across all
 * extensions, marking stale state files where the daemon pid is gone.
 */

import { existsSync, readdirSync } from 'fs';
import { isPidAlive, readState, STATE_ROOT } from './lib.js';

export async function previewStatus(): Promise<void> {
  if (!existsSync(STATE_ROOT)) {
    console.log('No preview sessions.');
    return;
  }
  const entries = readdirSync(STATE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  let any = false;
  for (const id of entries) {
    const s = readState(id);
    if (!s) continue;
    const alive = isPidAlive(s.pid);
    console.log(
      `${id}  pid=${s.pid}  http=http://127.0.0.1:${s.serverPort}/` +
      `  cdp=${s.cdpPort}  ${alive ? 'running' : '(stale)'}`,
    );
    any = true;
  }
  if (!any) console.log('No preview sessions.');
}
