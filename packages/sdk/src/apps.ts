// =============================================================================
// Extensions Client
// REST API wrapper for user extension management (upload/delete/list/get)
// =============================================================================

import type { PublishedExtensionInfo, PublishExtensionOptions } from './types.js';
import type { AuthManager } from './auth.js';

export interface ExtensionsClientConfig {
  extensionsUrl: string;
  authManager: AuthManager;
}

export class ExtensionsClient {
  private config: ExtensionsClientConfig;

  constructor(config: ExtensionsClientConfig) {
    this.config = config;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');
    return { Authorization: `Bearer ${tokens.accessToken}`, 'X-Rool-Token': tokens.roolToken };
  }

  /**
   * List all user extensions.
   */
  async list(): Promise<PublishedExtensionInfo[]> {
    const response = await fetch(this.config.extensionsUrl, {
      method: 'GET',
      headers: await this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list extensions: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get info for a specific user extension.
   */
  async get(extensionId: string): Promise<PublishedExtensionInfo | null> {
    const response = await fetch(`${this.config.extensionsUrl}/${encodeURIComponent(extensionId)}`, {
      method: 'GET',
      headers: await this.getHeaders(),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      throw new Error(`Failed to get extension: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Upload or update a user extension bundle.
   * @param extensionId - URL-safe identifier for the extension
   * @param options - Bundle zip file (must include index.html and manifest.json)
   */
  async upload(extensionId: string, options: PublishExtensionOptions): Promise<PublishedExtensionInfo> {
    const formData = new FormData();
    formData.append('bundle', options.bundle);

    const response = await fetch(`${this.config.extensionsUrl}/${encodeURIComponent(extensionId)}`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody.error || `${response.status} ${response.statusText}`;
      throw new Error(`Failed to upload extension: ${errorMessage}`);
    }

    return response.json();
  }

  /**
   * Delete a user extension permanently.
   */
  async delete(extensionId: string): Promise<void> {
    const response = await fetch(`${this.config.extensionsUrl}/${encodeURIComponent(extensionId)}`, {
      method: 'DELETE',
      headers: await this.getHeaders(),
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to delete extension: ${response.status} ${response.statusText}`);
    }
  }
}
