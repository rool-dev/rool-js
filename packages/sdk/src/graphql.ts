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
  onRefused?: () => Promise<string>;
}

/** Result from the openSpace full query — space data + all channels. */
export interface OpenSpaceFullResult {
  name: string;
  role: string;
  userId: string;
  linkAccess: LinkAccess;
  memberCount: number;
  objectLocations: string[];
  objectStats: Record<string, RoolObjectStat>;
  schema: SpaceSchema;
  meta: Record<string, unknown>;
  channels: Record<string, Channel>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

const SPACE_OBJECT_FIELDS = `location collection basename body`;

export class GraphQLClient {
  private config: GraphQLClientConfig;
  private _graphqlUrl: string;

  constructor(config: GraphQLClientConfig) {
    this.config = config;
    this._graphqlUrl = config.graphqlUrl;
  }

  get graphqlUrl(): string {
    return this._graphqlUrl;
  }

  setGraphqlUrl(url: string): void {
    this._graphqlUrl = url;
  }

  setOnRefused(onRefused: () => Promise<string>): void {
    this.config.onRefused = onRefused;
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

  async duplicateSpace(sourceSpaceId: string, name: string): Promise<{ spaceId: string }> {
    const mutation = `
      mutation DuplicateSpace($sourceSpaceId: String!, $name: String!) {
        duplicateSpace(sourceSpaceId: $sourceSpaceId, name: $name) {
          spaceId
        }
      }
    `;
    const response = await this.request<{ duplicateSpace: { spaceId: string } }>(mutation, {
      sourceSpaceId,
      name,
    });
    return { spaceId: response.duplicateSpace.spaceId };
  }

  /** Full space data — object locations, schema, metadata, all channels. */
  async openSpaceFull(spaceId: string): Promise<OpenSpaceFullResult> {
    const query = `
      query OpenSpaceFull($id: String!) {
        openSpace(id: $id) {
          name
          role
          userId
          linkAccess
          memberCount
          objectLocations
          objectStatEntries {
            location
            modifiedAt
            modifiedBy
            modifiedByName
            modifiedInChannel
            modifiedInConversation
            modifiedInInteraction
          }
          schema
          meta
          channels
        }
      }
    `;
    const response = await this.request<{
      openSpace: {
        name: string; role: string; userId: string; linkAccess: LinkAccess; memberCount: number;
        objectLocations: string[];
        objectStatEntries: RoolObjectStat[] | null;
        schema: SpaceSchema | null;
        meta: Record<string, unknown> | null;
        channels: Record<string, Channel> | null;
      }
    }>(query, { id: spaceId });

    const r = response.openSpace;
    const objectStats: Record<string, RoolObjectStat> = {};
    for (const stat of r.objectStatEntries ?? []) {
      objectStats[stat.location] = stat;
    }
    return {
      name: r.name,
      role: r.role,
      userId: r.userId,
      linkAccess: r.linkAccess,
      memberCount: r.memberCount,
      objectLocations: r.objectLocations,
      objectStats,
      schema: r.schema ?? {},
      meta: r.meta ?? {},
      channels: r.channels ?? {},
    };
  }

  /** Create a channel. Throws if channel already exists. */
  async createChannel(spaceId: string, channelId: string, options?: { name?: string; extensionUrl?: string }): Promise<Channel> {
    const mutation = `
      mutation CreateChannel($spaceId: String!, $channelId: String!, $name: String, $extensionUrl: String) {
        createChannel(spaceId: $spaceId, channelId: $channelId, name: $name, extensionUrl: $extensionUrl)
      }
    `;
    const response = await this.request<{ createChannel: Channel }>(mutation, {
      spaceId,
      channelId,
      name: options?.name,
      extensionUrl: options?.extensionUrl,
    });
    return response.createChannel;
  }

  async deleteSpace(spaceId: string): Promise<void> {
    const mutation = `
      mutation DeleteSpace($id: String!) {
        deleteSpace(id: $id)
      }
    `;
    await this.request(mutation, { id: spaceId });
  }

  async renameSpace(spaceId: string, name: string): Promise<void> {
    const mutation = `
      mutation RenameSpace($id: String!, $name: String!) {
        renameSpace(id: $id, name: $name)
      }
    `;
    await this.request(mutation, { id: spaceId, name });
  }

  async setSpaceMeta(spaceId: string, meta: Record<string, unknown>, channelId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation SetSpaceMeta($id: String!, $meta: JSON!, $channelId: String!, $conversationId: String!) {
        setSpaceMeta(id: $id, meta: $meta, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      id: spaceId,
      meta,
      channelId,
      conversationId,
    });
  }

  async deleteObjects(
    spaceId: string,
    locations: string[],
    channelId: string,
    conversationId: string,
    interactionId?: string,
    parentInteractionId?: string | null,
  ): Promise<void> {
    const mutation = `
      mutation DeleteObjects($spaceId: String!, $locations: [String!]!, $channelId: String!, $conversationId: String!, $interactionId: String, $parentInteractionId: String) {
        deleteObjects(spaceId: $spaceId, locations: $locations, channelId: $channelId, conversationId: $conversationId, interactionId: $interactionId, parentInteractionId: $parentInteractionId)
      }
    `;
    await this.request(mutation, {
      spaceId,
      locations,
      channelId,
      conversationId,
      interactionId,
      parentInteractionId,
    });
  }

  async deleteChannel(spaceId: string, channelId: string): Promise<void> {
    const mutation = `
      mutation DeleteChannel($spaceId: String!, $channelId: String!) {
        deleteChannel(spaceId: $spaceId, channelId: $channelId)
      }
    `;
    await this.request(mutation, { spaceId, channelId });
  }

  async renameChannel(spaceId: string, channelId: string, name: string): Promise<void> {
    const mutation = `
      mutation UpdateChannel($spaceId: String!, $channelId: String!, $name: String!) {
        updateChannel(spaceId: $spaceId, channelId: $channelId, name: $name)
      }
    `;
    await this.request(mutation, { spaceId, channelId, name });
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
    await this.request(mutation, { spaceId, channelId, conversationId });
  }

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
    const result = await this.request<{ undo: { success: boolean } }>(mutation, { spaceId, channelId });
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
    const result = await this.request<{ redo: { success: boolean } }>(mutation, { spaceId, channelId });
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
    }>(query, { spaceId, channelId });
    return result.checkpointStatus;
  }

  async clearCheckpointHistory(spaceId: string, channelId: string): Promise<void> {
    const mutation = `
      mutation ClearCheckpointHistory($spaceId: String!, $channelId: String!) {
        clearCheckpointHistory(spaceId: $spaceId, channelId: $channelId)
      }
    `;
    await this.request(mutation, { spaceId, channelId });
  }

  async createCollection(
    spaceId: string,
    name: string,
    fields: FieldDef[],
    channelId: string,
    conversationId: string,
  ): Promise<CollectionDef> {
    const mutation = `
      mutation CreateCollection($spaceId: String!, $name: String!, $fields: JSON!, $channelId: String!, $conversationId: String!) {
        createCollection(spaceId: $spaceId, name: $name, fields: $fields, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    const result = await this.request<{ createCollection: CollectionDef }>(mutation, {
      spaceId,
      name,
      fields,
      channelId,
      conversationId,
    });
    return result.createCollection;
  }

  async alterCollection(
    spaceId: string,
    name: string,
    fields: FieldDef[],
    channelId: string,
    conversationId: string,
  ): Promise<CollectionDef> {
    const mutation = `
      mutation AlterCollection($spaceId: String!, $name: String!, $fields: JSON!, $channelId: String!, $conversationId: String!) {
        alterCollection(spaceId: $spaceId, name: $name, fields: $fields, channelId: $channelId, conversationId: $conversationId)
      }
    `;
    const result = await this.request<{ alterCollection: CollectionDef }>(mutation, {
      spaceId,
      name,
      fields,
      channelId,
      conversationId,
    });
    return result.alterCollection;
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
    await this.request(mutation, { spaceId, name, channelId, conversationId });
  }

  async createObject(
    spaceId: string,
    location: string,
    body: Record<string, unknown>,
    channelId: string,
    conversationId: string,
    interactionId: string,
    options?: { ephemeral?: boolean; parentInteractionId?: string | null },
  ): Promise<{ location: string; object: RoolObject | null; message: string }> {
    const mutation = `
      mutation CreateObject($spaceId: String!, $location: String!, $body: JSON!, $channelId: String!, $conversationId: String!, $interactionId: String!, $ephemeral: Boolean!, $parentInteractionId: String) {
        createObject(spaceId: $spaceId, location: $location, body: $body, channelId: $channelId, conversationId: $conversationId, interactionId: $interactionId, ephemeral: $ephemeral, parentInteractionId: $parentInteractionId) {
          location
          object { ${SPACE_OBJECT_FIELDS} }
          message
        }
      }
    `;
    const result = await this.request<{ createObject: { location: string; object: RoolObject | null; message: string } }>(mutation, {
      spaceId,
      location,
      body,
      channelId,
      conversationId,
      interactionId,
      ephemeral: options?.ephemeral ?? false,
      parentInteractionId: options?.parentInteractionId,
    });
    return result.createObject;
  }

  async updateObject(
    spaceId: string,
    location: string,
    channelId: string,
    conversationId: string,
    interactionId: string,
    options?: { patch?: Record<string, unknown>; prompt?: string; ephemeral?: boolean; parentInteractionId?: string | null },
  ): Promise<{ location: string; object: RoolObject | null; message: string }> {
    const mutation = `
      mutation UpdateObject($spaceId: String!, $location: String!, $patch: JSON, $prompt: String, $channelId: String!, $conversationId: String!, $interactionId: String!, $ephemeral: Boolean!, $parentInteractionId: String) {
        updateObject(spaceId: $spaceId, location: $location, patch: $patch, prompt: $prompt, channelId: $channelId, conversationId: $conversationId, interactionId: $interactionId, ephemeral: $ephemeral, parentInteractionId: $parentInteractionId) {
          location
          object { ${SPACE_OBJECT_FIELDS} }
          message
        }
      }
    `;
    const result = await this.request<{ updateObject: { location: string; object: RoolObject | null; message: string } }>(mutation, {
      spaceId,
      location,
      patch: options?.patch,
      prompt: options?.prompt,
      channelId,
      conversationId,
      interactionId,
      ephemeral: options?.ephemeral ?? false,
      parentInteractionId: options?.parentInteractionId,
    });
    return result.updateObject;
  }

  async moveObject(
    spaceId: string,
    from: string,
    to: string,
    channelId: string,
    conversationId: string,
    interactionId: string,
    options?: { body?: Record<string, unknown>; ephemeral?: boolean; parentInteractionId?: string | null },
  ): Promise<{ location: string; object: RoolObject | null; message: string }> {
    const mutation = `
      mutation MoveObject($spaceId: String!, $from: String!, $to: String!, $body: JSON, $channelId: String!, $conversationId: String!, $interactionId: String!, $ephemeral: Boolean!, $parentInteractionId: String) {
        moveObject(spaceId: $spaceId, from: $from, to: $to, body: $body, channelId: $channelId, conversationId: $conversationId, interactionId: $interactionId, ephemeral: $ephemeral, parentInteractionId: $parentInteractionId) {
          location
          object { ${SPACE_OBJECT_FIELDS} }
          message
        }
      }
    `;
    const result = await this.request<{ moveObject: { location: string; object: RoolObject | null; message: string } }>(mutation, {
      spaceId,
      from,
      to,
      body: options?.body,
      channelId,
      conversationId,
      interactionId,
      ephemeral: options?.ephemeral ?? false,
      parentInteractionId: options?.parentInteractionId,
    });
    return result.moveObject;
  }

  async getObject(spaceId: string, location: string): Promise<RoolObject | undefined> {
    const query = `
      query GetObject($spaceId: String!, $location: String!) {
        getObject(spaceId: $spaceId, location: $location) { ${SPACE_OBJECT_FIELDS} }
      }
    `;
    const result = await this.request<{ getObject: RoolObject | null }>(query, { spaceId, location });
    return result.getObject ?? undefined;
  }

  async findObjects(
    spaceId: string,
    options: FindObjectsOptions,
    channelId: string,
    conversationId: string,
  ): Promise<{ objects: RoolObject[]; message: string }> {
    const query = `
      query FindObjects($spaceId: String!, $where: JSON, $collection: String, $prompt: String, $limit: Int, $locations: [String!]!, $order: String, $channelId: String!, $conversationId: String!, $ephemeral: Boolean!) {
        findObjects(spaceId: $spaceId, where: $where, collection: $collection, prompt: $prompt, limit: $limit, locations: $locations, order: $order, channelId: $channelId, conversationId: $conversationId, ephemeral: $ephemeral) {
          objects { ${SPACE_OBJECT_FIELDS} }
          message
        }
      }
    `;
    const result = await this.request<{
      findObjects: { objects: RoolObject[]; message: string }
    }>(query, {
      spaceId,
      where: options.where,
      collection: options.collection,
      prompt: options.prompt,
      limit: options.limit,
      locations: options.locations ?? [],
      order: options.order,
      channelId,
      conversationId,
      ephemeral: options.ephemeral ?? false,
    });
    return result.findObjects;
  }

  async prompt(
    spaceId: string,
    prompt: string,
    channelId: string,
    conversationId: string,
    options: Omit<PromptOptions, 'attachments'> & { attachmentRefs?: string[]; interactionId: string }
  ): Promise<{ message: string; modifiedObjectLocations: string[] }> {
    const mutation = `
      mutation Prompt($spaceId: String!, $prompt: String!, $locations: [String!]!, $responseSchema: JSON, $channelId: String!, $conversationId: String!, $effort: PromptEffort!, $ephemeral: Boolean!, $readOnly: Boolean!, $attachments: [String!]!, $interactionId: String!, $parentInteractionId: String) {
        prompt(spaceId: $spaceId, prompt: $prompt, locations: $locations, responseSchema: $responseSchema, channelId: $channelId, conversationId: $conversationId, effort: $effort, ephemeral: $ephemeral, readOnly: $readOnly, attachments: $attachments, interactionId: $interactionId, parentInteractionId: $parentInteractionId) {
          message
          modifiedObjectLocations
        }
      }
    `;
    const response = await this.request<{
      prompt: { message: string; modifiedObjectLocations: string[] }
    }>(mutation, {
      spaceId,
      prompt,
      locations: options.locations ?? [],
      responseSchema: options.responseSchema,
      channelId,
      conversationId,
      effort: options.effort ?? 'STANDARD',
      ephemeral: options.ephemeral ?? false,
      readOnly: options.readOnly ?? false,
      attachments: options.attachmentRefs ?? [],
      interactionId: options.interactionId,
      parentInteractionId: options.parentInteractionId,
    });
    return response.prompt;
  }

  async stopInteraction(spaceId: string, interactionId: string): Promise<boolean> {
    const mutation = `
      mutation StopInteraction($spaceId: String!, $interactionId: String!) {
        stopInteraction(spaceId: $spaceId, interactionId: $interactionId)
      }
    `;
    const response = await this.request<{ stopInteraction: boolean }>(mutation, {
      spaceId,
      interactionId,
    });
    return response.stopInteraction;
  }

  async getCurrentUser(): Promise<CurrentUser> {
    const query = `
      query GetCurrentUser {
        getCurrentUser {
          id
          email
          name
          photoUrl
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
          photoUrl
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

  async deleteCurrentUser(): Promise<void> {
    const mutation = `
      mutation DeleteCurrentUser {
        deleteCurrentUser
      }
    `;
    await this.request(mutation);
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

  async publishExtensionToPublic(extensionId: string): Promise<void> {
    const mutation = `
      mutation PublishExtension($extensionId: String!) {
        publishExtension(extensionId: $extensionId)
      }
    `;
    await this.request(mutation, { extensionId });
  }

  async unpublishExtensionFromPublic(extensionId: string): Promise<void> {
    const mutation = `
      mutation UnpublishExtension($extensionId: String!) {
        unpublishExtension(extensionId: $extensionId)
      }
    `;
    await this.request(mutation, { extensionId });
  }

  async setUserStorage(key: string, value: unknown): Promise<void> {
    const mutation = `
      mutation SetUserStorage($key: String!, $value: JSON) {
        setUserStorage(key: $key, value: $value)
      }
    `;
    await this.request(mutation, { key, value: value ?? null });
  }

  async reportEvent(event: string, url?: string): Promise<void> {
    const mutation = `
      mutation ReportEvent($event: String!, $url: String) {
        reportEvent(event: $event, url: $url)
      }
    `;
    await this.request(mutation, { event, url: url ?? null });
  }

  async probeResponse(requestId: string, result?: unknown, error?: string): Promise<boolean> {
    const mutation = `
      mutation ProbeResponse($requestId: String!, $result: JSON, $error: String) {
        probeResponse(requestId: $requestId, result: $result, error: $error)
      }
    `;
    const response = await this.request<{ probeResponse: boolean }>(mutation, {
      requestId,
      result: result ?? null,
      error: error ?? null,
    });
    return response.probeResponse;
  }

  async searchUser(email: string): Promise<UserResult | null> {
    const query = `
      query SearchUser($email: String!) {
        searchUser(email: $email) {
          id
          email
          name
          photoUrl
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
          photoUrl
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

    let response = await fetch(this._graphqlUrl, { method: 'POST', headers, body: fetchBody });

    if (response.status === 421 && this.config.onRefused) {
      const newUrl = await this.config.onRefused();
      response = await fetch(newUrl, { method: 'POST', headers, body: fetchBody });
    }

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
