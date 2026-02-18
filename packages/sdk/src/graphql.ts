// =============================================================================
// GraphQL Client
// Handles all GraphQL queries and mutations for the Rool API
// =============================================================================

import { gzipSync } from 'fflate';
import type {
  PromptOptions,
  FindObjectsOptions,
  RoolSpaceInfo,
  RoolSpaceData,
  SpaceMember,
  CurrentUser,
  UserResult,
  RoolObject,
  ConversationInfo,
  LinkAccess,
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
        }
      }
    `;
    const response = await this.request<{ listSpaces: RoolSpaceInfo[] }>(query);
    return response.listSpaces;
  }

  async getSpace(spaceId: string): Promise<{ data: RoolSpaceData; name: string; role: string; userId: string; linkAccess: LinkAccess }> {
    const query = `
      query GetSpace($id: String!) {
        getSpace(id: $id) {
          data
          name
          role
          userId
          linkAccess
        }
      }
    `;
    const response = await this.request<{ getSpace: { data: string; name: string; role: string; userId: string; linkAccess: LinkAccess } }>(query, { id: spaceId });
    return {
      data: JSON.parse(response.getSpace.data),
      name: response.getSpace.name,
      role: response.getSpace.role,
      userId: response.getSpace.userId,
      linkAccess: response.getSpace.linkAccess,
    };
  }

  // ===========================================================================
  // Space Lifecycle Operations (called from RoolClient)
  // ===========================================================================

  async createSpace(name: string): Promise<{ spaceId: string; data: RoolSpaceData; name: string; role: string; userId: string }> {
    const mutation = `
      mutation CreateSpace($name: String!) {
        createSpace(name: $name) {
          spaceId
          data
          name
          role
          userId
        }
      }
    `;
    const response = await this.request<{ createSpace: { spaceId: string; data: string; name: string; role: string; userId: string } }>(mutation, {
      name,
    });
    return {
      spaceId: response.createSpace.spaceId,
      data: JSON.parse(response.createSpace.data),
      name: response.createSpace.name,
      role: response.createSpace.role,
      userId: response.createSpace.userId,
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
  // Space Content Operations (called from RoolSpace)
  // These require conversationId for AI context
  // ===========================================================================

  async setSpaceMeta(spaceId: string, meta: Record<string, unknown>, conversationId: string): Promise<void> {
    const mutation = `
      mutation SetSpaceMeta($id: String!, $meta: String!, $conversationId: String!) {
        setSpaceMeta(id: $id, meta: $meta, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      id: spaceId,
      meta: JSON.stringify(meta),
      conversationId,
    });
  }

  async link(spaceId: string, source: string, relation: string, target: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation Link($spaceId: String!, $source: String!, $relation: String!, $target: String!, $conversationId: String!) {
        link(spaceId: $spaceId, source: $source, relation: $relation, target: $target, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      source,
      relation,
      target,
      conversationId,
    });
  }

  async unlink(spaceId: string, source: string, relation: string | undefined, target: string | undefined, conversationId: string): Promise<void> {
    const mutation = `
      mutation Unlink($spaceId: String!, $source: String!, $relation: String, $target: String, $conversationId: String!) {
        unlink(spaceId: $spaceId, source: $source, relation: $relation, target: $target, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      source,
      relation: relation ?? null,
      target: target ?? null,
      conversationId,
    });
  }

  async deleteObjects(spaceId: string, ids: string[], conversationId: string): Promise<void> {
    const mutation = `
      mutation DeleteObjects($spaceId: String!, $ids: [String!]!, $conversationId: String!) {
        deleteObjects(spaceId: $spaceId, ids: $ids, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      ids,
      conversationId,
    });
  }

  async deleteConversation(spaceId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation DeleteConversation($spaceId: String!, $conversationId: String!) {
        deleteConversation(spaceId: $spaceId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      conversationId,
    });
  }

  async renameConversation(spaceId: string, conversationId: string, name: string): Promise<void> {
    const mutation = `
      mutation UpdateConversation($spaceId: String!, $conversationId: String!, $name: String!) {
        updateConversation(spaceId: $spaceId, conversationId: $conversationId, name: $name)
      }
    `;
    await this.request(mutation, {
      spaceId,
      conversationId,
      name,
    });
  }

  async setSystemInstruction(spaceId: string, conversationId: string, instruction: string | null): Promise<void> {
    const mutation = `
      mutation UpdateConversation($spaceId: String!, $conversationId: String!, $systemInstruction: String) {
        updateConversation(spaceId: $spaceId, conversationId: $conversationId, systemInstruction: $systemInstruction)
      }
    `;
    await this.request(mutation, {
      spaceId,
      conversationId,
      systemInstruction: instruction,
    });
  }

  async listConversations(spaceId: string): Promise<ConversationInfo[]> {
    const query = `
      query ListConversations($spaceId: String!) {
        listConversations(spaceId: $spaceId) {
          id
          name
          createdAt
          createdBy
          createdByName
          interactionCount
        }
      }
    `;
    const result = await this.request<{ listConversations: ConversationInfo[] }>(query, {
      spaceId,
    });
    return result.listConversations;
  }

  // ===========================================================================
  // Checkpoint / Undo / Redo Operations
  // ===========================================================================

  async checkpoint(
    spaceId: string,
    label: string | undefined,
    conversationId: string,
  ): Promise<{ checkpointId: string }> {
    const mutation = `
      mutation Checkpoint($spaceId: String!, $label: String, $conversationId: String!) {
        checkpoint(spaceId: $spaceId, label: $label, conversationId: $conversationId) {
          checkpointId
        }
      }
    `;
    const result = await this.request<{ checkpoint: { checkpointId: string } }>(mutation, {
      spaceId,
      label,
      conversationId,
    });
    return result.checkpoint;
  }

  async undo(spaceId: string, conversationId: string): Promise<{ success: boolean }> {
    const mutation = `
      mutation Undo($spaceId: String!, $conversationId: String!) {
        undo(spaceId: $spaceId, conversationId: $conversationId) {
          success
        }
      }
    `;
    const result = await this.request<{ undo: { success: boolean } }>(mutation, {
      spaceId,
      conversationId,
    });
    return result.undo;
  }

  async redo(spaceId: string, conversationId: string): Promise<{ success: boolean }> {
    const mutation = `
      mutation Redo($spaceId: String!, $conversationId: String!) {
        redo(spaceId: $spaceId, conversationId: $conversationId) {
          success
        }
      }
    `;
    const result = await this.request<{ redo: { success: boolean } }>(mutation, {
      spaceId,
      conversationId,
    });
    return result.redo;
  }

  async checkpointStatus(
    spaceId: string,
    conversationId: string,
  ): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const query = `
      query CheckpointStatus($spaceId: String!, $conversationId: String!) {
        checkpointStatus(spaceId: $spaceId, conversationId: $conversationId) {
          canUndo
          canRedo
        }
      }
    `;
    const result = await this.request<{
      checkpointStatus: { canUndo: boolean; canRedo: boolean }
    }>(query, {
      spaceId,
      conversationId,
    });
    return result.checkpointStatus;
  }

  async clearCheckpointHistory(spaceId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation ClearCheckpointHistory($spaceId: String!, $conversationId: String!) {
        clearCheckpointHistory(spaceId: $spaceId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      conversationId,
    });
  }

  async createObject(
    spaceId: string,
    data: Record<string, unknown>,
    conversationId: string,
    prompt?: string,
    ephemeral?: boolean,
  ): Promise<string> {
    const mutation = `
      mutation CreateObject($spaceId: String!, $data: String!, $prompt: String, $conversationId: String!, $ephemeral: Boolean) {
        createObject(spaceId: $spaceId, data: $data, prompt: $prompt, conversationId: $conversationId, ephemeral: $ephemeral)
      }
    `;
    const result = await this.request<{ createObject: string }>(mutation, {
      spaceId,
      data: JSON.stringify(data),
      prompt,
      conversationId,
      ephemeral,
    });
    return result.createObject;
  }

  async updateObject(
    spaceId: string,
    id: string,
    conversationId: string,
    data?: Record<string, unknown>,
    prompt?: string,
    ephemeral?: boolean,
  ): Promise<string> {
    const mutation = `
      mutation UpdateObject($spaceId: String!, $id: String!, $data: String, $prompt: String, $conversationId: String!, $ephemeral: Boolean) {
        updateObject(spaceId: $spaceId, id: $id, data: $data, prompt: $prompt, conversationId: $conversationId, ephemeral: $ephemeral)
      }
    `;
    const result = await this.request<{ updateObject: string }>(mutation, {
      spaceId,
      id,
      data: data ? JSON.stringify(data) : undefined,
      prompt,
      conversationId,
      ephemeral,
    });
    return result.updateObject;
  }

  async findObjects(
    spaceId: string,
    options: FindObjectsOptions,
    conversationId: string,
  ): Promise<{ objects: RoolObject[]; message: string }> {
    const query = `
      query FindObjects($spaceId: String!, $where: String, $prompt: String, $limit: Int, $objectIds: [String!], $order: String, $conversationId: String!, $ephemeral: Boolean) {
        findObjects(spaceId: $spaceId, where: $where, prompt: $prompt, limit: $limit, objectIds: $objectIds, order: $order, conversationId: $conversationId, ephemeral: $ephemeral) {
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
      prompt: options.prompt,
      limit: options.limit,
      objectIds: options.objectIds ?? [],
      order: options.order,
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
    conversationId: string,
    options: PromptOptions = {}
  ): Promise<{ message: string; modifiedObjectIds: string[] }> {
    const mutation = `
      mutation Prompt($spaceId: String!, $prompt: String!, $objectIds: [String!], $responseSchema: JSON, $conversationId: String!, $effort: PromptEffort, $ephemeral: Boolean, $readOnly: Boolean) {
        prompt(spaceId: $spaceId, prompt: $prompt, objectIds: $objectIds, responseSchema: $responseSchema, conversationId: $conversationId, effort: $effort, ephemeral: $ephemeral, readOnly: $readOnly) {
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
      conversationId,
      effort: options.effort,
      ephemeral: options.ephemeral,
      readOnly: options.readOnly,
    });
    return response.prompt;
  }

  // ===========================================================================
  // User / Collaboration Operations
  // ===========================================================================

  async getAccount(): Promise<CurrentUser> {
    const query = `
      query GetAccount {
        getAccount {
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
    const response = await this.request<{ getAccount: CurrentUser }>(query);
    return response.getAccount;
  }

  async setSlug(slug: string): Promise<void> {
    const mutation = `
      mutation SetSlug($slug: String!) {
        setSlug(slug: $slug)
      }
    `;
    await this.request(mutation, { slug });
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

  async setLinkAccess(spaceId: string, linkAccess: LinkAccess): Promise<void> {
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
    const token = await this.config.authManager.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const body = JSON.stringify({ query, variables });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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
