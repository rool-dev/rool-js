import type { RoolClientEvent } from "./events.js";
import { RoolProblem } from "./problem.js";

interface ListView<T> {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly error: unknown;
}

/** One list fetch loop shared by watchers, refreshed through the client's event poll. */
export class WatchedList<T> {
  private readonly listeners = new Set<(view: ListView<T>) => void>();
  private items: T[] = [];
  private loading = true;
  private error: unknown = null;
  private controller: AbortController | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private syncRequested = false;
  private syncLoop: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 250;
  private revision = 0;

  constructor(
    private readonly load: (signal: AbortSignal) => Promise<T[]>,
    private readonly subscribeEvents: (listener: (event: RoolClientEvent) => void) => () => void,
    private readonly matchesEvent: (event: RoolClientEvent) => boolean,
  ) {}

  watch(listener: (view: ListView<T>) => void): () => void {
    this.listeners.add(listener);
    if (!this.controller) this.start();
    listener(this.view());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  get generation(): number { return this.revision; }

  /** Apply a successful local mutation without letting an older fetch undo it. */
  update(generation: number, change: (items: T[]) => T[]): void {
    if (!this.controller || generation !== this.revision) return;
    this.items = change(this.items);
    this.requestSync();
    this.emit();
  }

  private start(): void {
    this.revision++;
    this.controller = new AbortController();
    this.loading = true;
    this.error = null;
    this.retryMs = 250;
    this.unsubscribeEvents = this.subscribeEvents((event) => {
      if (event.type === "session" || this.matchesEvent(event)) this.requestSync();
    });
    this.requestSync();
  }

  private stop(): void {
    this.revision++;
    this.controller?.abort();
    this.controller = null;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.items = [];
    this.error = null;
    this.syncRequested = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private requestSync(): void {
    const controller = this.controller;
    if (!controller || controller.signal.aborted) return;
    this.syncRequested = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.syncLoop) return;

    // Events in the same poll report should result in one fetch.
    const loop = Promise.resolve().then(() => this.runSyncLoop(controller));
    this.syncLoop = loop;
    const finished = () => {
      if (this.syncLoop === loop) this.syncLoop = null;
      if (this.controller && this.syncRequested && !this.controller.signal.aborted) this.requestSync();
    };
    void loop.then(finished, finished);
  }

  private async runSyncLoop(controller: AbortController): Promise<void> {
    while (this.controller === controller && !controller.signal.aborted && this.syncRequested) {
      this.syncRequested = false;
      let items: T[];
      try {
        items = await this.load(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (this.syncRequested) continue;
        if (error instanceof RoolProblem && [401, 403, 404].includes(error.status)) this.items = [];
        this.loading = false;
        this.error = error;
        this.scheduleRetry(controller);
        this.emit();
        return;
      }
      if (controller.signal.aborted) return;
      // A change during the fetch means its response may already be stale.
      if (this.syncRequested) continue;
      this.items = items;
      this.loading = false;
      this.error = null;
      this.retryMs = 250;
      this.emit();
    }
  }

  private scheduleRetry(controller: AbortController): void {
    if (this.retryTimer || this.controller !== controller) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 5_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requestSync();
    }, delay);
  }

  private view(): ListView<T> {
    return { items: [...this.items], loading: this.loading, error: this.error };
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }
}
