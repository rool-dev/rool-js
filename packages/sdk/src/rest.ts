import type { AuthManager } from './auth.js';
import type {
  GetObjectsResult,
  Gift,
  GiftClaimResult,
  GiftList,
  GiftPreview,
  GiftUpdate,
  InvitePreview,
  InviteRedeemResult,
} from './types.js';
import { fetchWithReroute, isThrowRetryable } from './reroute.js';
import { addClientInfoHeaders, resolveClientInfo, type RoolClientInfo } from './client-info.js';

export type InviteErrorCode =
  | 'INVITE_INVALID'
  | 'INVITE_EXPIRED'
  | 'INVITE_REVOKED'
  | 'INVITE_EXHAUSTED'
  | 'INVITE_EMAIL_MISMATCH';

export class InviteError extends Error {
  constructor(readonly code: InviteErrorCode, message: string) {
    super(message);
    this.name = 'InviteError';
  }
}

async function throwInviteError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null) as { code?: InviteErrorCode; error?: string } | null;
  if (body?.code) throw new InviteError(body.code, body.error ?? body.code);
  throw new Error(`Invite request failed: ${response.status}`);
}

export type GiftErrorCode = 'gift_invalid' | 'gift_claimed';

export class GiftError extends Error {
  constructor(readonly code: GiftErrorCode, message: string) {
    super(message);
    this.name = 'GiftError';
  }
}

// Gift endpoints are v2: errors arrive as application/problem+json.
async function throwGiftError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null) as { code?: string; detail?: string } | null;
  if (body?.code?.startsWith('gift_')) {
    throw new GiftError(body.code as GiftErrorCode, body.detail ?? body.code);
  }
  throw new Error(`Gift request failed: ${response.status}${body?.detail ? ` ${body.detail}` : ''}`);
}

export interface RestClientConfig {
  apiUrl: string;
  authManager: AuthManager;
  clientInfo?: RoolClientInfo;
  /** Called on shard refusal/drain (421/503). Return the new API base URL. */
  onRefused?: () => Promise<string>;
}

export class RestClient {
  private apiUrl: string;
  private authManager: AuthManager;
  private onRefused?: () => Promise<string>;
  private clientInfo: RoolClientInfo;

  constructor(config: RestClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.authManager = config.authManager;
    this.onRefused = config.onRefused;
    this.clientInfo = config.clientInfo ?? resolveClientInfo();
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
      body: JSON.stringify({ paths }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to get objects: ${response.status} ${errorText}`);
    }

    const result = await response.json() as {
      objects: Array<{ path: string; body: Record<string, unknown> }>;
      missing: string[];
    };
    return {
      objects: result.objects.map((object) => ({ path: object.path, body: object.body })),
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

  /** Look up an invite by token. Works without authentication (join page before sign-in). */
  async previewInvite(token: string): Promise<InvitePreview> {
    const response = await fetch(`${this.apiUrl}/invites/${encodeURIComponent(token)}`);
    if (!response.ok) await throwInviteError(response);
    return await response.json() as InvitePreview;
  }

  /** Redeem an invite for the authenticated user, joining (or upgrading in) the space. */
  async redeemInvite(token: string): Promise<InviteRedeemResult> {
    const response = await this.authenticatedFetch(`/invites/${encodeURIComponent(token)}/redeem`, {
      method: 'POST',
    });
    if (!response.ok) await throwInviteError(response);
    return await response.json() as InviteRedeemResult;
  }

  /** Look up a gift by its code. Works without authentication (claim page before sign-up). */
  async previewGift(code: string): Promise<GiftPreview> {
    const response = await fetch(`${this.apiUrl}/v2/gifts/${encodeURIComponent(code)}`);
    if (!response.ok) await throwGiftError(response);
    return await response.json() as GiftPreview;
  }

  /** Claim a gift for the authenticated user, granting what it holds. */
  async claimGift(code: string): Promise<GiftClaimResult> {
    const response = await this.authenticatedFetch(`/v2/gifts/${encodeURIComponent(code)}/claim`, {
      method: 'POST',
    });
    if (!response.ok) await throwGiftError(response);
    return await response.json() as GiftClaimResult;
  }

  /** The authenticated user's gifts, spent and unspent. */
  async listGifts(): Promise<GiftList> {
    const response = await this.authenticatedFetch('/v2/me/gifts', { method: 'GET' });
    if (!response.ok) await throwGiftError(response);
    return await response.json() as GiftList;
  }

  /** Mint a new code for a gift; the old code and link stop working. */
  async rotateGiftCode(giftId: string): Promise<Gift> {
    const response = await this.authenticatedFetch(`/v2/me/gifts/${encodeURIComponent(giftId)}/code`, {
      method: 'POST',
    });
    if (!response.ok) await throwGiftError(response);
    return await response.json() as Gift;
  }

  /** Update a gift's note and/or archived state. Returns the updated gift. */
  async updateGift(giftId: string, changes: GiftUpdate): Promise<Gift> {
    const response = await this.authenticatedFetch(`/v2/me/gifts/${encodeURIComponent(giftId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!response.ok) await throwGiftError(response);
    return await response.json() as Gift;
  }

  private async authenticatedFetch(path: string, init: RequestInit): Promise<Response> {
    const tokens = await this.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    headers.set('X-Rool-Token', tokens.roolToken);
    addClientInfoHeaders(headers, this.clientInfo);

    const onRefused = this.onRefused;
    return fetchWithReroute({
      send: () => fetch(`${this.apiUrl}${path}`, { ...init, headers }),
      reroute: onRefused ? async () => this.setApiUrl(await onRefused()) : undefined,
      retryOnThrow: isThrowRetryable(init.method),
    });
  }
}
