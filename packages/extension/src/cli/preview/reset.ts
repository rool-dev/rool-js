import { rmSync } from 'fs';
import { resolve } from 'path';
import { ensurePreview } from './ensure.js';
import { ARTIFACTS_DIR, requireManifestAt } from './lib.js';

export async function reset(): Promise<void> {
  const cwd = process.cwd();
  const manifest = requireManifestAt(cwd);
  const distDir = resolve(cwd, 'dist');

  // Wipe interaction artifacts before restarting so the new session
  // starts at step 1 with a clean ./screenshots/ directory.
  rmSync(resolve(cwd, ARTIFACTS_DIR), { recursive: true, force: true });

  const state = await ensurePreview(manifest, distDir, { reset: true });
  console.log(`Reset "${manifest.name}" (${manifest.id}) — http://127.0.0.1:${state.serverPort}/__rool-host/`);
}
