import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { CdpClient } from './cdp.js';
import { ensurePreview } from './ensure.js';
import { requireManifestAt } from './lib.js';

interface ScreenshotOpts {
  out: string;
}

export async function screenshot(opts: ScreenshotOpts): Promise<void> {
  const cwd = process.cwd();
  const manifest = requireManifestAt(cwd);
  const distDir = resolve(cwd, 'dist');
  const state = await ensurePreview(manifest, distDir);

  const outPath = resolve(cwd, opts.out);
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
    writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(outPath);
  } finally {
    cdp.close();
  }
}
