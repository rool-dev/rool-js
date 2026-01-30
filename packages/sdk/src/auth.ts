// =============================================================================
// Auth Manager
// Handles authentication via configurable AuthProvider
// =============================================================================

import type { AuthUser, AuthProvider } from './types.js';
import { BrowserAuthProvider } from './auth-browser.js';

export interface AuthManagerConfig {
  authUrl: string;
  onAuthStateChanged?: (authenticated: boolean) => void;
  /** External auth provider - when set, delegates all auth to this provider */
  authProvider?: AuthProvider;
}

export class AuthManager {
  private provider: AuthProvider;

  constructor(config: AuthManagerConfig) {
    if (config.authProvider) {
      this.provider = config.authProvider;
      // Inject auth URL if the provider supports it (e.g. NodeAuthProvider)
      if ('setAuthUrl' in this.provider && typeof (this.provider as any).setAuthUrl === 'function') {
        (this.provider as any).setAuthUrl(config.authUrl);
      }
    } else {
      // Default to BrowserAuthProvider if no external provider specified
      // This preserves existing behavior for browser usage
      this.provider = new BrowserAuthProvider({
        authUrl: config.authUrl,
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
   * Get current access token.
   * Returns undefined if not authenticated.
   */
  async getToken(): Promise<string | undefined> {
    return this.provider.getToken();
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
  login(appName: string): Promise<void> | void {
    return this.provider.login(appName);
  }

  /**
   * Logout - clear all tokens and state.
   */
  logout(): void {
    this.provider.logout();
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

  /**
   * Get cached storage data.
   */
  getStorage(): Record<string, unknown> | null {
    return this.provider.getStorage();
  }

  /**
   * Set cached storage data.
   */
  setStorage(data: Record<string, unknown>): void {
    this.provider.setStorage(data);
  }
}
