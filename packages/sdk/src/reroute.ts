const REQUEST_MAX_RETRIES = 6;
const RETRY_BASE_MS = 150;
const RETRY_MAX_MS = 5_000;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryBackoffMs(attempt: number): number {
  const ceil = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return ceil / 2 + Math.random() * (ceil / 2);
}

// Methods safe to re-send after a thrown fetch: reads, plus the idempotent
// writes. A node that has fully rolled away makes fetch reject opaquely instead
// of returning a readable 503, and we can't prove the request didn't execute, so
// we only re-send when re-sending is harmless. POST/MKCOL/MOVE/COPY/LOCK are not.
const THROW_RETRYABLE = new Set(['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT', 'PUT', 'DELETE']);

export function isThrowRetryable(method?: string): boolean {
  return method ? THROW_RETRYABLE.has(method.toUpperCase()) : false;
}

export interface RerouteOptions {
  /** Issue the request against the current (possibly just-rerouted) node. */
  send: () => Promise<Response>;
  /** Re-resolve the owning node and update client URL state. Throws if it fails. */
  reroute?: () => Promise<void>;
  /**
   * Whether the request may be re-sent after a thrown fetch (opaque network/CORS
   * failure). Only true for idempotent requests — see THROW_RETRYABLE.
   */
  retryOnThrow: boolean;
}

/**
 * Fetch with shard-reroute retries. A node being drained returns a readable
 * 421/503: re-resolve the owner and retry. A node that has fully rolled away no
 * longer answers, so the LB's CORS-less 5xx makes fetch reject opaquely (no
 * status to inspect); for idempotent requests we treat that throw as the same
 * reroute signal, since otherwise the request keeps targeting a dead node and
 * surfaces only as an opaque CORS error.
 */
export async function fetchWithReroute(opts: RerouteOptions): Promise<Response> {
  const { send, reroute, retryOnThrow } = opts;

  let response: Response | null = null;
  let thrown: unknown;
  try {
    response = await send();
  } catch (error) {
    if (!reroute || !retryOnThrow) throw error;
    thrown = error;
  }

  for (
    let attempt = 0;
    reroute && attempt < REQUEST_MAX_RETRIES &&
      (response === null || response.status === 421 || response.status === 503);
    attempt++
  ) {
    await delay(retryBackoffMs(attempt));
    try {
      await reroute();
    } catch {
      continue; // reroute itself failed (e.g. /route exhausted its own retries); keep backing off
    }
    try {
      response = await send();
      thrown = undefined;
    } catch (error) {
      if (!retryOnThrow) throw error;
      response = null;
      thrown = error;
    }
  }

  if (response === null) throw thrown;
  return response;
}
