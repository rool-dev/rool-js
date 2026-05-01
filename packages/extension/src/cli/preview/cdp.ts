/**
 * Minimal Chrome DevTools Protocol client over WebSocket.
 *
 * Just enough for the `preview` subcommands: send a method, await its result,
 * subscribe to events. Supports flat session dispatch (sessionId on every
 * request/response) so a single connection drives both the browser target
 * and any attached page session.
 */

import { WebSocket } from 'ws';

interface CdpRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  sessionId?: string;
}

type EventListener = (params: Record<string, unknown>, sessionId?: string) => void;

export class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<EventListener>>();

  private constructor(private ws: WebSocket) {
    ws.on('message', (raw: Buffer) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(raw.toString('utf-8')) as CdpMessage;
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result ?? {});
      } else if (msg.method) {
        const set = this.listeners.get(msg.method);
        if (!set) return;
        for (const fn of set) fn(msg.params ?? {}, msg.sessionId);
      }
    });
    ws.on('close', () => {
      const closeErr = new Error('CDP connection closed');
      for (const p of this.pending.values()) p.reject(closeErr);
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (e: Error) => { cleanup(); reject(e); };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
    return new CdpClient(ws);
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = this.nextId++;
    const req: CdpRequest = { id, method, params };
    if (sessionId) req.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.ws.send(JSON.stringify(req));
    });
  }

  on(method: string, fn: EventListener): () => void {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  close(): void {
    this.ws.close();
  }
}
