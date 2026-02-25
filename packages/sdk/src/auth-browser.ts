
import type { AuthProvider, AuthUser } from './types.js';
import type { Logger } from './logger.js';

const REFRESH_BUFFER_MS = 15 * 60 * 1000; // Refresh 15 minutes before expiry

const DEFAULT_STORAGE_PREFIX = 'rool_';

export interface BrowserAuthConfig {
    /** Auth service URL (e.g. https://api.dev.rool.dev/auth) */
    authUrl: string;
    logger: Logger;
    onAuthStateChanged: (authenticated: boolean) => void;
}

export class BrowserAuthProvider implements AuthProvider {
    private config: BrowserAuthConfig;
    private logger: Logger;
    private refreshPromise: Promise<boolean> | null = null;
    private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private boundVisibilityHandler: (() => void) | null = null;

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

    /**
     * Get the storage prefix, incorporating endpoint hash.
     */
    private get storagePrefix(): string {
        return `${DEFAULT_STORAGE_PREFIX}${this.endpointHash}_`;
    }

    private get storageKeys() {
        const prefix = this.storagePrefix;
        return {
            access: `${prefix}access_token`,
            refresh: `${prefix}refresh_token`,
            rool: `${prefix}rool_token`,
            expiresAt: `${prefix}token_expires_at`,
            state: `${prefix}auth_state`,
        } as const;
    }

    /** Auth URL without trailing slash */
    private get authBaseUrl(): string {
        return this.config.authUrl.replace(/\/+$/, '');
    }

    constructor(config: BrowserAuthConfig) {
        this.config = config;
        this.logger = config.logger;
    }

    /**
     * Initialize auth manager - should be called on app startup.
     * Processes any auth callback in the URL and sets up auto-refresh.
     */
    initialize(): boolean {
        const wasCallback = this.processCallback();
        this.scheduleTokenRefresh();
        this.listenForVisibility();
        return wasCallback;
    }

    /**
     * Check if user is currently authenticated (validates token is usable).
     */
    async isAuthenticated(): Promise<boolean> {
        const tokens = await this.getTokens();
        return tokens !== undefined;
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
     * Initiate login by redirecting to auth page.
     * @param appName - The name of the application requesting login (displayed on auth page)
     */
    login(appName: string): void {
        const loginUrl = new URL(`${this.authBaseUrl}/`);
        const redirectTarget = window.location.origin + window.location.pathname + window.location.search;
        loginUrl.searchParams.set('redirect_uri', redirectTarget);
        loginUrl.searchParams.set('app_name', appName);

        const state = this.generateState();
        this.storeState(state);
        loginUrl.searchParams.set('state', state);

        window.location.href = loginUrl.toString();
    }

    /**
     * Logout - clear all tokens and state.
     */
    logout(): void {
        this.clearTokens();
        this.clearState();
        this.cancelScheduledRefresh();
        this.config.onAuthStateChanged(false);
    }

    /**
     * Process auth callback from URL fragment.
     * Should be called on page load.
     * @returns true if callback was processed
     */
    processCallback(): boolean {
        const hash = window.location.hash ?? '';
        const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
        if (!trimmed) return false;

        const params = new URLSearchParams(trimmed);
        const idToken = params.get('id_token');
        if (!idToken) return false;

        const refreshToken = params.get('refresh_token');
        const roolToken = params.get('rool_token');
        const expiresIn = params.get('expires_in');
        const expiresAt = expiresIn ? Date.now() + Number(expiresIn) * 1000 : NaN;
        const incomingState = params.get('state');
        const storedState = this.readState();

        // Validate state - if we stored one, require it back
        if (storedState && incomingState !== storedState) {
            this.logger.error('[RoolClient] Auth state mismatch. Token fragment ignored.');
            return false;
        }

        if (!Number.isFinite(expiresAt)) {
            this.logger.error('[RoolClient] Auth response missing expires_in. Token ignored.');
            return false;
        }

        // Clear state and store tokens
        this.clearState();
        this.writeTokens(idToken, refreshToken, expiresAt);
        this.writeRoolToken(roolToken);

        // Clean URL
        const cleanUrl = window.location.origin + window.location.pathname + window.location.search;
        window.history.replaceState({}, document.title, cleanUrl);

        // Schedule refresh and notify
        this.scheduleTokenRefresh();
        this.config.onAuthStateChanged(true);

        return true;
    }

    /**
     * Destroy auth manager - clear refresh timers.
     */
    destroy(): void {
        this.cancelScheduledRefresh();
        if (this.boundVisibilityHandler) {
            document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
            this.boundVisibilityHandler = null;
        }
    }

    /**
     * Get cached storage data from localStorage.
     */
    getStorage(): Record<string, unknown> | null {
        try {
            const key = `${this.storagePrefix}user_storage`;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    /**
     * Set cached storage data to localStorage.
     */
    setStorage(data: Record<string, unknown>): void {
        try {
            const key = `${this.storagePrefix}user_storage`;
            localStorage.setItem(key, JSON.stringify(data));
        } catch {
            // Ignore localStorage errors
        }
    }

    // ===========================================================================
    // Private methods
    // ===========================================================================

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
                this.config.onAuthStateChanged(false);
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

    private scheduleTokenRefresh(): void {
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

    private readAccessToken(): string | null {
        return localStorage.getItem(this.storageKeys.access);
    }

    private readRoolToken(): string {
        return localStorage.getItem(this.storageKeys.rool) ?? '';
    }

    private readExpiresAt(): number | null {
        const raw = localStorage.getItem(this.storageKeys.expiresAt);
        if (!raw) return null;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private writeTokens(
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

    private writeRoolToken(token: string | null): void {
        if (token) {
            localStorage.setItem(this.storageKeys.rool, token);
        } else {
            localStorage.removeItem(this.storageKeys.rool);
        }
    }

    private clearTokens(): void {
        this.writeTokens(null, null, null);
        this.writeRoolToken(null);
    }

    private storeState(value: string): void {
        try {
            sessionStorage.setItem(this.storageKeys.state, value);
        } catch {
            // Ignore storage restrictions
        }
    }

    private readState(): string | null {
        try {
            return sessionStorage.getItem(this.storageKeys.state);
        } catch {
            return null;
        }
    }

    private clearState(): void {
        try {
            sessionStorage.removeItem(this.storageKeys.state);
        } catch {
            // Ignore storage restrictions
        }
    }

    private generateState(): string {
        try {
            const buffer = new Uint8Array(16);
            window.crypto.getRandomValues(buffer);
            return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
        } catch {
            return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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
