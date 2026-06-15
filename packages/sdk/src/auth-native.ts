// =============================================================================
// Native PKCE auth provider
// For app shells that run JavaScript but sign in through an external system
// browser (Capacitor, Cordova, Tauri, ...). The app hands off to the auth
// server's /authorize in an external browser, then feeds the deep-link callback
// back into handleRedirect(), which exchanges the code + verifier at /token.
//
// The SDK stays platform-agnostic: the app injects how to open an external URL
// (openExternal) and calls handleRedirect() from its own deep-link listener.
// Token storage and refresh are inherited from BaseTokenAuthProvider.
// =============================================================================

import { BaseTokenAuthProvider } from './auth-base.js';
import type { PasswordSignInResult } from './types.js';

export type NativeAuthFlowProvider = 'google' | 'apple';

export interface NativePkceAuthConfig {
    /**
     * Deep-link redirect URI registered by the app. Must match the auth
     * server's native-client allowlist exactly, e.g.
     * 'roolandroidauth://auth/callback' or 'rooliosauth://auth/callback'.
     */
    redirectUri: string;
    /** Identity provider used when login()/signup() are called without one. */
    defaultProvider?: NativeAuthFlowProvider;
    /**
     * Open a URL in an external system browser (NOT the app webview), e.g.
     * Capacitor's `Browser.open({ url })`. PKCE requires the authorization
     * step to happen outside the app so the app never sees provider secrets.
     */
    openExternal: (url: string) => void | Promise<void>;
}

export class NativePkceAuthProvider extends BaseTokenAuthProvider {
    private readonly redirectUri: string;
    private readonly defaultProvider: NativeAuthFlowProvider;
    private readonly openExternal: (url: string) => void | Promise<void>;

    constructor(config: NativePkceAuthConfig) {
        super();
        this.redirectUri = config.redirectUri;
        this.defaultProvider = config.defaultProvider ?? 'google';
        this.openExternal = config.openExternal;
    }

    /**
     * No synchronous callback to process — the app drives completion via
     * handleRedirect(). Just arm refresh for any persisted session.
     */
    initialize(): boolean {
        this.initBase();
        return false;
    }

    /**
     * Begin sign-in. `params.provider` ('google' | 'apple') overrides the
     * default; `params.rvid` is forwarded for signup attribution.
     */
    login(_appName: string, params?: Record<string, string>): Promise<void> {
        return this.startPkce(params);
    }

    /**
     * Same flow as login — the providers don't distinguish signup from login
     * for native, and the auth server creates the account on first sign-in.
     */
    signup(_appName: string, params?: Record<string, string>): Promise<void> {
        return this.startPkce(params);
    }

    /**
     * Complete a sign-in from the deep link the app received (e.g. Capacitor's
     * appUrlOpen). Validates state, exchanges the code + stored verifier at
     * /token, and persists the session. Returns true once signed in.
     */
    async handleRedirect(url: string): Promise<boolean> {
        if (!url.startsWith(this.redirectUri)) return false;

        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return false;
        }

        const error = parsed.searchParams.get('error');
        if (error) {
            this.logger.warn(`[RoolClient] Native auth error: ${error}`);
            this.clearTransientState();
            return false;
        }

        const code = parsed.searchParams.get('code');
        const incomingState = parsed.searchParams.get('state');
        if (!code) return false;

        const verifier = this.readString(this.verifierKey);
        const storedState = this.readString(this.stateKey);
        if (!verifier) {
            this.logger.error('[RoolClient] No PKCE verifier for redirect. Ignored.');
            return false;
        }
        if (storedState && incomingState !== storedState) {
            this.logger.error('[RoolClient] Native auth state mismatch. Ignored.');
            this.clearTransientState();
            return false;
        }

        let response: Response;
        try {
            response = await fetch(`${this.authBaseUrl}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: verifier }),
            });
        } catch (err) {
            // Network error - keep the verifier so a retry can still complete.
            this.logger.error('[RoolClient] /token network error:', err);
            return false;
        }

        // The code is single-use and the verifier is now spent either way.
        this.clearTransientState();

        if (!response.ok) {
            this.logger.warn(`[RoolClient] /token failed: ${response.status}`);
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
        } catch (err) {
            this.logger.error('[RoolClient] /token response parse error:', err);
            return false;
        }

        const idToken = data.id_token ?? null;
        const refreshToken = data.refresh_token ?? null;
        const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : NaN;
        if (!idToken || !Number.isFinite(expiresAt)) {
            this.logger.error('[RoolClient] /token response missing id_token or expires_in');
            return false;
        }

        this.acceptTokens(idToken, refreshToken, data.rool_token ?? null, expiresAt);
        this.notifyAuthState(true);
        return true;
    }

    /**
     * Sign in with email + password. No redirect involved — the auth server
     * returns the token set as JSON, which we persist directly.
     *
     * Resolves `signed_in` on success, or `verify_required` when the account's
     * email isn't verified (the server has emailed a magic link). Rejects with
     * a human-readable Error on bad credentials or server failure.
     */
    async signInWithPassword(email: string, password: string): Promise<PasswordSignInResult> {
        let response: Response;
        try {
            response = await fetch(`${this.authBaseUrl}/login-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
        } catch (err) {
            this.logger.error('[RoolClient] login-password network error:', err);
            throw new Error('Network error. Please try again.');
        }

        let data: {
            ok?: boolean;
            status?: 'signed_in' | 'verify_required';
            error?: string;
            id_token?: string;
            refresh_token?: string;
            expires_in?: number;
            rool_token?: string;
        };
        try {
            data = await response.json();
        } catch {
            throw new Error('Unexpected response. Please try again.');
        }

        if (!response.ok || data.ok === false) {
            throw new Error(data.error || 'Invalid email or password.');
        }

        if (data.status === 'verify_required') {
            return { status: 'verify_required' };
        }

        const idToken = data.id_token ?? null;
        const refreshToken = data.refresh_token ?? null;
        const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : NaN;
        if (!idToken || !Number.isFinite(expiresAt)) {
            this.logger.error('[RoolClient] login-password response missing id_token or expires_in');
            throw new Error('Sign-in failed. Please try again.');
        }

        this.acceptTokens(idToken, refreshToken, data.rool_token ?? null, expiresAt);
        this.notifyAuthState(true);
        return { status: 'signed_in' };
    }

    /**
     * Request a magic sign-in link by email. The server emails a link carrying
     * a verify token; the user completes sign-in by following it, which lands
     * back in the app and is finished via `verify(token)`. Resolves once the
     * email is accepted; rejects with a human-readable Error if the address is
     * rejected (invalid / disposable / unreachable).
     *
     * NOTE: the emailed link is an https URL (`<appsDomain>/?verify=…`), so on
     * native it only re-opens the app if Universal Links / App Links are set up
     * for that domain. Without them the link completes on the website instead.
     */
    async requestMagicLink(email: string): Promise<void> {
        let response: Response;
        try {
            response = await fetch(`${this.authBaseUrl}/magic-link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
        } catch (err) {
            this.logger.error('[RoolClient] magic-link network error:', err);
            throw new Error('Network error. Please try again.');
        }

        let data: { ok?: boolean; error?: string };
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok || data.ok === false) {
            throw new Error(data.error || 'Could not send the sign-in link. Please try again.');
        }
    }

    // ===========================================================================
    // Private
    // ===========================================================================

    private get verifierKey(): string {
        return this.keyFor('pkce_verifier');
    }

    private get stateKey(): string {
        return this.keyFor('pkce_state');
    }

    private async startPkce(params?: Record<string, string>): Promise<void> {
        const provider = normalizeProvider(params?.provider) ?? this.defaultProvider;
        const verifier = generateCodeVerifier();
        const challenge = await deriveCodeChallenge(verifier);
        const state = generateState();

        // Stash the verifier + state for handleRedirect(). localStorage (not
        // sessionStorage) so it survives the app being backgrounded while the
        // external browser is in front.
        this.writeString(this.verifierKey, verifier);
        this.writeString(this.stateKey, state);

        const url = new URL(`${this.authBaseUrl}/authorize`);
        url.searchParams.set('provider', provider);
        url.searchParams.set('redirect_uri', this.redirectUri);
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        if (params?.rvid) url.searchParams.set('rvid', params.rvid);

        await this.openExternal(url.toString());
    }

    protected clearTransientState(): void {
        this.removeString(this.verifierKey);
        this.removeString(this.stateKey);
    }
}

function normalizeProvider(value: string | undefined): NativeAuthFlowProvider | null {
    return value === 'google' || value === 'apple' ? value : null;
}

/** RFC 7636 code verifier: base64url of 32 random bytes (43 chars, unreserved). */
function generateCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes.buffer);
}

/** S256 challenge: base64url(SHA-256(verifier)). */
async function deriveCodeChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64UrlEncode(digest);
}

function generateState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
