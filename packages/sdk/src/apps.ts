// =============================================================================
// Apps Client
// REST API wrapper for app publishing/unpublishing/listing
// =============================================================================

import type { PublishedAppInfo, PublishAppOptions } from './types.js';
import type { AuthManager } from './auth.js';

export interface AppsClientConfig {
  appsUrl: string;
  authManager: AuthManager;
}

export class AppsClient {
  private config: AppsClientConfig;

  constructor(config: AppsClientConfig) {
    this.config = config;
  }

  /**
   * List all published apps for the current user.
   */
  async list(): Promise<PublishedAppInfo[]> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const roolToken = this.config.authManager.getRoolToken();
    if (roolToken) headers['X-Rool-Token'] = roolToken;

    const response = await fetch(this.config.appsUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to list apps: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get info for a specific published app.
   */
  async get(appId: string): Promise<PublishedAppInfo | null> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const roolToken = this.config.authManager.getRoolToken();
    if (roolToken) headers['X-Rool-Token'] = roolToken;

    const response = await fetch(`${this.config.appsUrl}/${encodeURIComponent(appId)}`, {
      method: 'GET',
      headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get app: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Publish or update an app.
   * @param appId - URL-safe identifier for the app
   * @param options - App name, bundle (zip file), and optional SPA flag
   */
  async publish(appId: string, options: PublishAppOptions): Promise<PublishedAppInfo> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const roolToken = this.config.authManager.getRoolToken();
    if (roolToken) headers['X-Rool-Token'] = roolToken;

    const formData = new FormData();
    formData.append('bundle', options.bundle);
    formData.append('name', options.name);
    if (options.spa !== undefined) {
      formData.append('spa', String(options.spa));
    }

    const response = await fetch(`${this.config.appsUrl}/${encodeURIComponent(appId)}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody.error || `${response.status} ${response.statusText}`;
      throw new Error(`Failed to publish app: ${errorMessage}`);
    }

    return response.json();
  }

  /**
   * Unpublish an app.
   */
  async unpublish(appId: string): Promise<void> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const roolToken = this.config.authManager.getRoolToken();
    if (roolToken) headers['X-Rool-Token'] = roolToken;

    const response = await fetch(`${this.config.appsUrl}/${encodeURIComponent(appId)}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to unpublish app: ${response.status} ${response.statusText}`);
    }
  }
}
