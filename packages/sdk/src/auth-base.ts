// =============================================================================
// Base token auth provider
// Shared machinery for browser-style providers: endpoint-scoped localStorage
// token storage, expiry-aware getTokens with deduplicated background refresh,
// visibility-driven re-scheduling, and JWT identity decode.
//
// Subclasses implement only how a session STARTS (login/signup) and how the
// callback arrives — BrowserAuthProvider via a URL fragment,
// NativePkceAuthProvider via a deep link + code exchange. Everything after the
// tokens land (storage, refresh, decode) is shared here.
// =============================================================================

import type { AuthProvider, AuthUser } from './types.js';
import { defaultLogger, type Logger } from './logger.js';

const REFRESH_BUFFER_MS = 15 * 60 * 1000; // Refresh 15 minutes before expiry
const DEFAULT_STORAGE_PREFIX = 'rool_';

export interface BaseTokenAuthConfig {
    /** Auth URL (e.g. https://rool.dev/auth). Injected by RoolClient if omitted. */
    authUrl?: string;
    /** Injected by RoolClient if omitted. */
    logger?: Logger;
    /** Injected by RoolClient if omitted, so auth-state reaches client events. */
    onAuthStateChanged?: (authenticated: boolean) => void;
}

export abstract class BaseTokenAuthProvider implements AuthProvider {
    protected logger: Logger;
    private _authUrl: string;
    private _onAuthStateChanged: (authenticated: boolean) => void;
    private refreshPromise: Promise<boolean> | null = null;
    private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private boundVisibilityHandler: (() => void) | null = null;

    constructor(config: BaseTokenAuthConfig = {}) {
        this._authUrl = (config.authUrl ?? '').replace(/\/+$/, '');
        this.logger = config.logger ?? defaultLogger;
        this._onAuthStateChanged = config.onAuthStateChanged ?? (() => {});
    }

    // Injection hooks — RoolClient's AuthManager calls these for providers it
    // didn't construct itself, so a custom provider gets the resolved auth URL,
    // logger, and a handler that bridges auth-state to client events.
    setAuthUrl(url: string): void {
        this._authUrl = url.replace(/\/+$/, '');
    }

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    setAuthStateChangedHandler(handler: (authenticated: boolean) => void): void {
        this._onAuthStateChanged = handler;
    }

    // Subclass responsibilities: how a session is initiated and initialized.
    abstract initialize(): boolean;
    abstract login(appName: string, params?: Record<string, string>): Promise<void> | void;
    abstract signup(appName: string, params?: Record<string, string>): Promise<void> | void;

    /**
     * Check if user is currently authenticated.
     *
     * This reports identity (do we hold credentials), NOT server reachability.
     * It deliberately does not perform a network refresh: a backend outage must
     * not read as "logged out". A genuinely invalid/expired refresh token
     * surfaces later as a 401 on first real use, which clears tokens and fires
     * onAuthStateChanged(false) — the only path that ends the session.
     */
    async isAuthenticated(): Promise<boolean> {
        return this.readAccessToken() !== null;
    }

    /**
     * Get current access token and rool token, refreshing if expired.
     * Returns undefined if not authenticated.
     */
    async getTokens(): Promise<{ accessToken: string; roolToken: string } | undefined> {
        const accessToken = this.readAccessToken();
        if (!accessToken) return undefined;

        // Token expired or about to expire - try refresh
        const expiresAt = this.readExpiresAt();
        if (expiresAt && Date.now() >= expiresAt - REFRESH_BUFFER_MS) {
            const refreshed = await this.tryRefreshToken();
            if (!refreshed) return undefined;
            const refreshedToken = this.readAccessToken();
            if (!refreshedToken) return undefined;
            return { accessToken: refreshedToken, roolToken: this.readRoolToken() };
        }

        return { accessToken, roolToken: this.readRoolToken() };
    }

    /**
     * Get auth identity decoded from JWT token.
     */
    getAuthUser(): AuthUser {
        const accessToken = this.readAccessToken();
        if (!accessToken) return { email: null, name: null };
        return this.decodeAuthUser(accessToken);
    }

    /**
     * Complete an email verification flow. Exchanges a verify JWT (from the
     * verification email link) for a fresh token set and signs the user in.
     */
    async verify(token: string): Promise<boolean> {
        let response: Response;
        try {
            response = await fetch(`${this.authBaseUrl}/verify-and-signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
        } catch (error) {
            this.logger.error('[RoolClient] verify network error:', error);
            return false;
        }

        if (!response.ok) {
            this.logger.warn(`[RoolClient] verify failed: ${response.status}`);
            return false;
        }

        let data: {
            id_token?: string;
            refresh_token?: string;
            expires_in?: number;
            rool_token?: string;
        };
        try {
            data = await response.json();
        } catch (error) {
            this.logger.error('[RoolClient] verify response parse error:', error);
            return false;
        }

        const idToken = data.id_token ?? null;
        const refreshToken = data.refresh_token ?? null;
        const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : NaN;
        if (!idToken || !Number.isFinite(expiresAt)) {
            this.logger.error('[RoolClient] verify response missing id_token or expires_in');
            return false;
        }

        this.acceptTokens(idToken, refreshToken, data.rool_token ?? null, expiresAt);
        this.notifyAuthState(true);
        return true;
    }

    /**
     * Logout - clear all tokens and state.
     */
    logout(): void {
        this.clearTokens();
        this.clearTransientState();
        this.cancelScheduledRefresh();
        this.notifyAuthState(false);
    }

    /**
     * Destroy auth manager - clear refresh timers and listeners.
     */
    destroy(): void {
        this.cancelScheduledRefresh();
        if (this.boundVisibilityHandler) {
            document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
            this.boundVisibilityHandler = null;
        }
    }

    // ===========================================================================
    // Protected helpers for subclasses
    // ===========================================================================

    /** Auth URL without trailing slash */
    protected get authBaseUrl(): string {
        return this._authUrl;
    }

    protected notifyAuthState(authenticated: boolean): void {
        this._onAuthStateChanged(authenticated);
    }

    /** Persist a fresh token set and (re)arm the background refresh timer. */
    protected acceptTokens(
        accessToken: string,
        refreshToken: string | null,
        roolToken: string | null,
        expiresAt: number
    ): void {
        this.writeTokens(accessToken, refreshToken, expiresAt);
        this.writeRoolToken(roolToken);
        this.scheduleTokenRefresh();
    }

    /** Arm auto-refresh + visibility re-scheduling. Call from initialize(). */
    protected initBase(): void {
        this.scheduleTokenRefresh();
        this.listenForVisibility();
    }

    /**
     * Overridable hook: clear subclass-owned transient state on logout/cancel
     * (e.g. an in-flight OAuth `state` or PKCE verifier). No-op by default.
     */
    protected clearTransientState(): void {}

    protected get storagePrefix(): string {
        return `${DEFAULT_STORAGE_PREFIX}${this.endpointHash}_`;
    }

    /** Build a storage key scoped to this auth endpoint. */
    protected keyFor(name: string): string {
        return `${this.storagePrefix}${name}`;
    }

    protected get storageKeys() {
        const prefix = this.storagePrefix;
        return {
            access: `${prefix}access_token`,
            refresh: `${prefix}refresh_token`,
            rool: `${prefix}rool_token`,
            expiresAt: `${prefix}token_expires_at`,
        } as const;
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
            // Ignore storage restrictions
        }
    }

    protected removeString(key: string): void {
        try {
            localStorage.removeItem(key);
        } catch {
            // Ignore storage restrictions
        }
    }

    protected scheduleTokenRefresh(): void {
        this.cancelScheduledRefresh();

        const expiresAt = this.readExpiresAt();
        if (!expiresAt) return;

        const refreshAt = expiresAt - REFRESH_BUFFER_MS;
        const delay = refreshAt - Date.now();

        if (delay <= 0) {
            // Already needs refresh
            void this.tryRefreshToken();
        } else {
            this.refreshTimeoutId = setTimeout(() => {
                void this.tryRefreshToken();
            }, delay);
        }
    }

    protected writeTokens(
        accessToken: string | null,
        refreshToken: string | null,
        expiresAt: number | null
    ): void {
        if (accessToken) {
            localStorage.setItem(this.storageKeys.access, accessToken);
        } else {
            localStorage.removeItem(this.storageKeys.access);
        }

        if (refreshToken) {
            localStorage.setItem(this.storageKeys.refresh, refreshToken);
        } else {
            localStorage.removeItem(this.storageKeys.refresh);
        }

        if (expiresAt !== null && Number.isFinite(expiresAt)) {
            localStorage.setItem(this.storageKeys.expiresAt, Math.floor(expiresAt).toString());
        } else {
            localStorage.removeItem(this.storageKeys.expiresAt);
        }
    }

    protected writeRoolToken(token: string | null): void {
        if (token) {
            localStorage.setItem(this.storageKeys.rool, token);
        } else {
            localStorage.removeItem(this.storageKeys.rool);
        }
    }

    protected clearTokens(): void {
        this.writeTokens(null, null, null);
        this.writeRoolToken(null);
    }

    protected readAccessToken(): string | null {
        return localStorage.getItem(this.storageKeys.access);
    }

    protected readRoolToken(): string {
        return localStorage.getItem(this.storageKeys.rool) ?? '';
    }

    protected readExpiresAt(): number | null {
        const raw = localStorage.getItem(this.storageKeys.expiresAt);
        if (!raw) return null;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    // ===========================================================================
    // Private
    // ===========================================================================

    /**
     * Get a short hash of the auth URL for scoping storage by endpoint.
     */
    private get endpointHash(): string {
        const url = this.authBaseUrl;
        // Simple djb2 hash
        let hash = 5381;
        for (let i = 0; i < url.length; i++) {
            hash = ((hash << 5) + hash) ^ url.charCodeAt(i);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    private async tryRefreshToken(): Promise<boolean> {
        // Deduplicate concurrent refresh attempts
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        const refreshToken = localStorage.getItem(this.storageKeys.refresh);
        if (!refreshToken) return false;
        const roolToken = localStorage.getItem(this.storageKeys.rool);

        this.refreshPromise = (async () => {
            let response: Response;
            try {
                response = await fetch(`${this.authBaseUrl}/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        refresh_token: refreshToken,
                        rool_token: roolToken,
                    }),
                });
            } catch (error) {
                // Network error - don't clear tokens, might work next time
                this.logger.warn('[RoolClient] Token refresh network error:', error);
                return false;
            }

            // 400/401 = refresh token is invalid, clear everything
            if (response.status === 400 || response.status === 401) {
                this.logger.warn('[RoolClient] Refresh token invalid, clearing credentials');
                this.clearTokens();
                this.notifyAuthState(false);
                return false;
            }

            // Other HTTP errors - don't clear tokens, might be transient
            if (!response.ok) {
                this.logger.warn(`[RoolClient] Token refresh failed: ${response.status} ${response.statusText}`);
                return false;
            }

            // Success - parse and store new tokens
            try {
                const data = await response.json();
                const accessToken: string | null = data.id_token ?? null;
                const nextRefreshToken: string | null = data.refresh_token ?? refreshToken;
                const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : NaN;

                if (!accessToken || !Number.isFinite(expiresAt)) {
                    this.logger.error('[RoolClient] Refresh response missing id_token or expires_in');
                    return false;
                }

                this.writeTokens(accessToken, nextRefreshToken, expiresAt);
                this.writeRoolToken(data.rool_token ?? null);
                this.scheduleTokenRefresh();
                return true;
            } catch (error) {
                this.logger.error('[RoolClient] Failed to parse refresh response:', error);
                return false;
            }
        })().finally(() => {
            this.refreshPromise = null;
        });

        return this.refreshPromise;
    }

    private listenForVisibility(): void {
        if (typeof document === 'undefined') return;
        if (this.boundVisibilityHandler) return;

        this.boundVisibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                this.scheduleTokenRefresh();
            }
        };
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }

    private cancelScheduledRefresh(): void {
        if (this.refreshTimeoutId !== null) {
            clearTimeout(this.refreshTimeoutId);
            this.refreshTimeoutId = null;
        }
    }

    private decodeAuthUser(accessToken: string): AuthUser {
        try {
            const payload = JSON.parse(atob(accessToken.split('.')[1]));
            return {
                email: payload.email || null,
                name: payload.name || null,
            };
        } catch (error) {
            this.logger.error('[RoolClient] Failed to decode token:', error);
            return { email: null, name: null };
        }
    }
}
