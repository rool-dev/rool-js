import type { AuthManager } from './auth.js';

export interface RouteInfo {
  server: string;
  generation: number;
}

export interface SpaceRouterConfig {
  apiUrl: string;
  authManager: AuthManager;
}

export class SpaceRouter {
  private apiUrl: string;
  private authManager: AuthManager;
  private inflight = new Map<string, Promise<RouteInfo>>();

  constructor(config: SpaceRouterConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.authManager = config.authManager;
  }

  resolve(spaceId: string): Promise<RouteInfo> {
    const existing = this.inflight.get(spaceId);
    if (existing) return existing;

    const promise = this.fetchRoute(spaceId).finally(() => {
      this.inflight.delete(spaceId);
    });
    this.inflight.set(spaceId, promise);
    return promise;
  }

  private async fetchRoute(spaceId: string): Promise<RouteInfo> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const response = await fetch(`${this.apiUrl}/route/${encodeURIComponent(spaceId)}`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-Rool-Token': tokens.roolToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Route resolution failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { server: string; generation: number };
    return { server: data.server, generation: data.generation };
  }
}
