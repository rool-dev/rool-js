import type { AuthManager } from './auth.js';
import type { GetObjectsResult } from './types.js';

export interface RestClientConfig {
  apiUrl: string;
  authManager: AuthManager;
  /** Called on shard refusal/drain (421/503). Return the new API base URL. */
  onRefused?: () => Promise<string>;
}

const REQUEST_MAX_RETRIES = 6;
const RETRY_BASE_MS = 150;
const RETRY_MAX_MS = 5_000;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function retryBackoffMs(attempt: number): number {
  const ceil = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return ceil / 2 + Math.random() * (ceil / 2);
}

export class RestClient {
  private apiUrl: string;
  private authManager: AuthManager;
  private onRefused?: () => Promise<string>;

  constructor(config: RestClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.authManager = config.authManager;
    this.onRefused = config.onRefused;
  }

  /** Update the API base URL (used after shard rerouting). */
  setApiUrl(apiUrl: string): void {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
  }

  /** Wire the shard-reroute callback (used after shard rerouting). */
  setOnRefused(onRefused: () => Promise<string>): void {
    this.onRefused = onRefused;
  }

  async proxyFetch(
    spaceId: string,
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown }
  ): Promise<Response> {
    const response = await this.authenticatedFetch(`/fetch/${encodeURIComponent(spaceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      }),
    });

    return response;
  }

  async getObjects(spaceId: string, paths: string[]): Promise<GetObjectsResult> {
    const response = await this.authenticatedFetch(`/spaces/${encodeURIComponent(spaceId)}/getObjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: paths }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to get objects: ${response.status} ${errorText}`);
    }

    const result = await response.json() as {
      objects: Array<{ path?: string; location?: string; body: Record<string, unknown> }>;
      missing: string[];
    };
    return {
      objects: result.objects.map((object) => ({ path: object.path ?? object.location ?? '', body: object.body })),
      missing: result.missing,
    };
  }

  async importArchive(name: string, archive: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('archive', archive, 'archive.zip');

    const response = await this.authenticatedFetch('/spaces/import', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to import space: ${response.status} ${errorText}`);
    }

    const result = await response.json() as { spaceId: string; name: string };
    return result.spaceId;
  }

  private async authenticatedFetch(path: string, init: RequestInit): Promise<Response> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    headers.set('X-Rool-Token', tokens.roolToken);

    let response = await fetch(`${this.apiUrl}${path}`, { ...init, headers });

    // 421 (wrong shard) and 503 (draining) reject before executing server-side.
    // Re-resolve the owning shard and retry against the new node.
    for (
      let attempt = 0;
      (response.status === 421 || response.status === 503) && this.onRefused && attempt < REQUEST_MAX_RETRIES;
      attempt++
    ) {
      await delay(retryBackoffMs(attempt));
      try {
        this.setApiUrl(await this.onRefused());
      } catch {
        continue;
      }
      response = await fetch(`${this.apiUrl}${path}`, { ...init, headers });
    }

    return response;
  }
}
