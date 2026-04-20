// =============================================================================
// Auth Manager
// Handles authentication via configurable AuthProvider
// =============================================================================

import type { AuthUser, AuthProvider } from './types.js';
import { BrowserAuthProvider } from './auth-browser.js';
import type { Logger } from './logger.js';

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
      if ('setAuthUrl' in this.provider && typeof (this.provider as any).setAuthUrl === 'function') {
        (this.provider as any).setAuthUrl(config.authUrl);
      }
      // Inject logger if the provider supports it
      if ('setLogger' in this.provider && typeof (this.provider as any).setLogger === 'function') {
        (this.provider as any).setLogger(config.logger);
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
   * Logout - clear all tokens and state.
   */
  logout(): void {
    this.provider.logout();
  }

  /**
   * Set or change the authenticated user's password.
   * Requires a live session (Firebase id token). Throws on error.
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

    if (!response.ok) {
      let message = `set-password failed: ${response.status}`;
      try {
        const data = await response.json();
        if (data && typeof data.error === 'string') message = data.error;
      } catch { /* fall through to default message */ }
      throw new Error(message);
    }
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
