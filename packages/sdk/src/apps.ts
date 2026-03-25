// =============================================================================
// Extensions Client
// REST API wrapper for extension publishing/unpublishing/listing
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

  /**
   * List all published extensions for the current user.
   */
  async list(): Promise<PublishedExtensionInfo[]> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Rool-Token': tokens.roolToken };

    const response = await fetch(this.config.extensionsUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to list extensions: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get info for a specific published extension.
   */
  async get(extensionId: string): Promise<PublishedExtensionInfo | null> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Rool-Token': tokens.roolToken };

    const response = await fetch(`${this.config.extensionsUrl}/${encodeURIComponent(extensionId)}`, {
      method: 'GET',
      headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get extension: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Publish or update an extension.
   * @param extensionId - URL-safe identifier for the extension
   * @param options - Bundle zip file (must include index.html and manifest.json)
   */
  async publish(extensionId: string, options: PublishExtensionOptions): Promise<PublishedExtensionInfo> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Rool-Token': tokens.roolToken };

    const formData = new FormData();
    formData.append('bundle', options.bundle);

    const response = await fetch(`${this.config.extensionsUrl}/${encodeURIComponent(extensionId)}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage = errorBody.error || `${response.status} ${response.statusText}`;
      throw new Error(`Failed to publish extension: ${errorMessage}`);
    }

    return response.json();
  }

  /**
   * Unpublish an extension.
   */
  async unpublish(extensionId: string): Promise<void> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) throw new Error('Not authenticated');

    const headers: Record<string, string> = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Rool-Token': tokens.roolToken };

    const response = await fetch(`${this.config.extensionsUrl}/${encodeURIComponent(extensionId)}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to unpublish extension: ${response.status} ${response.statusText}`);
    }
  }
}
