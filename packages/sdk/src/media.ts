// =============================================================================
// Media Client
// REST API wrapper for file upload/download/list/delete
// =============================================================================

import type { MediaInfo, MediaResponse } from './types.js';
import type { AuthManager } from './auth.js';

export interface MediaClientConfig {
  mediaUrl: string;
  backendOrigin: string;
  authManager: AuthManager;
}

export class MediaClient {
  private config: MediaClientConfig;

  constructor(config: MediaClientConfig) {
    this.config = config;
  }

  private baseUrl(spaceId: string): string {
    return `${this.config.mediaUrl}/${encodeURIComponent(spaceId)}`;
  }

  /**
   * Extract UUID from a media URL.
   * URL format: {baseUrl}/{spaceId}/{uuid}
   */
  private extractUuid(url: string): string {
    const parts = new URL(url).pathname.split('/');
    const uuid = parts[parts.length - 1];
    if (!uuid) throw new Error('Invalid media URL: cannot extract UUID');
    return uuid;
  }

  /**
   * Check if a URL is a backend URL (requires auth).
   */
  private isBackendUrl(url: string): boolean {
    if (url.startsWith('/')) return true;
    try {
      const parsed = new URL(url);
      return parsed.origin === this.config.backendOrigin;
    } catch {
      return false;
    }
  }

  /**
   * List all media files for a space.
   */
  async list(spaceId: string): Promise<MediaInfo[]> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(this.baseUrl(spaceId), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to list media: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Upload a file to a space. Returns the URL.
   * Accepts File, Blob, or base64 data with content type.
   */
  async upload(
    spaceId: string,
    file: File | Blob | { data: string; contentType: string }
  ): Promise<string> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    let body: FormData | string;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (file instanceof File || file instanceof Blob) {
      const formData = new FormData();
      formData.append('file', file);
      body = formData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        data: file.data,
        contentType: file.contentType,
      });
    }

    const response = await fetch(this.baseUrl(spaceId), {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload media: ${response.status} ${response.statusText}`);
    }

    const item: MediaInfo = await response.json();
    return item.url;
  }

  /**
   * Fetch any URL, returning headers and a blob() method (like fetch Response).
   * For backend URLs: adds auth headers.
   * For external URLs: tries direct fetch first, falls back to server proxy if CORS blocks it.
   */
  async fetch(spaceId: string, url: string): Promise<MediaResponse> {
    let response: Response;

    if (this.isBackendUrl(url)) {
      response = await this.fetchWithAuth(url);
    } else {
      // External URL: try direct fetch first
      try {
        const directResponse = await fetch(url, { method: 'GET', mode: 'cors' });
        if (directResponse.ok) {
          response = directResponse;
        } else {
          // Non-OK response, fall through to proxy
          response = await this.fetchViaProxy(spaceId, url);
        }
      } catch {
        // CORS or network error, fall through to proxy
        response = await this.fetchViaProxy(spaceId, url);
      }
    }

    const contentLength = response.headers.get('content-length');
    return {
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      size: contentLength ? parseInt(contentLength, 10) : null,
      blob: () => response.blob(),
    };
  }

  /**
   * Fetch a backend URL with auth headers.
   */
  private async fetchWithAuth(url: string): Promise<Response> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Fetch an external URL via the server proxy (bypasses CORS).
   */
  private async fetchViaProxy(spaceId: string, url: string): Promise<Response> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const proxyUrl = `${this.baseUrl(spaceId)}/proxy?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media via proxy: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Delete a media file by URL.
   */
  async delete(spaceId: string, url: string): Promise<void> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const uuid = this.extractUuid(url);
    const response = await fetch(`${this.baseUrl(spaceId)}/${encodeURIComponent(uuid)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to delete media: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Export a space as a zip archive containing data and media.
   * The archive includes data.json with objects, relations, metadata, and conversations,
   * plus a media/ folder with all media files.
   */
  async exportArchive(spaceId: string): Promise<Blob> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const exportUrl = `${this.config.backendOrigin}/spaces/${encodeURIComponent(spaceId)}/export`;
    const response = await fetch(exportUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to export space: ${response.status} ${errorText}`);
    }

    return response.blob();
  }

  /**
   * Import a space from a zip archive.
   * Creates a new space with the given name and imports objects, relations, and media.
   * Returns the new space ID.
   */
  async importArchive(name: string, archive: Blob): Promise<string> {
    const token = await this.config.authManager.getToken();
    if (!token) throw new Error('Not authenticated');

    const formData = new FormData();
    formData.append('name', name);
    formData.append('archive', archive, 'archive.zip');

    const importUrl = `${this.config.backendOrigin}/spaces/import`;
    const response = await fetch(importUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to import space: ${response.status} ${errorText}`);
    }

    const result = await response.json() as { spaceId: string; name: string };
    return result.spaceId;
  }
}

