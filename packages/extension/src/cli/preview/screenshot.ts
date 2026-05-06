import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { CdpClient } from './cdp.js';
import { ensurePreview } from './ensure.js';
import { ARTIFACTS_DIR, isAgentMode, nextStep, requireManifestAt } from './lib.js';

interface ScreenshotOpts {
  out?: string;
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

export async function screenshot(opts: ScreenshotOpts): Promise<void> {
  if (opts.out && isAgentMode()) {
    console.error('--out is not allowed in agent mode (paths are managed for you).');
    process.exit(1);
  }

  const cwd = process.cwd();
  const manifest = requireManifestAt(cwd);
  const distDir = resolve(cwd, 'dist');
  const state = await ensurePreview(manifest, distDir);

  // Reserve the next step number after the daemon is up — ensurePreview
  // may spawn a fresh daemon (which resets the counter to 0).
  const step = nextStep();
  const outPath = opts.out
    ? resolve(cwd, opts.out)
    : resolve(cwd, ARTIFACTS_DIR, `${pad(step)}-screenshot.png`);

  const cdp = await CdpClient.connect(state.browserWsUrl);
  try {
    const { sessionId } = await cdp.send<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId: state.targetId, flatten: true },
    );
    const { data } = await cdp.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'png' },
      sessionId,
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(outPath);
  } finally {
    cdp.close();
  }
}
