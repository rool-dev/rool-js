import type { AuthManager } from './auth.js';
import type { GetObjectsResult } from './types.js';
import { fetchWithReroute, isThrowRetryable } from './reroute.js';

export interface RestClientConfig {
  apiUrl: string;
  authManager: AuthManager;
  /** Called on shard refusal/drain (421/503). Return the new API base URL. */
  onRefused?: () => Promise<string>;
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
      // Server addresses objects by `location` today; tolerate a future `path`
      // rename. The SDK always exposes them as `path`.
      objects: result.objects.map((object) => {
        const path = object.path ?? object.location;
        if (typeof path !== 'string') throw new Error('getObjects: server object has no path or location');
        return { path, body: object.body };
      }),
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

    const onRefused = this.onRefused;
    return fetchWithReroute({
      send: () => fetch(`${this.apiUrl}${path}`, { ...init, headers }),
      reroute: onRefused ? async () => this.setApiUrl(await onRefused()) : undefined,
      retryOnThrow: isThrowRetryable(init.method),
    });
  }
}
