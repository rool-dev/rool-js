import type { RoolClientEvent } from "./events.js";

export interface RoolTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}

/** A transport that also hears the client's events, for the APIs that watch. */
export interface RoolWatchingTransport extends RoolTransport {
  subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
}

export function jsonRequest(
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}
