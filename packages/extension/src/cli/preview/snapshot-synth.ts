/**
 * Synthesize an empty space snapshot from a manifest.
 *
 * Used by `rool-extension preview --use-empty-snapshot` when no real
 * snapshot is provided via ROOL_PREVIEW_SNAPSHOT_PATH. Produces a valid
 * RoolSpaceData with the manifest's declared collections in the schema
 * but no objects — enough for the extension to boot, render, and call
 * channel methods that don't depend on data being present.
 */

import { writeFileSync } from 'fs';
import type { Manifest, ManifestFieldDef } from '../../manifest.js';
import {
  ensureStateDir,
  SYNTH_INFO_FILE,
  SYNTH_SNAPSHOT_FILE,
} from './lib.js';

interface SynthPaths {
  snapshotPath: string;
  infoPath: string;
}

export function writeEmptySnapshot(manifest: Manifest): SynthPaths {
  ensureStateDir();

  const schema: Record<string, { fields: ManifestFieldDef[] }> = {};
  const writeColls = manifest.collections?.write;
  if (writeColls && writeColls !== '*') {
    for (const [name, fields] of Object.entries(writeColls)) {
      schema[name] = { fields };
    }
  }
  const readColls = manifest.collections?.read;
  if (readColls && readColls !== '*') {
    for (const [name, fields] of Object.entries(readColls)) {
      if (!schema[name]) schema[name] = { fields };
    }
  }

  const snapshot = {
    objects: {},
    meta: {},
    channels: {},
    schema,
  };
  const info = {
    spaceId: `${manifest.id}-empty`,
    name: `Empty (${manifest.name})`,
    takenAt: Date.now(),
    version: 1,
  };

  writeFileSync(SYNTH_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  writeFileSync(SYNTH_INFO_FILE, JSON.stringify(info, null, 2));

  return { snapshotPath: SYNTH_SNAPSHOT_FILE, infoPath: SYNTH_INFO_FILE };
}
