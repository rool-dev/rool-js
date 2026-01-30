
import type { AuthProvider, AuthUser } from './types.js';

const GCIP_REFRESH_ENDPOINT = 'https://securetoken.googleapis.com/v1/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

const DEFAULT_STORAGE_PREFIX = 'rool_';

export interface BrowserAuthConfig {
    /** Auth service URL (e.g. https://api.dev.rool.dev/auth) */
    authUrl: string;
    storagePrefix?: string;
    onAuthStateChanged: (authenticated: boolean) => void;
}

export class BrowserAuthProvider implements AuthProvider {
    private config: BrowserAuthConfig;
    private apiKey: string | null = null;
    private apiKeyFetchPromise: Promise<string | null> | null = null;
    private refreshPromise: Promise<boolean> | null = null;
    private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;

    private get storageKeys() {
        const prefix = this.config.storagePrefix ?? DEFAULT_STORAGE_PREFIX;
        return {
            access: `${prefix}access_token`,
            refresh: `${prefix}refresh_token`,
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
    }

    /**
     * Initialize auth manager - should be called on app startup.
     * Processes any auth callback in the URL and sets up auto-refresh.
     */
    initialize(): boolean {
        const wasCallback = this.processCallback();
        this.scheduleTokenRefresh();
        return wasCallback;
    }

    /**
     * Check if user is currently authenticated (validates token is usable).
     */
    async isAuthenticated(): Promise<boolean> {
        const token = await this.getToken();
        return token !== undefined;
    }

    /**
     * Get current access token, refreshing if expired.
     * Returns undefined if not authenticated.
     */
    async getToken(): Promise<string | undefined> {
        const accessToken = this.readAccessToken();
        const expiresAt = this.readExpiresAt();

        if (!accessToken) return undefined;

        // Token expired or about to expire - try refresh
        if (expiresAt && Date.now() >= expiresAt - REFRESH_BUFFER_MS) {
            const refreshed = await this.tryRefreshToken();
            if (!refreshed) return undefined;
            return this.readAccessToken() ?? undefined;
        }

        return accessToken;
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
        const expiresIn = params.get('expires_in');
        const expiresAt = expiresIn ? Date.now() + Number(expiresIn) * 1000 : NaN;
        const incomingState = params.get('state');
        const storedState = this.readState();

        // Validate state - if we stored one, require it back
        if (storedState && incomingState !== storedState) {
            console.error('[RoolClient] Auth state mismatch. Token fragment ignored.');
            return false;
        }

        if (!Number.isFinite(expiresAt)) {
            console.error('[RoolClient] Auth response missing expires_in. Token ignored.');
            return false;
        }

        // Clear state and store tokens
        this.clearState();
        this.writeTokens(idToken, refreshToken, expiresAt);

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
    }

    /**
     * Get cached storage data from localStorage.
     */
    getStorage(): Record<string, unknown> | null {
        try {
            const key = `${this.config.storagePrefix ?? DEFAULT_STORAGE_PREFIX}user_storage`;
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
            const key = `${this.config.storagePrefix ?? DEFAULT_STORAGE_PREFIX}user_storage`;
            localStorage.setItem(key, JSON.stringify(data));
        } catch {
            // Ignore localStorage errors
        }
    }

    // ===========================================================================
    // Private methods
    // ===========================================================================

    /**
     * Get the API key, fetching from server if not provided in config.
     */
    private async getApiKey(): Promise<string | null> {
        // Already have it
        if (this.apiKey) return this.apiKey;

        // Already fetching
        if (this.apiKeyFetchPromise) return this.apiKeyFetchPromise;

        // Fetch from server
        this.apiKeyFetchPromise = fetch(`${this.authBaseUrl}/config.json`)
            .then(async (response) => {
                if (!response.ok) {
                    console.warn('[RoolClient] Failed to fetch API key from server');
                    return null;
                }
                const data = await response.json();
                if (data.apiKey && typeof data.apiKey === 'string') {
                    this.apiKey = data.apiKey;
                    return this.apiKey;
                }
                return null;
            })
            .catch((error) => {
                console.warn('[RoolClient] Failed to fetch API key:', error);
                return null;
            })
            .finally(() => {
                this.apiKeyFetchPromise = null;
            });

        return this.apiKeyFetchPromise;
    }

    private async tryRefreshToken(): Promise<boolean> {
        // Deduplicate concurrent refresh attempts
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        const refreshToken = localStorage.getItem(this.storageKeys.refresh);
        if (!refreshToken) return false;

        // Get API key (from config or server)
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            console.warn('[RoolClient] Cannot refresh token: no API key available');
            return false;
        }

        const refreshUrl = new URL(GCIP_REFRESH_ENDPOINT);
        refreshUrl.searchParams.set('key', apiKey);

        this.refreshPromise = (async () => {
            let response: Response;
            try {
                response = await fetch(refreshUrl.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'refresh_token',
                        refresh_token: refreshToken,
                    }),
                });
            } catch (error) {
                // Network error - don't clear tokens, might work next time
                console.warn('[RoolClient] Token refresh network error:', error);
                return false;
            }

            // 400/401 = refresh token is invalid, clear everything
            if (response.status === 400 || response.status === 401) {
                console.warn('[RoolClient] Refresh token invalid, clearing credentials');
                this.clearTokens();
                this.config.onAuthStateChanged(false);
                return false;
            }

            // Other HTTP errors - don't clear tokens, might be transient
            if (!response.ok) {
                console.warn(`[RoolClient] Token refresh failed: ${response.status} ${response.statusText}`);
                return false;
            }

            // Success - parse and store new tokens
            try {
                const data = await response.json();
                const accessToken: string | null = data.id_token ?? data.access_token ?? null;
                const nextRefreshToken: string | null = data.refresh_token ?? refreshToken;
                const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : NaN;

                if (!accessToken || !Number.isFinite(expiresAt)) {
                    console.error('[RoolClient] Refresh response missing access token or expires_in');
                    return false;
                }

                this.writeTokens(accessToken, nextRefreshToken, expiresAt);
                this.scheduleTokenRefresh();
                return true;
            } catch (error) {
                console.error('[RoolClient] Failed to parse refresh response:', error);
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

    private cancelScheduledRefresh(): void {
        if (this.refreshTimeoutId !== null) {
            clearTimeout(this.refreshTimeoutId);
            this.refreshTimeoutId = null;
        }
    }

    private readAccessToken(): string | null {
        return localStorage.getItem(this.storageKeys.access);
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

    private clearTokens(): void {
        this.writeTokens(null, null, null);
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
            console.error('[RoolClient] Failed to decode token:', error);
            return { email: null, name: null };
        }
    }
}
