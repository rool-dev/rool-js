import { gzipSync } from 'fflate';
import type {
  PromptOptions,
  RoolSpaceInfo,
  SpaceMember,
  CurrentUser,
  RoolObjectStat,
  Conversation,
  SpaceSchema,
  InviteRole,
  SpaceInvite,
  SpaceInviteCreated,
} from './types.js';
import type { AuthManager } from './auth.js';
import { fetchWithReroute } from './reroute.js';
import { addClientInfoHeaders, resolveClientInfo, type RoolClientInfo } from './client-info.js';

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
  clientInfo?: RoolClientInfo;
  onRefused?: () => Promise<string>;
}

/** Result from the openSpace full query — space data + all conversations. */
export interface OpenSpaceFullResult {
  name: string;
  role: string;
  userId: string;
  memberCount: number;
  objectStats: Record<string, RoolObjectStat>;
  schema: SpaceSchema;
  meta: Record<string, unknown>;
  conversations: Record<string, Conversation>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export class GraphQLClient {
  private config: GraphQLClientConfig & { clientInfo: RoolClientInfo };
  private _graphqlUrl: string;

  constructor(config: GraphQLClientConfig) {
    this.config = { ...config, clientInfo: config.clientInfo ?? resolveClientInfo() };
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
          inboundEmailAddress
          role
          ownerId
          size
          createdAt
          updatedAt
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

  /** Full space data — object stats, schema, metadata, all conversations. */
  async openSpaceFull(spaceId: string): Promise<OpenSpaceFullResult> {
    const query = `
      query OpenSpaceFull($id: String!) {
        openSpace(id: $id) {
          name
          role
          userId
          memberCount
          objectStatEntries {
            path
            modifiedAt
            modifiedBy
            modifiedByName
            modifiedInConversation
            modifiedInInteraction
          }
          schema
          meta
          conversations
        }
      }
    `;
    const response = await this.request<{
      openSpace: {
        name: string; role: string; userId: string; memberCount: number;
        objectStatEntries: RoolObjectStat[] | null;
        schema: SpaceSchema | null;
        meta: Record<string, unknown> | null;
        conversations: Record<string, Conversation> | null;
      }
    }>(query, { id: spaceId });

    const r = response.openSpace;
    const objectStats: Record<string, RoolObjectStat> = {};
    for (const stat of r.objectStatEntries ?? []) {
      objectStats[stat.path] = stat;
    }
    return {
      name: r.name,
      role: r.role,
      userId: r.userId,
      memberCount: r.memberCount,
      objectStats,
      schema: r.schema ?? {},
      meta: r.meta ?? {},
      conversations: r.conversations ?? {},
    };
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

  async setSpaceMeta(spaceId: string, meta: Record<string, unknown>, conversationId: string): Promise<void> {
    const mutation = `
      mutation SetSpaceMeta($id: String!, $meta: JSON!, $conversationId: String!) {
        setSpaceMeta(id: $id, meta: $meta, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, {
      id: spaceId,
      meta,
      conversationId,
    });
  }


  async updateConversation(
    spaceId: string,
    conversationId: string,
    options: { name?: string; systemInstruction?: string | null },
  ): Promise<void> {
    const mutation = `
      mutation UpdateConversation($spaceId: String!, $conversationId: String!, $name: String, $systemInstruction: String) {
        updateConversation(spaceId: $spaceId, conversationId: $conversationId, name: $name, systemInstruction: $systemInstruction)
      }
    `;
    await this.request(mutation, {
      spaceId,
      conversationId,
      name: options.name,
      systemInstruction: options.systemInstruction,
    });
  }

  async deleteConversation(spaceId: string, conversationId: string): Promise<void> {
    const mutation = `
      mutation DeleteConversation($spaceId: String!, $conversationId: String!) {
        deleteConversation(spaceId: $spaceId, conversationId: $conversationId)
      }
    `;
    await this.request(mutation, { spaceId, conversationId });
  }

  async checkpoint(
    spaceId: string,
    label: string | undefined,
  ): Promise<{ checkpointId: string }> {
    const mutation = `
      mutation Checkpoint($spaceId: String!, $label: String) {
        checkpoint(spaceId: $spaceId, label: $label) {
          checkpointId
        }
      }
    `;
    const result = await this.request<{ checkpoint: { checkpointId: string } }>(mutation, {
      spaceId,
      label,
    });
    return result.checkpoint;
  }

  async undo(spaceId: string): Promise<{ success: boolean }> {
    const mutation = `
      mutation Undo($spaceId: String!) {
        undo(spaceId: $spaceId) {
          success
        }
      }
    `;
    const result = await this.request<{ undo: { success: boolean } }>(mutation, { spaceId });
    return result.undo;
  }

  async redo(spaceId: string): Promise<{ success: boolean }> {
    const mutation = `
      mutation Redo($spaceId: String!) {
        redo(spaceId: $spaceId) {
          success
        }
      }
    `;
    const result = await this.request<{ redo: { success: boolean } }>(mutation, { spaceId });
    return result.redo;
  }

  async checkpointStatus(spaceId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const query = `
      query CheckpointStatus($spaceId: String!) {
        checkpointStatus(spaceId: $spaceId) {
          canUndo
          canRedo
        }
      }
    `;
    const result = await this.request<{
      checkpointStatus: { canUndo: boolean; canRedo: boolean }
    }>(query, { spaceId });
    return result.checkpointStatus;
  }

  async clearCheckpointHistory(spaceId: string): Promise<void> {
    const mutation = `
      mutation ClearCheckpointHistory($spaceId: String!) {
        clearCheckpointHistory(spaceId: $spaceId)
      }
    `;
    await this.request(mutation, { spaceId });
  }

  async prompt(
    spaceId: string,
    prompt: string,
    conversationId: string,
    options: Omit<PromptOptions, 'attachments'> & { attachmentRefs?: string[]; interactionId: string }
  ): Promise<{ message: string; modifiedObjectPaths: string[] }> {
    const mutation = `
      mutation Prompt($spaceId: String!, $prompt: String!, $responseSchema: JSON, $conversationId: String!, $effort: PromptEffort!, $ephemeral: Boolean!, $readOnly: Boolean!, $attachments: [String!]!, $interactionId: String!, $parentInteractionId: String, $eventName: String!) {
        prompt(spaceId: $spaceId, prompt: $prompt, responseSchema: $responseSchema, conversationId: $conversationId, effort: $effort, ephemeral: $ephemeral, readOnly: $readOnly, attachments: $attachments, interactionId: $interactionId, parentInteractionId: $parentInteractionId, eventName: $eventName) {
          message
          modifiedObjectPaths
        }
      }
    `;
    const response = await this.request<{
      prompt: { message: string; modifiedObjectPaths: string[] }
    }>(mutation, {
      spaceId,
      prompt,
      responseSchema: options.responseSchema,
      conversationId,
      effort: options.effort ?? 'STANDARD',
      ephemeral: options.ephemeral ?? false,
      readOnly: options.readOnly ?? false,
      attachments: options.attachmentRefs ?? [],
      interactionId: options.interactionId,
      parentInteractionId: options.parentInteractionId,
      eventName: options.eventName ?? 'prompt_user',
    });
    return {
      message: response.prompt.message,
      modifiedObjectPaths: response.prompt.modifiedObjectPaths,
    };
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
          stripeStatus
          marketingOptIn
        }
      }
    `;
    const response = await this.request<{ getCurrentUser: CurrentUser }>(query);
    return response.getCurrentUser;
  }

  async updateCurrentUser(input: { name?: string; slug?: string; marketingOptIn?: boolean }): Promise<CurrentUser> {
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
          stripeStatus
          marketingOptIn
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

  async setSpaceUserRole(spaceId: string, userId: string, role: string): Promise<void> {
    const mutation = `
      mutation SetSpaceUserRole($spaceId: String!, $userId: String!, $role: String!) {
        setSpaceUserRole(spaceId: $spaceId, userId: $userId, role: $role)
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

  async createSpaceInvite(
    spaceId: string,
    role: InviteRole,
    options?: { email?: string; expiresInDays?: number; maxUses?: number }
  ): Promise<SpaceInviteCreated> {
    const mutation = `
      mutation CreateSpaceInvite($spaceId: String!, $role: String!, $email: String, $expiresInDays: Int, $maxUses: Int) {
        createSpaceInvite(spaceId: $spaceId, role: $role, email: $email, expiresInDays: $expiresInDays, maxUses: $maxUses) {
          inviteId
          spaceId
          role
          email
          expiresAt
          maxUses
          url
          emailStatus
        }
      }
    `;
    const response = await this.request<{ createSpaceInvite: SpaceInviteCreated }>(mutation, {
      spaceId,
      role,
      email: options?.email ?? null,
      expiresInDays: options?.expiresInDays ?? null,
      maxUses: options?.maxUses ?? null,
    });
    return response.createSpaceInvite;
  }

  async listSpaceInvites(spaceId: string): Promise<SpaceInvite[]> {
    const query = `
      query ListSpaceInvites($spaceId: String!) {
        listSpaceInvites(spaceId: $spaceId) {
          inviteId
          spaceId
          role
          email
          createdBy
          createdAt
          expiresAt
          maxUses
          useCount
        }
      }
    `;
    const response = await this.request<{ listSpaceInvites: SpaceInvite[] }>(query, { spaceId });
    return response.listSpaceInvites;
  }

  async revokeSpaceInvite(spaceId: string, inviteId: string): Promise<boolean> {
    const mutation = `
      mutation RevokeSpaceInvite($spaceId: String!, $inviteId: String!) {
        revokeSpaceInvite(spaceId: $spaceId, inviteId: $inviteId)
      }
    `;
    const response = await this.request<{ revokeSpaceInvite: boolean }>(mutation, { spaceId, inviteId });
    return response.revokeSpaceInvite;
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
    const headers = new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      'X-Rool-Token': tokens.roolToken,
    });
    addClientInfoHeaders(headers, this.config.clientInfo);

    const timezone = getTimezone();
    if (timezone) headers.set('X-Timezone', timezone);

    let fetchBody: BodyInit = body;

    // Compress large payloads
    if (body.length > COMPRESSION_THRESHOLD) {
      const gzipped = gzipSync(new TextEncoder().encode(body));
      headers.set('Content-Encoding', 'gzip');
      // Convert to ArrayBuffer for fetch compatibility
      fetchBody = gzipped.buffer.slice(
        gzipped.byteOffset,
        gzipped.byteOffset + gzipped.byteLength
      ) as ArrayBuffer;
    }

    // 421 (wrong shard) and 503 (draining) both reject before executing, so
    // re-resolve the owner and retry — safe even for mutations; backoff rides out
    // a roll. No throw-retry here: GraphQL is always POST, and a thrown fetch on a
    // mutation might have executed, so re-sending isn't safe.
    let url = this._graphqlUrl;
    const onRefused = this.config.onRefused;
    const response = await fetchWithReroute({
      send: () => fetch(url, { method: 'POST', headers, body: fetchBody }),
      reroute: onRefused ? async () => { url = await onRefused(); } : undefined,
      retryOnThrow: false,
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
