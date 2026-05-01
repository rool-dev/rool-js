/**
 * `rool-extension preview screenshot --out <path>` — capture a PNG of the
 * preview tab via CDP. Stateless: opens its own connection, attaches to the
 * existing target, captures, disconnects. Daemon stays untouched.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { CdpClient } from './cdp.js';
import { isPidAlive, readState, requireManifest } from './lib.js';

interface ScreenshotOpts {
  out: string;
}

export async function previewScreenshot(opts: ScreenshotOpts): Promise<void> {
  const manifest = requireManifest();
  const extensionId = manifest.id;
  const state = readState(extensionId);
  if (!state || !isPidAlive(state.pid)) {
    console.error(
      `No preview running for "${extensionId}". ` +
      `Run \`rool-extension preview start\` first.`,
    );
    process.exit(1);
  }

  const outPath = resolve(process.cwd(), opts.out);

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
