// =============================================================================
// Shared Utilities
// Space caching, name→ID resolution, error formatting, MCP result helpers.
// =============================================================================

import type { RoolClient, RoolChannel, RoolSpaceInfo, CallToolResult } from './types.js';
import type { Environment } from './client.js';
import { getDefaultEnv } from './client.js';

const DEFAULT_CHANNEL_ID = 'mcp';

// =============================================================================
// Channel Cache
// Open channels are cached for the lifetime of the MCP server process.
// Cache keys include the environment to keep channels isolated per-env.
// =============================================================================

const openChannels = new Map<string, RoolChannel>();

/**
 * Resolve a channel by space name — finds or creates the space, then opens
 * a channel on it (or returns cached). Environment-aware: channels from
 * different environments are cached separately.
 */
export async function resolveSpace(
  client: RoolClient,
  spaceName: string,
  conversationId?: string,
  env?: Environment,
): Promise<RoolChannel> {
  const channelId = conversationId ?? DEFAULT_CHANNEL_ID;
  const envKey = env ?? getDefaultEnv();
  const cacheKey = `${envKey}::${spaceName}::${channelId}`;

  const cached = openChannels.get(cacheKey);
  if (cached) return cached;

  const spaces = await client.listSpaces();
  const info = spaces.find((s: RoolSpaceInfo) => s.name === spaceName);

  let channel: RoolChannel;
  if (info) {
    channel = await client.openChannel(info.id, channelId);
  } else {
    const space = await client.createSpace(spaceName);
    channel = await space.openChannel(channelId);
  }

  openChannels.set(cacheKey, channel);
  return channel;
}

/**
 * Close all cached channels. Called on server shutdown.
 */
export function closeAllSpaces(): void {
  for (const channel of openChannels.values()) {
    channel.close();
  }
  openChannels.clear();
}

/**
 * Remove a space from the cache (e.g. after deletion).
 * Matches all environments and channel IDs for the given space name.
 */
export function evictSpaceByName(spaceName: string): void {
  for (const [key, channel] of openChannels.entries()) {
    // Key format: env::spaceName::channelId
    const parts = key.split('::');
    if (parts[1] === spaceName) {
      channel.close();
      openChannels.delete(key);
    }
  }
}

// =============================================================================
// MCP Result Helpers
// =============================================================================

/**
 * Create a successful MCP tool result with text content.
 */
export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * Create a successful MCP tool result with JSON content.
 */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create an MCP error result.
 */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Wrap an async tool handler with standard error handling.
 */
export function withErrorHandling(
  fn: (...args: any[]) => Promise<CallToolResult>,
): (...args: any[]) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  };
}
