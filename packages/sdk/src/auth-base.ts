import { resolveAuthUrl, type AuthEndpointConfig } from "./auth-url.js";
import type { RoolAuth, RoolRequestTokens } from "./types.js";

const REFRESH_BUFFER_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = "rool_";

export interface TokenAuthConfig extends AuthEndpointConfig {
  fetch?: typeof globalThis.fetch;
}

export interface AuthTokenResponse {
  id_token?: unknown;
  refresh_token?: unknown;
  rool_token?: unknown;
  expires_in?: unknown;
}

export type EmailChangeErrorCode =
  | "missing_token"
  | "invalid_token"
  | "missing_email"
  | "invalid_email"
  | "account_not_found"
  | "account_suspended"
  | "same_email"
  | "email_in_use"
  | "send_failed"
  | "internal_error";

export class EmailChangeError extends Error {
  constructor(
    readonly code: EmailChangeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmailChangeError";
  }
}

export abstract class TokenAuth implements RoolAuth {
  private readonly authUrl: string;
  private readonly fetchRequest: typeof globalThis.fetch;
  private readonly listeners = new Set<(authenticated: boolean) => void>();
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: TokenAuthConfig = {}) {
    this.authUrl = resolveAuthUrl(config);
    this.fetchRequest = config.fetch ?? globalThis.fetch;
  }

  abstract initialize(): Promise<boolean>;
  abstract login(
    appName: string,
    params?: Record<string, string>,
  ): Promise<void>;
  abstract signup(
    appName: string,
    params?: Record<string, string>,
  ): Promise<void>;

  async isAuthenticated(): Promise<boolean> {
    return this.readAccessToken() !== null;
  }

  readonly getTokens = async (): Promise<RoolRequestTokens | undefined> => {
    let accessToken = this.readAccessToken();
    if (!accessToken) return undefined;

    const expiresAt = this.readExpiresAt();
    const needsRefresh =
      expiresAt !== null && Date.now() >= expiresAt - REFRESH_BUFFER_MS;
    if (needsRefresh) {
      if (!(await this.refresh())) return undefined;
      accessToken = this.readAccessToken();
      if (!accessToken) return undefined;
    }

    return { accessToken, roolToken: this.readRoolToken() };
  };

  readonly logout = async (): Promise<void> => {
    const wasAuthenticated = this.readAccessToken() !== null;
    this.clearTokens();
    this.clearTransientState();
    if (wasAuthenticated) this.emitAuthState(false);
  };

  onAuthStateChanged(listener: (authenticated: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async verify(token: string): Promise<boolean> {
    let response: Response;
    try {
      response = await this.fetchAuth("/verify-and-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch (error) {
      console.error("[RoolAuth] verify network error:", error);
      return false;
    }
    if (!response.ok) return false;

    const data = await readTokenResponse(response);
    if (!data || !this.acceptTokenResponse(data)) return false;
    this.emitAuthState(true);
    return true;
  }

  async setPassword(password: string): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error("Not authenticated");

    const response = await this.fetchAuth("/set-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ password }),
    });
    const data = (await response.json().catch(() => null)) as
      (AuthTokenResponse & { error?: string }) | null;
    if (!response.ok) {
      throw new Error(data?.error ?? `set-password failed: ${response.status}`);
    }

    const hasRefreshToken = typeof data?.refresh_token === "string";
    const accepted =
      data &&
      hasRefreshToken &&
      this.acceptTokenResponse(data, { roolToken: tokens.roolToken });
    if (!accepted) await this.logout();
  }

  async requestEmailChange(newEmail: string): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error("Not authenticated");

    const response = await this.fetchAuth("/email-change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ new_email: newEmail }),
    });
    if (response.ok) return;

    const data = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    if (data?.error) {
      throw new EmailChangeError(
        data.error as EmailChangeErrorCode,
        data.message ?? data.error,
      );
    }
    throw new Error(`email-change failed: ${response.status}`);
  }

  protected get authBaseUrl(): string {
    return this.authUrl;
  }

  protected fetchAuth(path: string, init: RequestInit): Promise<Response> {
    return this.fetchRequest(`${this.authUrl}${path}`, init);
  }

  protected acceptTokenResponse(
    data: AuthTokenResponse,
    fallback: { refreshToken?: string | null; roolToken?: string | null } = {},
  ): boolean {
    const accessToken = data.id_token;
    const expiresIn = Number(data.expires_in);
    if (
      typeof accessToken !== "string" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      return false;
    }

    const refreshToken =
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : (fallback.refreshToken ?? null);
    const roolToken =
      typeof data.rool_token === "string"
        ? data.rool_token
        : data.rool_token === null
          ? null
          : (fallback.roolToken ?? null);
    this.writeTokens(
      accessToken,
      refreshToken,
      roolToken,
      Date.now() + expiresIn * 1000,
    );
    return true;
  }

  protected emitAuthState(authenticated: boolean): void {
    for (const listener of this.listeners) listener(authenticated);
  }

  protected clearTransientState(): void {}

  protected keyFor(name: string): string {
    return `${STORAGE_PREFIX}${this.endpointHash}_${name}`;
  }

  protected readString(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  protected writeString(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }

  protected removeString(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }

  private get storageKeys() {
    return {
      access: this.keyFor("access_token"),
      refresh: this.keyFor("refresh_token"),
      rool: this.keyFor("rool_token"),
      expiresAt: this.keyFor("token_expires_at"),
    } as const;
  }

  private get endpointHash(): string {
    let hash = 5381;
    for (const character of this.authUrl) {
      hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  private readAccessToken(): string | null {
    return this.readString(this.storageKeys.access);
  }

  private readRoolToken(): string {
    return this.readString(this.storageKeys.rool) ?? "";
  }

  private readExpiresAt(): number | null {
    const value = Number(this.readString(this.storageKeys.expiresAt));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private writeTokens(
    accessToken: string | null,
    refreshToken: string | null,
    roolToken: string | null,
    expiresAt: number | null,
  ): void {
    this.writeOrRemove(this.storageKeys.access, accessToken);
    this.writeOrRemove(this.storageKeys.refresh, refreshToken);
    this.writeOrRemove(this.storageKeys.rool, roolToken);
    this.writeOrRemove(
      this.storageKeys.expiresAt,
      expiresAt === null ? null : Math.floor(expiresAt).toString(),
    );
  }

  private writeOrRemove(key: string, value: string | null): void {
    if (value) this.writeString(key, value);
    else this.removeString(key);
  }

  private clearTokens(): void {
    this.writeTokens(null, null, null, null);
  }

  private async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshToken = this.readString(this.storageKeys.refresh);
    if (!refreshToken) return false;
    const roolToken = this.readString(this.storageKeys.rool);

    this.refreshPromise = this.performRefresh(refreshToken, roolToken).finally(
      () => {
        this.refreshPromise = null;
      },
    );
    return this.refreshPromise;
  }

  private async performRefresh(
    refreshToken: string,
    roolToken: string | null,
  ): Promise<boolean> {
    let response: Response;
    try {
      response = await this.fetchAuth("/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: refreshToken,
          rool_token: roolToken,
        }),
      });
    } catch (error) {
      console.warn("[RoolAuth] Token refresh network error:", error);
      return false;
    }

    if (response.status === 400 || response.status === 401) {
      await this.logout();
      return false;
    }
    if (!response.ok) return false;

    const data = await readTokenResponse(response);
    return (
      !!data &&
      this.acceptTokenResponse(data, {
        refreshToken,
        roolToken,
      })
    );
  }
}

async function readTokenResponse(
  response: Response,
): Promise<AuthTokenResponse | null> {
  try {
    return (await response.json()) as AuthTokenResponse;
  } catch {
    return null;
  }
}
