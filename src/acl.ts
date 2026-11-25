import type { RoolClientEvent } from "./events.js";
import { WatchedValue } from "./watched-value.js";

export interface RoolAclView {
  readonly acl: RoolAcl | null;
  readonly loading: boolean;
  readonly error: unknown;
}

export interface RoolAclApi {
  get(): Promise<RoolAcl>;
  /** Shares the client's event feed. Stop watching when the signed-in user changes.
   * Unknown, invalidated and failed answers have acl: null, never inferred grants. */
  watch(listener: (view: RoolAclView) => void): () => void;
}

export class AclClient implements RoolAclApi {
  private readonly watched: WatchedValue<RoolAcl | null>;

  constructor(private readonly transport: {
    load(signal?: AbortSignal): Promise<RoolAcl>;
    subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
  }) {
    this.watched = new WatchedValue<RoolAcl | null>(
      signal => transport.load(signal),
      listener => transport.subscribeEvents(listener),
      event => event.type === "acl_changed",
      () => null,
      false,
    );
  }

  get(): Promise<RoolAcl> { return this.transport.load(); }

  watch(listener: (view: RoolAclView) => void): () => void {
    return this.watched.watch(({ value, loading, error }) => listener({ acl: value, loading, error }));
  }
}

/** Permissions to attempt an operation, not a promise that its constraints are met. */
export interface RoolAcl {
  version: 1;
  actions: Record<string, boolean>;
  accounts: Record<string, { actions: Record<string, boolean> }>;
  machines: Record<string, { actions: Record<string, boolean> }>;
}
