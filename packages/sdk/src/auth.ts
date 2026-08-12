// =============================================================================
// Auth Manager
// Handles authentication via configurable AuthProvider
// =============================================================================

import type { AuthUser, AuthProvider, PasswordSignInResult } from './types.js';
import { BrowserAuthProvider } from './auth-browser.js';
import type { Logger } from './logger.js';

export type EmailChangeErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'missing_email'
  | 'invalid_email'
  | 'account_not_found'
  | 'account_suspended'
  | 'same_email'
  | 'email_in_use'
  | 'send_failed'
  | 'internal_error';

export class EmailChangeError extends Error {
  constructor(readonly code: EmailChangeErrorCode, message: string) {
    super(message);
    this.name = 'EmailChangeError';
  }
}

export interface AuthManagerConfig {
  authUrl: string;
  logger: Logger;
  onAuthStateChanged?: (authenticated: boolean) => void;
  /** External auth provider - when set, delegates all auth to this provider */
  authProvider?: AuthProvider;
}

export class AuthManager {
  private provider: AuthProvider;
  private authUrl: string;

  constructor(config: AuthManagerConfig) {
    this.authUrl = config.authUrl.replace(/\/+$/, '');
    if (config.authProvider) {
      this.provider = config.authProvider;
      // Inject auth URL if the provider supports it (e.g. NodeAuthProvider)
      this.provider.setAuthUrl?.(config.authUrl);
      // Inject logger if the provider supports it
      this.provider.setLogger?.(config.logger);
      // Bridge auth-state to client events/state (e.g. NativePkceAuthProvider),
      // so provider-driven sign-out and 401 token clearing reach the client.
      if (config.onAuthStateChanged) {
        this.provider.setAuthStateChangedHandler?.(config.onAuthStateChanged);
      }
    } else {
      // Default to BrowserAuthProvider if no external provider specified
      // This preserves existing behavior for browser usage
      this.provider = new BrowserAuthProvider({
        authUrl: config.authUrl,
        logger: config.logger,
        onAuthStateChanged: (authenticated) => {
          config.onAuthStateChanged?.(authenticated);
        },
      });
    }
  }

  /**
   * Initialize auth manager - should be called on app startup.
   */
  initialize(): boolean {
    return this.provider.initialize?.() ?? false;
  }

  /**
   * Check if user is currently authenticated (validates token is usable).
   */
  async isAuthenticated(): Promise<boolean> {
    return this.provider.isAuthenticated();
  }

  /**
   * Get current access token and rool token.
   * Returns undefined if not authenticated.
   */
  async getTokens(): Promise<{ accessToken: string; roolToken: string } | undefined> {
    return this.provider.getTokens();
  }

  /**
   * Get auth identity from current session (decoded from token).
   */
  getAuthUser(): AuthUser {
    return this.provider.getAuthUser();
  }

  /**
   * Initiate login.
   * @param appName - The name of the application requesting login (displayed on auth page)
   */
  login(appName: string, params?: Record<string, string>): Promise<void> | void {
    return this.provider.login(appName, params);
  }

  /**
   * Initiate signup.
   * @param appName - The name of the application requesting signup (displayed on auth page)
   */
  signup(appName: string, params?: Record<string, string>): Promise<void> | void {
    return this.provider.signup(appName, params);
  }

  /**
   * Complete an email verification flow. Returns true if the user is
   * signed in as a result.
   */
  async verify(token: string): Promise<boolean> {
    if (!this.provider.verify) return false;
    return this.provider.verify(token);
  }

  /**
   * Complete a native deep-link auth callback (PKCE providers). The app calls
   * this from its platform deep-link handler with the full callback URL.
   * Returns true if the user is signed in as a result.
   */
  async handleRedirect(url: string): Promise<boolean> {
    if (!this.provider.handleRedirect) return false;
    return this.provider.handleRedirect(url);
  }

  /**
   * Sign in with email + password. Resolves `signed_in` or `verify_required`;
   * rejects on bad credentials or if the provider doesn't support it.
   */
  async signInWithPassword(email: string, password: string): Promise<PasswordSignInResult> {
    if (!this.provider.signInWithPassword) {
      throw new Error('Password sign-in is not supported by this auth provider');
    }
    return this.provider.signInWithPassword(email, password);
  }

  /**
   * Request a magic sign-in link by email. Resolves once accepted; rejects on a
   * bad address or if the provider doesn't support it.
   */
  async requestMagicLink(email: string): Promise<void> {
    if (!this.provider.requestMagicLink) {
      throw new Error('Magic-link sign-in is not supported by this auth provider');
    }
    return this.provider.requestMagicLink(email);
  }

  /**
   * Logout - clear all tokens and state.
   */
  logout(): void {
    this.provider.logout();
  }

  /**
   * Set or change the authenticated user's password and install the replacement
   * session returned after all prior sessions are revoked.
   */
  async setPassword(password: string): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const response = await fetch(`${this.authUrl}/set-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ password }),
    });

    const data = await response.json().catch(() => null) as {
      id_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    } | null;

    if (!response.ok) {
      throw new Error(data?.error ?? `set-password failed: ${response.status}`);
    }

    const expiresAt = data?.expires_in
      ? Date.now() + data.expires_in * 1000
      : NaN;
    if (!data?.id_token || !data.refresh_token || !Number.isFinite(expiresAt)) {
      this.logout();
      return;
    }

    if (!this.provider.replaceTokens) {
      this.logout();
      return;
    }

    try {
      this.provider.replaceTokens({
        accessToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresAt,
      });
    } catch (error) {
      this.logout();
      throw error;
    }
  }

  /**
   * Request an email address change for the authenticated user. The server
   * mails a confirmation link to the new address; the change applies when
   * that link is clicked. After confirmation the current session no longer
   * belongs to the account — sign out and sign in with the new address.
   * Rejects with EmailChangeError (code + user-facing message) on refusal,
   * e.g. 'email_in_use' or 'invalid_email'.
   */
  async requestEmailChange(newEmail: string): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const response = await fetch(`${this.authUrl}/email-change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ new_email: newEmail }),
    });
    if (response.ok) return;

    const data = await response.json().catch(() => null) as {
      error?: string;
      message?: string;
    } | null;
    if (data?.error) {
      throw new EmailChangeError(data.error as EmailChangeErrorCode, data.message ?? data.error);
    }
    throw new Error(`email-change failed: ${response.status}`);
  }

  /**
   * Process auth callback from URL fragment.
   * Should be called on page load.
   * @returns true if callback was processed
   */
  processCallback(): boolean {
    // Only BrowserAuthProvider knows how to process URL callbacks
    if (this.provider instanceof BrowserAuthProvider) {
      return this.provider.processCallback();
    }
    return false;
  }

  /**
   * Destroy auth manager - cleanup resources.
   */
  destroy(): void {
    this.provider.destroy?.();
  }
}
