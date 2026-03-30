// =============================================================================
// GraphQL Client
// Handles all GraphQL queries and mutations for the Rool API
// =============================================================================

import { gzipSync } from 'fflate';
import type {
  PromptOptions,
  FindObjectsOptions,
  RoolSpaceInfo,
  SpaceMember,
  CurrentUser,
  UserResult,
  RoolObject,
  RoolObjectStat,
  LinkAccess,
  CollectionDef,
  FieldDef,
  ChannelInfo,
  Channel,
  SpaceSchema,
  PublishedExtensionInfo,
  FindExtensionsOptions,
} from './types.js';
import type { AuthManager } from './auth.js';

const COMPRESSION_THRESHOLD = 2048; // Compress payloads > 2KB

/** Get the client's IANA timezone (e.g., "America/New_York") */
function getTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export interface GraphQLClientConfig {
  graphqlUrl: string;
  authManager: AuthManager;
}

/** Result from the openChannel GraphQL query */
export interface OpenChannelResult {
  name: string;
  role: string;
  userId: string;
  linkAccess: LinkAccess;
  objectIds: string[];
  objectStats: Record<string, RoolObjectStat>;
  schema: SpaceSchema;
  meta: Record<string, unknown>;
  channel: Channel | undefined;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export class GraphQLClient {
  private config: GraphQLClientConfig;

  constructor(config: GraphQLClientConfig) {
    this.config = config;
  }

  private get graphqlUrl(): string {
    return this.config.graphqlUrl;
  }

  async listSpaces(): Promise<RoolSpaceInfo[]> {
    const query = `
      query ListSpaces {
        listSpaces {
          id
          name
          role
          ownerId
          size
          createdAt
          updatedAt
          linkAccess
          memberCount
        }
      }
    `;
    const response = await this.request<{ listSpaces: RoolSpaceInfo[] }>(query);
    return response.listSpaces;
  }

  async openSpace(spaceId: string): Promise<{ name: string; role: string; linkAccess: LinkAccess; memberCount: number; channels: ChannelInfo[] }> {
    const query = `
      query OpenSpace($id: String!) {
        openSpace(id: $id) {
          name
          role
          linkAccess
          memberCount
          channels {
            id
            name
            createdAt
            createdBy
            createdByName
            interactionCount
            extensionUrl
          }
        }
      }
    `;
    const response = await this.request<{ openSpace: { name: string; role: string; linkAccess: LinkAccess; memberCount: number; channels: ChannelInfo[] } }>(query, { id: spaceId });
    return response.openSpace;
  }

  // ===========================================================================
  // Space Lifecycle Operations (called from RoolClient)
  // ===========================================================================

  async createSpace(name: string): Promise<{ spaceId: string }> {
    const mutation = `
      mutation CreateSpace($name: String!) {
        createSpace(name: $name) {
          spaceId
        }
      }
    `;
    const response = await this.request<{ createSpace: { spaceId: string } }>(mutation, {
      name,
    });
    return { spaceId: response.createSpace.spaceId };
  }

  /** Response from openChannel — top-level fields, channel data, object stats */
  async openChannel(spaceId: string, channelId: string): Promise<OpenChannelResult> {
    const query = `
      query OpenChannel($spaceId: String!, $channelId: String!) {
        openChannel(spaceId: $spaceId, channelId: $channelId) {
          name
          role
          userId
          linkAccess
          objectIds
          objectStats
          schema
          meta
          channel
        }
      }
    `;
    const response = await this.request<{ openChannel: {
      name: string; role: string; userId: string; linkAccess: LinkAccess;
      objectIds: string[];
      objectStats: Record<string, RoolObjectStat> | null;
      schema: SpaceSchema | null;
      meta: Record<string, unknown> | null;
      channel: Channel | null;
    } }>(query, { spaceId, channelId });

    const r = response.openChannel;
    return {
      name: r.name,
      role: r.role,
      userId: r.userId,
      linkAccess: r.linkAccess,
      objectIds: r.objectIds,
      objectStats: r.objectStats ?? {},
      schema: r.schema ?? {},
      meta: r.meta ?? {},
      channel: r.channel ?? undefined,
    };
  }

  async deleteSpace(spaceId: string): Promise<void> {
    const mutation = `
      mutation DeleteSpace($id: String!) {
        deleteSpace(id: $id)
      }
    `;
    await this.request(mutation, {
      id: spaceId,
    });
  }

  async renameSpace(spaceId: string, name: string): Promise<void> {
    const mutation = `
      mutation RenameSpace($id: String!, $name: String!) {
        renameSpace(id: $id, name: $name)
      }
    `;
    await this.request(mutation, {
      id: spaceId,
      name,
    });
  }

  // ===========================================================================
  // Space Content Operations (called from RoolChannel)
  // These require channelId for AI context
  // ===========================================================================

  async setSpaceMeta(spaceId: string, meta: Record<string, unknown>, channelId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation SetSpaceMeta($id: String!, $meta: String!, $channelId: String!, $conversationId: String!) {
        setSpaceMeta(id: $id, meta: $meta, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      id: spaceId,
      meta: JSON.stringify(meta),
      channelId,
      conversationId,
    });
  }

  async deleteObjects(spaceId: string, ids: string[], channelId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation DeleteObjects($spaceId: String!, $ids: [String!]!, $channelId: String!, $conversationId: String!) {
        deleteObjects(spaceId: $spaceId, ids: $ids, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      ids,
      channelId,
      conversationId,
    });
  }

  async deleteChannel(spaceId: string, channelId: string): Promise<void> {
    const mutation = `
      mutation DeleteChannel($spaceId: String!, $channelId: String!) {
        deleteChannel(spaceId: $spaceId, channelId: $channelId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      channelId,
    });
  }

  async renameChannel(spaceId: string, channelId: string, name: string): Promise<void> {
    const mutation = `
      mutation UpdateChannel($spaceId: String!, $channelId: String!, $name: String!) {
        updateChannel(spaceId: $spaceId, channelId: $channelId, name: $name)
      }
    `;
    await this.request(mutation, {
      spaceId,
      channelId,
      name,
    });
  }

  async updateConversation(
    spaceId: string,
    channelId: string,
    conversationId: string,
    options: { name?: string; systemInstruction?: string | null },
  ): Promise<void> {
    const mutation = `
      mutation UpdateConversation($spaceId: String!, $channelId: String!, $conversationId: String!, $name: String, $systemInstruction: String) {
        updateConversation(spaceId: $spaceId, channelId: $channelId, conversationId: $conversationId, name: $name, systemInstruction: $systemInstruction)
      }
    `;
    await this.request(mutation, {
      spaceId,
      channelId,
      conversationId,
      name: options.name,
      systemInstruction: options.systemInstruction,
    });
  }

  async deleteConversation(spaceId: string, channelId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation DeleteConversation($spaceId: String!, $channelId: String!, $conversationId: String!) {
        deleteConversation(spaceId: $spaceId, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      channelId,
      conversationId,
    });
  }

  // ===========================================================================
  // Checkpoint / Undo / Redo Operations
  // ===========================================================================

  async checkpoint(
    spaceId: string,
    label: string | undefined,
    channelId: string,
  ): Promise<{ checkpointId: string }> {
    const mutation = `
      mutation Checkpoint($spaceId: String!, $label: String, $channelId: String!) {
        checkpoint(spaceId: $spaceId, label: $label, channelId: $channelId) {
          checkpointId
        }
      }
    `;
    const result = await this.request<{ checkpoint: { checkpointId: string } }>(mutation, {
      spaceId,
      label,
      channelId,
    });
    return result.checkpoint;
  }

  async undo(spaceId: string, channelId: string): Promise<{ success: boolean }> {
    const mutation = `
      mutation Undo($spaceId: String!, $channelId: String!) {
        undo(spaceId: $spaceId, channelId: $channelId) {
          success
        }
      }
    `;
    const result = await this.request<{ undo: { success: boolean } }>(mutation, {
      spaceId,
      channelId,
    });
    return result.undo;
  }

  async redo(spaceId: string, channelId: string): Promise<{ success: boolean }> {
    const mutation = `
      mutation Redo($spaceId: String!, $channelId: String!) {
        redo(spaceId: $spaceId, channelId: $channelId) {
          success
        }
      }
    `;
    const result = await this.request<{ redo: { success: boolean } }>(mutation, {
      spaceId,
      channelId,
    });
    return result.redo;
  }

  async checkpointStatus(
    spaceId: string,
    channelId: string,
  ): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const query = `
      query CheckpointStatus($spaceId: String!, $channelId: String!) {
        checkpointStatus(spaceId: $spaceId, channelId: $channelId) {
          canUndo
          canRedo
        }
      }
    `;
    const result = await this.request<{
      checkpointStatus: { canUndo: boolean; canRedo: boolean }
    }>(query, {
      spaceId,
      channelId,
    });
    return result.checkpointStatus;
  }

  async clearCheckpointHistory(spaceId: string, channelId: string): Promise<void> {
    const mutation = `
      mutation ClearCheckpointHistory($spaceId: String!, $channelId: String!) {
        clearCheckpointHistory(spaceId: $spaceId, channelId: $channelId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      channelId,
    });
  }

  // ===========================================================================
  // Collection Schema Operations
  // ===========================================================================

  async createCollection(
    spaceId: string,
    name: string,
    fields: FieldDef[],
    channelId: string,
    conversationId: string,
  ): Promise<CollectionDef> {
    const mutation = `
      mutation CreateCollection($spaceId: String!, $name: String!, $fields: String!, $channelId: String!, $conversationId: String!) {
        createCollection(spaceId: $spaceId, name: $name, fields: $fields, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    const result = await this.request<{ createCollection: string }>(mutation, {
      spaceId,
      name,
      fields: JSON.stringify(fields),
      channelId,
      conversationId,
    });
    const parsed = JSON.parse(result.createCollection);
    return parsed[name] as CollectionDef;
  }

  async alterCollection(
    spaceId: string,
    name: string,
    fields: FieldDef[],
    channelId: string,
    conversationId: string,
  ): Promise<CollectionDef> {
    const mutation = `
      mutation AlterCollection($spaceId: String!, $name: String!, $fields: String!, $channelId: String!, $conversationId: String!) {
        alterCollection(spaceId: $spaceId, name: $name, fields: $fields, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    const result = await this.request<{ alterCollection: string }>(mutation, {
      spaceId,
      name,
      fields: JSON.stringify(fields),
      channelId,
      conversationId,
    });
    const parsed = JSON.parse(result.alterCollection);
    return parsed[name] as CollectionDef;
  }

  async dropCollection(
    spaceId: string,
    name: string,
    channelId: string,
    conversationId: string,
  ): Promise<void> {
    const mutation = `
      mutation DropCollection($spaceId: String!, $name: String!, $channelId: String!, $conversationId: String!) {
        dropCollection(spaceId: $spaceId, name: $name, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      name,
      channelId,
      conversationId,
    });
  }

  // ===========================================================================
  // Object Operations
  // ===========================================================================

  async createObject(
    spaceId: string,
    data: Record<string, unknown>,
    channelId: string,
    conversationId: string,
    interactionId: string,
    ephemeral?: boolean,
  ): Promise<{ objectId: string; message: string }> {
    const mutation = `
      mutation CreateObject($spaceId: String!, $data: String!, $channelId: String!, $conversationId: String!, $ephemeral: Boolean, $interactionId: String!) {
        createObject(spaceId: $spaceId, data: $data, channelId: $channelId, conversationId: $conversationId, ephemeral: $ephemeral, interactionId: $interactionId) {
          objectId
          message
        }
      }
    `;
    const result = await this.request<{ createObject: { objectId: string; message: string } }>(mutation, {
      spaceId,
      data: JSON.stringify(data),
      channelId,
      conversationId,
      ephemeral,
      interactionId,
    });
    return result.createObject;
  }

  async updateObject(
    spaceId: string,
    id: string,
    channelId: string,
    conversationId: string,
    interactionId: string,
    data?: Record<string, unknown>,
    prompt?: string,
    ephemeral?: boolean,
  ): Promise<{ objectId: string; message: string }> {
    const mutation = `
      mutation UpdateObject($spaceId: String!, $id: String!, $data: String, $prompt: String, $channelId: String!, $conversationId: String!, $ephemeral: Boolean, $interactionId: String!) {
        updateObject(spaceId: $spaceId, id: $id, data: $data, prompt: $prompt, channelId: $channelId, conversationId: $conversationId, ephemeral: $ephemeral, interactionId: $interactionId) {
          objectId
          message
        }
      }
    `;
    const result = await this.request<{ updateObject: { objectId: string; message: string } }>(mutation, {
      spaceId,
      id,
      data: data ? JSON.stringify(data) : undefined,
      prompt,
      channelId,
      conversationId,
      ephemeral,
      interactionId,
    });
    return result.updateObject;
  }

  async getObject(
    spaceId: string,
    objectId: string,
  ): Promise<RoolObject | undefined> {
    const query = `
      query GetObject($spaceId: String!, $objectId: String!) {
        getObject(spaceId: $spaceId, objectId: $objectId)
      }
    `;
    const result = await this.request<{ getObject: RoolObject | null }>(query, {
      spaceId,
      objectId,
    });
    return result.getObject ?? undefined;
  }

  async findObjects(
    spaceId: string,
    options: FindObjectsOptions,
    channelId: string,
    conversationId: string,
  ): Promise<{ objects: RoolObject[]; message: string }> {
    const query = `
      query FindObjects($spaceId: String!, $where: String, $collection: String, $prompt: String, $limit: Int, $objectIds: [String!], $order: String, $channelId: String!, $conversationId: String!, $ephemeral: Boolean) {
        findObjects(spaceId: $spaceId, where: $where, collection: $collection, prompt: $prompt, limit: $limit, objectIds: $objectIds, order: $order, channelId: $channelId, conversationId: $conversationId, ephemeral: $ephemeral) {
          objects
          message
        }
      }
    `;
    const result = await this.request<{
      findObjects: { objects: string; message: string }
    }>(query, {
      spaceId,
      where: options.where ? JSON.stringify(options.where) : undefined,
      collection: options.collection,
      prompt: options.prompt,
      limit: options.limit,
      objectIds: options.objectIds ?? [],
      order: options.order,
      channelId,
      conversationId,
      ephemeral: options.ephemeral,
    });
    return {
      objects: JSON.parse(result.findObjects.objects),
      message: result.findObjects.message,
    };
  }

  // ===========================================================================
  // AI Operations
  // ===========================================================================

  async prompt(
    spaceId: string,
    prompt: string,
    channelId: string,
    conversationId: string,
    options: Omit<PromptOptions, 'attachments'> & { attachmentUrls?: string[]; interactionId: string }
  ): Promise<{ message: string; modifiedObjectIds: string[] }> {
    const mutation = `
      mutation Prompt($spaceId: String!, $prompt: String!, $objectIds: [String!], $responseSchema: JSON, $channelId: String!, $conversationId: String!, $effort: PromptEffort, $ephemeral: Boolean, $readOnly: Boolean, $attachments: [String!], $interactionId: String!, $parentInteractionId: String) {
        prompt(spaceId: $spaceId, prompt: $prompt, objectIds: $objectIds, responseSchema: $responseSchema, channelId: $channelId, conversationId: $conversationId, effort: $effort, ephemeral: $ephemeral, readOnly: $readOnly, attachments: $attachments, interactionId: $interactionId, parentInteractionId: $parentInteractionId) {
          message
          modifiedObjectIds
        }
      }
    `;
    const response = await this.request<{
      prompt: { message: string; modifiedObjectIds: string[] }
    }>(mutation, {
      spaceId,
      prompt,
      objectIds: options.objectIds ?? [],
      responseSchema: options.responseSchema,
      channelId,
      conversationId,
      effort: options.effort,
      ephemeral: options.ephemeral,
      readOnly: options.readOnly,
      attachments: options.attachmentUrls,
      interactionId: options.interactionId,
      parentInteractionId: options.parentInteractionId,
    });
    return response.prompt;
  }

  // ===========================================================================
  // User / Collaboration Operations
  // ===========================================================================

  async getCurrentUser(): Promise<CurrentUser> {
    const query = `
      query GetCurrentUser {
        getCurrentUser {
          id
          email
          name
          slug
          plan
          creditsBalance
          totalCreditsUsed
          createdAt
          lastActivity
          processedAt
          storage
        }
      }
    `;
    const response = await this.request<{ getCurrentUser: CurrentUser }>(query);
    return response.getCurrentUser;
  }

  async updateCurrentUser(input: { name?: string; slug?: string }): Promise<CurrentUser> {
    const mutation = `
      mutation UpdateCurrentUser($input: UpdateCurrentUserInput!) {
        updateCurrentUser(input: $input) {
          id
          email
          name
          slug
          plan
          creditsBalance
          totalCreditsUsed
          createdAt
          lastActivity
          processedAt
          storage
        }
      }
    `;
    const response = await this.request<{ updateCurrentUser: CurrentUser }>(mutation, { input });
    return response.updateCurrentUser;
  }

  async findExtensions(options?: FindExtensionsOptions): Promise<PublishedExtensionInfo[]> {
    const query = `
      query FindExtensions($query: String, $limit: Int) {
        findExtensions(query: $query, limit: $limit) {
          extensionId
          manifest
          url
          sizeBytes
          createdAt
          updatedAt
        }
      }
    `;
    const response = await this.request<{ findExtensions: PublishedExtensionInfo[] }>(query, {
      query: options?.query,
      limit: options?.limit,
    });
    return response.findExtensions;
  }

  async installExtension(spaceId: string, extensionId: string, channelId: string): Promise<string> {
    const mutation = `
      mutation InstallExtension($spaceId: String!, $extensionId: String!, $channelId: String!) {
        installExtension(spaceId: $spaceId, extensionId: $extensionId, channelId: $channelId)
      }
    `;
    const result = await this.request<{ installExtension: string }>(mutation, {
      spaceId,
      extensionId,
      channelId,
    });
    return result.installExtension;
  }

  async setUserStorage(key: string, value: unknown): Promise<void> {
    const mutation = `
      mutation SetUserStorage($key: String!, $value: JSON) {
        setUserStorage(key: $key, value: $value)
      }
    `;
    await this.request(mutation, { key, value: value ?? null });
  }

  async searchUser(email: string): Promise<UserResult | null> {
    const query = `
      query SearchUser($email: String!) {
        searchUser(email: $email) {
          id
          email
          name
        }
      }
    `;
    try {
      const response = await this.request<{ searchUser: UserResult | null }>(query, { email });
      return response.searchUser;
    } catch {
      return null;
    }
  }

  async listSpaceUsers(spaceId: string): Promise<SpaceMember[]> {
    const query = `
      query ListSpaceUsers($spaceId: String!) {
        listSpaceUsers(spaceId: $spaceId) {
          id
          email
          role
        }
      }
    `;
    const response = await this.request<{ listSpaceUsers: SpaceMember[] }>(query, { spaceId });
    return response.listSpaceUsers;
  }

  async addSpaceUser(spaceId: string, userId: string, role: string): Promise<void> {
    const mutation = `
      mutation AddSpaceUser($spaceId: String!, $userId: String!, $role: String!) {
        addSpaceUser(spaceId: $spaceId, userId: $userId, role: $role)
      }
    `;
    await this.request(mutation, { spaceId, userId, role });
  }

  async removeSpaceUser(spaceId: string, userId: string): Promise<void> {
    const mutation = `
      mutation RemoveSpaceUser($spaceId: String!, $userId: String!) {
        removeSpaceUser(spaceId: $spaceId, userId: $userId)
      }
    `;
    await this.request(mutation, { spaceId, userId });
  }

  async setLinkAccess(spaceId: string, linkAccess: string): Promise<void> {
    const mutation = `
      mutation SetLinkAccess($spaceId: String!, $linkAccess: String!) {
        setLinkAccess(spaceId: $spaceId, linkAccess: $linkAccess)
      }
    `;
    await this.request(mutation, { spaceId, linkAccess });
  }

  // ===========================================================================
  // Generic Query (escape hatch for app-specific queries)
  // ===========================================================================

  /**
   * Execute an arbitrary GraphQL query or mutation.
   * Use this for app-specific operations not covered by the typed methods.
   */
  async query<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return this.request<T>(query, variables);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async request<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const tokens = await this.config.authManager.getTokens();
    if (!tokens) {
      throw new Error('Not authenticated');
    }

    const body = JSON.stringify({ query, variables });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      'X-Rool-Token': tokens.roolToken,
    };

    const timezone = getTimezone();
    if (timezone) {
      headers['X-Timezone'] = timezone;
    }

    let fetchBody: BodyInit = body;

    // Compress large payloads
    if (body.length > COMPRESSION_THRESHOLD) {
      const gzipped = gzipSync(new TextEncoder().encode(body));
      headers['Content-Encoding'] = 'gzip';
      // Convert to ArrayBuffer for fetch compatibility
      fetchBody = gzipped.buffer.slice(
        gzipped.byteOffset,
        gzipped.byteOffset + gzipped.byteLength
      ) as ArrayBuffer;
    }

    const response = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers,
      body: fetchBody,
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const result: GraphQLResponse<T> = await response.json();

    if (result.errors && result.errors.length > 0) {
      const error = result.errors[0];
      const err = new Error(error.message);
      (err as Error & { extensions?: Record<string, unknown> }).extensions = error.extensions;
      throw err;
    }

    if (!result.data) {
      throw new Error('GraphQL response missing data');
    }

    return result.data;
  }
}
