import { resolve } from 'path';
import { ensurePreview } from './ensure.js';
import { requireManifestAt } from './lib.js';

export async function reset(): Promise<void> {
  const cwd = process.cwd();
  const manifest = requireManifestAt(cwd);
  const distDir = resolve(cwd, 'dist');
  const state = await ensurePreview(manifest, distDir, { reset: true });
  console.log(`Reset "${manifest.name}" (${manifest.id}) — http://127.0.0.1:${state.serverPort}/__rool-host/`);
}
