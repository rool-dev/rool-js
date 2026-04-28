/**
 * Probe handlers — extension-runtime implementations of agent-initiated probes.
 *
 * The host posts a `rool:probe` message with a `method` and `args`; the runtime
 * looks up the matching handler and posts back `rool:probeResult` with either
 * a method-specific result or an error. The handler table is closed (extensions
 * cannot register their own handlers) so the agent only ever sees a known surface.
 */

import { toPng } from 'html-to-image';

export type ProbeHandler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, ProbeHandler> = {
  screenshot: async () => {
    const dataUrl = await toPng(document.documentElement, { cacheBust: true });
    const imageBase64 = dataUrl.split(',')[1] ?? '';
    return { imageBase64 };
  },
};

export async function runProbe(method: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = handlers[method];
  if (!handler) throw new Error(`Unknown probe method "${method}"`);
  return handler(args);
}
