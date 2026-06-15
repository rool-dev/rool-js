// =============================================================================
// Browser auth provider
// Full-page redirect flow: hands off to the auth pages and reads the returned
// tokens from the URL fragment on the way back. Token storage and refresh live
// in BaseTokenAuthProvider.
// =============================================================================

import { BaseTokenAuthProvider, type BaseTokenAuthConfig } from './auth-base.js';

export type BrowserAuthConfig = BaseTokenAuthConfig;

export class BrowserAuthProvider extends BaseTokenAuthProvider {
    /**
     * Initialize auth manager - should be called on app startup.
     * Processes any auth callback in the URL and sets up auto-refresh.
     */
    initialize(): boolean {
        const wasCallback = this.processCallback();
        this.initBase();
        return wasCallback;
    }

    /**
     * Initiate login by redirecting to auth page.
     * @param appName - The name of the application requesting login (displayed on auth page)
     */
    login(appName: string, params?: Record<string, string>): void {
        this.redirectToAuth('login', appName, params);
    }

    /**
     * Initiate signup by redirecting to auth page.
     * @param appName - The name of the application requesting signup (displayed on auth page)
     */
    signup(appName: string, params?: Record<string, string>): void {
        this.redirectToAuth('signup', appName, params);
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

        // Validate state — only enforce when both sides have one (SDK-initiated
        // flow). When the auth page is opened directly (e.g., link from the
        // website), there's no incoming state and nothing to validate against.
        if (storedState && incomingState && incomingState !== storedState) {
            this.logger.error('[RoolClient] Auth state mismatch. Token fragment ignored.');
            return false;
        }

        if (!Number.isFinite(expiresAt)) {
            this.logger.error('[RoolClient] Auth response missing expires_in. Token ignored.');
            return false;
        }

        // Clear state and store tokens
        this.clearState();
        this.acceptTokens(idToken, refreshToken, roolToken, expiresAt);

        // Clean URL
        const cleanUrl = window.location.origin + window.location.pathname + window.location.search;
        window.history.replaceState({}, document.title, cleanUrl);

        this.notifyAuthState(true);
        return true;
    }

    // ===========================================================================
    // Private
    // ===========================================================================

    private redirectToAuth(flow: 'login' | 'signup', appName: string, params?: Record<string, string>): void {
        const origin = new URL(this.authBaseUrl).origin;
        const url = new URL(`${origin}/${flow}`);
        const redirectTarget = window.location.origin + window.location.pathname + window.location.search;
        url.searchParams.set('redirect_uri', redirectTarget);
        url.searchParams.set('app_name', appName);

        if (params) {
            for (const [key, value] of Object.entries(params)) {
                url.searchParams.set(key, value);
            }
        }

        const state = this.generateState();
        this.storeState(state);
        url.searchParams.set('state', state);

        window.location.href = url.toString();
    }

    protected clearTransientState(): void {
        this.clearState();
    }

    private get stateKey(): string {
        return this.keyFor('auth_state');
    }

    private storeState(value: string): void {
        try {
            sessionStorage.setItem(this.stateKey, value);
        } catch {
            // Ignore storage restrictions
        }
    }

    private readState(): string | null {
        try {
            return sessionStorage.getItem(this.stateKey);
        } catch {
            return null;
        }
    }

    private clearState(): void {
        try {
            sessionStorage.removeItem(this.stateKey);
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
}
