import type { AuthManager } from './auth.js';
import { addClientInfoHeaders, resolveClientInfo, type RoolClientInfo } from './client-info.js';

const ROUTE_MAX_RETRIES = 6;
const ROUTE_RETRY_BASE_MS = 150;
const ROUTE_RETRY_MAX_MS = 2_000;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function routeBackoffMs(attempt: number): number {
  const ceil = Math.min(ROUTE_RETRY_BASE_MS * 2 ** attempt, ROUTE_RETRY_MAX_MS);
  return ceil / 2 + Math.random() * (ceil / 2);
}

export interface RouteInfo {
  server: string;
  generation: number;
}

export interface SpaceRouterConfig {
  apiUrl: string;
  authManager: AuthManager;
  clientInfo?: RoolClientInfo;
}

export class SpaceRouter {
  private apiUrl: string;
  private authManager: AuthManager;
  private clientInfo: RoolClientInfo;
  private inflight = new Map<string, Promise<RouteInfo>>();

  constructor(config: SpaceRouterConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.authManager = config.authManager;
    this.clientInfo = config.clientInfo ?? resolveClientInfo();
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

    // A draining shard 503s /route (it must not re-claim the lease for a dying
    // instance). /route is any-shard, so retry until a live shard answers.
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers({
        Authorization: `Bearer ${tokens.accessToken}`,
        'X-Rool-Token': tokens.roolToken,
      });
      addClientInfoHeaders(headers, this.clientInfo);
      const response = await fetch(`${this.apiUrl}/route/${encodeURIComponent(spaceId)}`, { headers });

      if (response.ok) {
        const data = await response.json() as { server: string; generation: number };
        return { server: data.server, generation: data.generation };
      }
      if (response.status !== 503 || attempt >= ROUTE_MAX_RETRIES) {
        throw new Error(`Route resolution failed: ${response.status} ${response.statusText}`);
      }
      await delay(routeBackoffMs(attempt));
    }
  }
}
