import { WatchedValue } from "./watched-value.js";
import type { RoolWatchingTransport } from "./transport.js";

export interface ApiTokenGrant {
  machineId: string | null;
  actions: string[];
}

export interface ApiToken {
  id: string;
  name: string;
  createdByUserId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  grants: ApiTokenGrant[];
}

export interface CreateApiToken {
  name: string;
  grants: ApiTokenGrant[];
}

export interface CreatedApiToken extends ApiToken {
  secret: string;
  token: string;
}

export interface ApiTokensView {
  readonly tokens: readonly ApiToken[];
  readonly loading: boolean;
  readonly error: unknown;
}

export type ApiTokensListener = (view: ApiTokensView) => void;

export interface AccountApiTokensApi {
  watch(listener: ApiTokensListener): () => void;
  list(): Promise<ApiToken[]>;
  get(tokenId: string): Promise<ApiToken>;
  create(input: CreateApiToken): Promise<CreatedApiToken>;
  rename(tokenId: string, name: string): Promise<void>;
  revoke(tokenId: string): Promise<void>;
}

export class AccountApiTokensClient implements AccountApiTokensApi {
  private readonly path: string;

  private readonly watched: WatchedValue<ApiToken[]>;

  constructor(accountId: string, accountPath: string, private readonly transport: RoolWatchingTransport) {
    this.path = `${accountPath}/api-tokens`;
    this.watched = new WatchedValue(
      signal => this.load(signal),
      listener => transport.subscribeEvents(listener),
      event => event.type === "acl_changed" ||
        ((event.type === "api_tokens_changed" || event.type === "account_changed") && event.accountId === accountId),
      () => [],
      false,
    );
  }

  watch(listener: ApiTokensListener): () => void {
    return this.watched.watch(({ value, loading, error }) => listener({ tokens: [...value], loading, error }));
  }

  list(): Promise<ApiToken[]> {
    return this.load();
  }

  private async load(signal?: AbortSignal): Promise<ApiToken[]> {
    const { tokens } = await this.transport.requestJson<{ tokens: ApiToken[] }>(this.path, { signal });
    return tokens;
  }

  get(tokenId: string): Promise<ApiToken> {
    return this.transport.requestJson(this.tokenPath(tokenId));
  }

  create(input: CreateApiToken): Promise<CreatedApiToken> {
    return this.transport.requestJson(this.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async rename(tokenId: string, name: string): Promise<void> {
    await this.transport.request(this.tokenPath(tokenId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async revoke(tokenId: string): Promise<void> {
    await this.transport.request(this.tokenPath(tokenId), { method: "DELETE" });
  }

  private tokenPath(tokenId: string): string {
    if (!tokenId) throw new Error("tokenId is required");
    return `${this.path}/${encodeURIComponent(tokenId)}`;
  }
}
