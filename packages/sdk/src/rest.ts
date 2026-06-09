import type { AuthManager } from './auth.js';
import type { GetObjectsResult } from './types.js';

export interface RestClientConfig {
  apiUrl: string;
  authManager: AuthManager;
}

export class RestClient {
  private apiUrl: string;
  private authManager: AuthManager;

  constructor(config: RestClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.authManager = config.authManager;
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

  async getObjects(spaceId: string, locations: string[]): Promise<GetObjectsResult> {
    const response = await this.authenticatedFetch(`/spaces/${encodeURIComponent(spaceId)}/getObjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to get objects: ${response.status} ${errorText}`);
    }

    return await response.json() as GetObjectsResult;
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

    return fetch(`${this.apiUrl}${path}`, { ...init, headers });
  }
}
