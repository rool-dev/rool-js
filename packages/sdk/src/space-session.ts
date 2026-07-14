import type { RoolSpace } from './space.js';
import type { Conversation, Interaction, PromptOptions, RoolObject } from './types.js';

const ENTITY_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateEntityId(): string {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += ENTITY_CHARS[Math.floor(Math.random() * ENTITY_CHARS.length)];
  }
  return result;
}

/** Find the most recently updated leaf in a conversation tree. */
export function defaultConversationLeaf(conversation: Conversation | null): string | undefined {
  if (!conversation) return undefined;

  const parents = new Set<string>();
  for (const interaction of Object.values(conversation.interactions)) {
    if (interaction.parentId) parents.add(interaction.parentId);
  }

  let leaf: Interaction | undefined;
  for (const interaction of Object.values(conversation.interactions)) {
    if (parents.has(interaction.id)) continue;
    if (!leaf || interaction.timestamp > leaf.timestamp) leaf = interaction;
  }
  return leaf?.id;
}

/** Return one conversation branch in root-to-leaf order. */
export function conversationBranch(
  conversation: Conversation | null,
  leafId = defaultConversationLeaf(conversation),
): Interaction[] {
  if (!conversation || !leafId) return [];

  const branch: Interaction[] = [];
  let currentId: string | null = leafId;
  while (currentId) {
    const interaction: Interaction | undefined = conversation.interactions[currentId];
    if (!interaction) break;
    branch.push(interaction);
    currentId = interaction.parentId;
  }
  return branch.reverse();
}

/** An imperative API scoped to one conversation. It retains no conversation state. */
export class ConversationHandle {
  constructor(
    private space: RoolSpace,
    readonly conversationId: string,
  ) {}

  /** Fetch the current conversation contents. */
  async get(): Promise<Conversation | null> {
    return this.space.getConversation(this.conversationId);
  }

  /** Set the conversation system instruction. Pass null to clear it. */
  async setSystemInstruction(instruction: string | null): Promise<void> {
    await this.space._updateConversation(this.conversationId, { systemInstruction: instruction });
  }

  async rename(name: string): Promise<void> {
    await this.space._updateConversation(this.conversationId, { name });
  }

  async delete(): Promise<void> {
    await this.space.deleteConversation(this.conversationId);
  }

  /**
   * Prompt this conversation. With no explicit parent, continue from the
   * current default leaf without retaining a client-side cursor.
   */
  async prompt(
    text: string,
    options?: PromptOptions,
  ): Promise<{ message: string; objects: RoolObject[]; creditsUsed: number }> {
    const interactionId = options?.interactionId ?? generateEntityId();
    const parentInteractionId = options?.parentInteractionId === undefined
      ? defaultConversationLeaf(await this.get()) ?? null
      : options.parentInteractionId;

    return this.space._prompt(text, this.conversationId, {
      ...options,
      interactionId,
      parentInteractionId,
    });
  }

  async stop(): Promise<boolean> {
    return this.space.stopConversation(this.conversationId);
  }
}
