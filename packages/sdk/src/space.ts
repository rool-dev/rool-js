// =============================================================================
// RoolSpace — Lightweight handle for space-level admin operations
// =============================================================================

import type { GraphQLClient } from './graphql.js';
import type { MediaClient } from './media.js';
import type { RoolChannel } from './channel.js';
import type {
  RoolUserRole,
  LinkAccess,
  SpaceMember,
  ConversationInfo,
} from './types.js';

export interface SpaceConfig {
  id: string;
  name: string;
  role: RoolUserRole;
  linkAccess: LinkAccess;
  /** Initial channel summaries (for getChannels without a round-trip) */
  channels: ConversationInfo[];
  graphqlClient: GraphQLClient;
  mediaClient: MediaClient;
  /** Callback to open a channel via the client */
  openChannelFn: (spaceId: string, conversationId: string) => Promise<RoolChannel>;
}

/**
 * A space is a container for objects, schema, metadata, and channels.
 *
 * RoolSpace is a lightweight handle for space-level admin operations:
 * user management, link access, channel management, and export.
 * It does not have a real-time subscription — use channels for live data.
 *
 * To work with objects and AI, open a channel on the space.
 */
export class RoolSpace {
  private _id: string;
  private _name: string;
  private _role: RoolUserRole;
  private _linkAccess: LinkAccess;
  private _channels: ConversationInfo[];
  private graphqlClient: GraphQLClient;
  private mediaClient: MediaClient;
  private _openChannelFn: (spaceId: string, conversationId: string) => Promise<RoolChannel>;

  constructor(config: SpaceConfig) {
    this._id = config.id;
    this._name = config.name;
    this._role = config.role;
    this._linkAccess = config.linkAccess;
    this._channels = config.channels;
    this.graphqlClient = config.graphqlClient;
    this.mediaClient = config.mediaClient;
    this._openChannelFn = config.openChannelFn;
  }

  // ===========================================================================
  // Properties
  // ===========================================================================

  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get role(): RoolUserRole { return this._role; }
  get linkAccess(): LinkAccess { return this._linkAccess; }

  // ===========================================================================
  // Channel Lifecycle
  // ===========================================================================

  /**
   * Open a channel on this space with a specific conversation.
   * If the conversation doesn't exist, the server creates it.
   */
  async openChannel(conversationId: string): Promise<RoolChannel> {
    return this._openChannelFn(this._id, conversationId);
  }

  // ===========================================================================
  // Space Admin
  // ===========================================================================

  /**
   * Rename this space.
   */
  async rename(newName: string): Promise<void> {
    await this.graphqlClient.renameSpace(this._id, newName);
    this._name = newName;
  }

  /**
   * Delete this space permanently. Cannot be undone.
   */
  async delete(): Promise<void> {
    await this.graphqlClient.deleteSpace(this._id);
  }

  // ===========================================================================
  // User Management
  // ===========================================================================

  /**
   * List users with access to this space.
   */
  async listUsers(): Promise<SpaceMember[]> {
    return this.graphqlClient.listSpaceUsers(this._id);
  }

  /**
   * Add a user to this space with specified role.
   */
  async addUser(userId: string, role: RoolUserRole): Promise<void> {
    return this.graphqlClient.addSpaceUser(this._id, userId, role);
  }

  /**
   * Remove a user from this space.
   */
  async removeUser(userId: string): Promise<void> {
    return this.graphqlClient.removeSpaceUser(this._id, userId);
  }

  /**
   * Set the link sharing level for this space.
   * Requires owner or admin role.
   */
  async setLinkAccess(linkAccess: LinkAccess): Promise<void> {
    const previous = this._linkAccess;
    this._linkAccess = linkAccess;
    try {
      await this.graphqlClient.setLinkAccess(this._id, linkAccess);
    } catch (error) {
      this._linkAccess = previous;
      throw error;
    }
  }

  // ===========================================================================
  // Channel Management
  // ===========================================================================

  /**
   * List channels in this space.
   * Returns from cached snapshot (populated at open time).
   * Call refresh() to update from server.
   */
  getChannels(): ConversationInfo[] {
    return this._channels;
  }

  /**
   * Delete a channel (conversation) from this space.
   */
  async deleteChannel(channelId: string): Promise<void> {
    await this.graphqlClient.deleteConversation(this._id, channelId);
    this._channels = this._channels.filter(c => c.id !== channelId);
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  /**
   * Export space data and media as a zip archive.
   */
  async exportArchive(): Promise<Blob> {
    return this.mediaClient.exportArchive(this._id);
  }

  // ===========================================================================
  // Refresh
  // ===========================================================================

  /**
   * Refresh space data from the server.
   * Updates name, role, linkAccess, and channel list.
   */
  async refresh(): Promise<void> {
    const { name, role, linkAccess, channels } = await this.graphqlClient.openSpace(this._id);
    this._name = name;
    this._role = role as RoolUserRole;
    this._linkAccess = linkAccess;
    this._channels = channels;
  }
}
