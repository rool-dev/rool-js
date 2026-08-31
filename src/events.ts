import { RoolAuthUnavailableError } from "./auth-base.js";
import { RoolProblem } from "./problem.js";
import type { RoolSession } from "./types.js";

export type RoolAccountEvent =
  | { type: "account_changed"; timestamp: number }
  | { type: "profile_changed"; timestamp: number }
  | { type: "user_app_data_changed"; timestamp: number }
  | { type: "providers_changed"; timestamp: number }
  | { type: "machines_changed"; machineId: string; timestamp: number }
  | { type: "machine_members_changed"; machineId: string; timestamp: number }
  | {
      type: "conversation_changed";
      machineId: string;
      agentId: string;
      conversationId: string;
      timestamp: number;
    };

export type RoolClientEvent =
  { type: "session"; session: RoolSession } | RoolAccountEvent;

export interface RoolEvents {
  readonly error: unknown;
  subscribe(listener: (event: RoolClientEvent) => void): () => void;
}

interface RoolEventsTransport {
  poll(syncToken: string, signal: AbortSignal): Promise<Response>;
  getSession(): Promise<RoolSession>;
}

interface AccountSyncReport {
  syncToken: string;
  events: RoolAccountEvent[];
}

const POLL_TIMEOUT_MS = 55_000;
const RETRY_MAX_MS = 5_000;
// Auth failures don't heal on their own — a fresh sign-in or a recovered auth
// server is needed — so back off much further than for transient errors.
const AUTH_RETRY_MS = 60_000;

class AccountEventRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccountEventRequestError";
  }
}

function isAuthShaped(error: unknown): boolean {
  if (error instanceof RoolAuthUnavailableError) return true;
  const status =
    error instanceof AccountEventRequestError || error instanceof RoolProblem
      ? error.status
      : null;
  return status === 401;
}

export function createRoolEvents(transport: RoolEventsTransport): RoolEvents {
  return new RoolEventPoller(transport);
}

class RoolEventPoller implements RoolEvents {
  private readonly listeners = new Set<(event: RoolClientEvent) => void>();
  private abortController: AbortController | null = null;
  private currentError: unknown = null;

  constructor(private readonly transport: RoolEventsTransport) {}

  get error(): unknown {
    return this.currentError;
  }

  subscribe(listener: (event: RoolClientEvent) => void): () => void {
    this.listeners.add(listener);
    if (!this.abortController) this.start();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start(): void {
    const abortController = new AbortController();
    this.abortController = abortController;
    void this.run(abortController.signal);
  }

  private stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.currentError = null;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let session = await this.loadSession(signal);
    if (!session) return;
    let syncToken = session.accountSyncToken;
    let retryMs = 250;

    while (!signal.aborted) {
      try {
        const response = await this.poll(syncToken, signal);
        if (response.status === 409) {
          await response.arrayBuffer();
          session = await this.transport.getSession();
          if (signal.aborted) return;
          syncToken = session.accountSyncToken;
          this.emit({ type: "session", session });
          this.currentError = null;
          retryMs = 250;
          continue;
        }
        if (!response.ok) {
          const body = await response.text();
          throw new AccountEventRequestError(
            response.status,
            `Account event request failed: ${response.status} ${response.statusText}: ${body}`,
          );
        }

        const report = parseAccountSyncReport(await response.json());
        if (signal.aborted) return;
        for (const event of report.events) this.emit(event);
        syncToken = report.syncToken;
        this.currentError = null;
        retryMs = 250;
      } catch (error) {
        if (signal.aborted) return;
        this.currentError = error;
        await abortableDelay(
          isAuthShaped(error) ? AUTH_RETRY_MS : retryMs,
          signal,
        );
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      }
    }
  }

  private async loadSession(signal: AbortSignal): Promise<RoolSession | null> {
    let retryMs = 250;
    while (!signal.aborted) {
      try {
        const session = await this.transport.getSession();
        if (signal.aborted) return null;
        this.emit({ type: "session", session });
        this.currentError = null;
        return session;
      } catch (error) {
        if (signal.aborted) return null;
        this.currentError = error;
        await abortableDelay(
          isAuthShaped(error) ? AUTH_RETRY_MS : retryMs,
          signal,
        );
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      }
    }
    return null;
  }

  private async poll(
    syncToken: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const pollController = new AbortController();
    const stop = () => pollController.abort();
    signal.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(stop, POLL_TIMEOUT_MS);

    try {
      return await this.transport.poll(syncToken, pollController.signal);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
    }
  }

  private emit(event: RoolClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function parseAccountSyncReport(value: unknown): AccountSyncReport {
  if (
    !isObject(value) ||
    typeof value.syncToken !== "string" ||
    !Array.isArray(value.events)
  ) {
    throw new Error("Invalid account event response");
  }
  return {
    syncToken: value.syncToken,
    events: value.events.map(parseAccountEvent),
  };
}

function parseAccountEvent(value: unknown): RoolAccountEvent {
  if (!isObject(value) || typeof value.timestamp !== "number") {
    throw new Error("Invalid account event");
  }
  if (
    value.type === "account_changed" ||
    value.type === "profile_changed" ||
    value.type === "user_app_data_changed" ||
    value.type === "providers_changed"
  ) {
    return { type: value.type, timestamp: value.timestamp };
  }
  if (
    (value.type === "machines_changed" ||
      value.type === "machine_members_changed") &&
    typeof value.machineId === "string"
  ) {
    return {
      type: value.type,
      machineId: value.machineId,
      timestamp: value.timestamp,
    };
  }
  if (
    value.type === "conversation_changed" &&
    typeof value.machineId === "string" &&
    typeof value.agentId === "string" &&
    typeof value.conversationId === "string"
  ) {
    return {
      type: value.type,
      machineId: value.machineId,
      agentId: value.agentId,
      conversationId: value.conversationId,
      timestamp: value.timestamp,
    };
  }
  throw new Error("Unknown account event");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });

    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
