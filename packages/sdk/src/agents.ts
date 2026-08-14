import type { MachineFilePath } from "./files.js";
import { throwProblemResponse } from "./problem.js";

export type MachinePromptEffort =
  "quick" | "standard" | "reasoning" | "research";
export type MachineAssistantFinish =
  | "stop"
  | "tool_calls"
  | "length"
  | "safety"
  | "error"
  | "credits"
  | "cancelled";
export type MachineConversationTurnRole =
  "system" | "user" | "tool" | "assistant";
export type MachineConversationVisibility = "private" | "shared";

export type MachineConversationContentPart =
  | { type: "text"; text: string }
  | { type: "attachment"; path: MachineFilePath; mime?: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      id: string;
      content: MachineConversationContentPart[];
      error?: boolean;
    }
  | { type: "json"; value: unknown };

export interface MachineConversationTurnBody {
  role: MachineConversationTurnRole;
  content: MachineConversationContentPart[];
  request?: Record<string, unknown>;
  finish?: MachineAssistantFinish;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  aside?: boolean;
}

export interface MachineConversationTurn {
  id: string;
  userId?: string;
  createdAt: string;
  body: MachineConversationTurnBody;
}

export interface MachineAgentDefinition {
  system: string;
}

export type MachineAgentCreateInput = MachineAgentDefinition;

export interface MachineConversationMetadataInput {
  name?: string;
  visibility: MachineConversationVisibility;
}

export interface MachineConversationMetadata extends MachineConversationMetadataInput {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isRunning: boolean;
}

export interface MachineConversationState extends MachineConversationMetadata {
  turns: MachineConversationTurn[];
}

export interface MachineConversationSummary extends MachineConversationMetadata {
  id: string;
}

export type MachineRunEvent =
  | { type: "keepalive" }
  | { type: "output.delta"; content: MachineConversationContentPart }
  | { type: "completed"; finish?: MachineAssistantFinish }
  | { type: "cancelled" }
  | { type: "error"; code: string; detail: string };

export interface AgentRequestOptions {
  signal?: AbortSignal;
}

export interface MachineConversationCreateOptions extends AgentRequestOptions {
  id?: string;
  name?: string;
  visibility?: MachineConversationVisibility;
}

export interface MachineConversationPromptOptions extends AgentRequestOptions {
  effort?: MachinePromptEffort;
  readOnly?: boolean;
  attachments?: readonly MachineFilePath[];
  responseSchema?: Record<string, unknown>;
  replaceTurnId?: string;
}

export interface MachineConversationFollowOptions extends AgentRequestOptions {
  onEvent?: (event: MachineRunEvent) => void;
}

export type MachineConversationCancelOptions = AgentRequestOptions;

export interface MachineConversation {
  readonly id: string;
  readonly agent: MachineAgent;
  get(
    options?: AgentRequestOptions,
  ): Promise<MachineConversationState | undefined>;
  listTurns(options?: AgentRequestOptions): Promise<MachineConversationTurn[]>;
  replace(
    metadata: MachineConversationMetadataInput,
    options?: AgentRequestOptions,
  ): Promise<MachineConversationMetadata>;
  prompt(
    text: string,
    options?: MachineConversationPromptOptions,
  ): Promise<void>;
  follow(options?: MachineConversationFollowOptions): Promise<boolean>;
  cancel(options?: MachineConversationCancelOptions): Promise<boolean>;
  rename(name: string | null, options?: AgentRequestOptions): Promise<void>;
  delete(options?: AgentRequestOptions): Promise<void>;
}

export interface MachineAgent {
  readonly id: string;
  readonly definition: MachineAgentDefinition;
  conversation(id: string): MachineConversation;
  createConversation(
    options?: MachineConversationCreateOptions,
  ): Promise<MachineConversation>;
  listConversations(
    options?: AgentRequestOptions,
  ): Promise<MachineConversationSummary[]>;
  replace(
    definition: MachineAgentDefinition,
    options?: AgentRequestOptions,
  ): Promise<MachineAgent>;
  delete(options?: AgentRequestOptions): Promise<void>;
}

export interface MachineAgents {
  list(options?: AgentRequestOptions): Promise<MachineAgent[]>;
  get(
    id: string,
    options?: AgentRequestOptions,
  ): Promise<MachineAgent | undefined>;
  create(
    id: string,
    definition: MachineAgentDefinition,
    options?: AgentRequestOptions,
  ): Promise<MachineAgent>;
}

interface AgentTransport {
  request(
    path: string,
    init?: RequestInit,
    allowHttpErrors?: boolean,
  ): Promise<Response>;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}

type WireTurn = Omit<MachineConversationTurnBody, "role"> & {
  id: string;
  userId?: string;
  createdAt: string;
  role: MachineConversationTurnRole;
};

type ConversationCollection = {
  conversations: Record<string, MachineConversationMetadata>;
};

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_EVENT_BYTES = 1024 * 1024;

class MachineAgentState implements MachineAgents {
  private readonly agents = new Map<string, AgentClient>();

  constructor(
    private readonly machinePath: string,
    private readonly transport: AgentTransport,
  ) {}

  async list(options: AgentRequestOptions = {}): Promise<MachineAgent[]> {
    const { agents } = await this.transport.requestJson<{ agents: string[] }>(
      `${this.machinePath}/agents`,
      { signal: options.signal },
    );
    return Promise.all(
      agents.map(async (id) => {
        const agent = await this.get(id, options);
        if (!agent) throw new Error(`Listed agent ${id} is unavailable`);
        return agent;
      }),
    );
  }

  async get(
    id: string,
    options: AgentRequestOptions = {},
  ): Promise<MachineAgent | undefined> {
    validateId(id, "agentId");
    const response = await this.transport.request(
      this.agentPath(id),
      { signal: options.signal },
      true,
    );
    if (response.status === 404) return undefined;
    if (!response.ok) await throwProblemResponse(response);
    return this.agent(id, (await response.json()) as MachineAgentDefinition);
  }

  async create(
    id: string,
    definition: MachineAgentDefinition,
    options: AgentRequestOptions = {},
  ): Promise<MachineAgent> {
    validateId(id, "agentId");
    validateDefinition(definition);
    const written = await this.transport.requestJson<MachineAgentDefinition>(
      this.agentPath(id),
      jsonRequest("PUT", definition, options.signal),
    );
    return this.agent(id, written);
  }

  conversation(agent: AgentClient, id: string): MachineConversation {
    validateId(id, "conversationId");
    return agent.cachedConversation(
      id,
      () => new ConversationClient(agent, id, this),
    );
  }

  async createConversation(
    agent: AgentClient,
    options: MachineConversationCreateOptions = {},
  ): Promise<MachineConversation> {
    const id = options.id ?? randomId();
    const conversation = this.conversation(agent, id);
    await conversation.replace(
      {
        ...(options.name ? { name: options.name } : {}),
        visibility: options.visibility ?? "private",
      },
      options,
    );
    return conversation;
  }

  async listConversations(
    agent: AgentClient,
    options: AgentRequestOptions = {},
  ): Promise<MachineConversationSummary[]> {
    const collection = await this.transport.requestJson<ConversationCollection>(
      `${this.agentPath(agent.id)}/conversations`,
      { signal: options.signal },
    );
    return Object.entries(collection.conversations).map(([id, metadata]) => ({
      id,
      ...metadata,
    }));
  }

  async replaceAgent(
    agent: AgentClient,
    definition: MachineAgentDefinition,
    options: AgentRequestOptions = {},
  ): Promise<MachineAgent> {
    validateDefinition(definition);
    const written = await this.transport.requestJson<MachineAgentDefinition>(
      this.agentPath(agent.id),
      jsonRequest("PUT", definition, options.signal),
    );
    agent.updateDefinition(written);
    return agent;
  }

  async deleteAgent(
    agent: AgentClient,
    options: AgentRequestOptions = {},
  ): Promise<void> {
    await this.transport.request(this.agentPath(agent.id), {
      method: "DELETE",
      signal: options.signal,
    });
    this.agents.delete(agent.id);
  }

  async getConversation(
    agentId: string,
    conversationId: string,
    options: AgentRequestOptions,
  ): Promise<MachineConversationState | undefined> {
    const response = await this.transport.request(
      this.conversationPath(agentId, conversationId),
      { signal: options.signal },
      true,
    );
    if (response.status === 404) return undefined;
    if (!response.ok) await throwProblemResponse(response);
    const metadata = (await response.json()) as MachineConversationMetadata;
    const turns = await this.listTurns(agentId, conversationId, options);
    return { ...metadata, turns };
  }

  async listTurns(
    agentId: string,
    conversationId: string,
    options: AgentRequestOptions = {},
  ): Promise<MachineConversationTurn[]> {
    const { turns } = await this.transport.requestJson<{ turns: WireTurn[] }>(
      `${this.conversationPath(agentId, conversationId)}/turns`,
      { signal: options.signal },
    );
    return turns.map(turnFromWire);
  }

  replaceConversation(
    agentId: string,
    conversationId: string,
    metadata: MachineConversationMetadataInput,
    options: AgentRequestOptions = {},
  ): Promise<MachineConversationMetadata> {
    validateMetadata(metadata);
    return this.transport.requestJson(
      this.conversationPath(agentId, conversationId),
      jsonRequest("PUT", metadata, options.signal),
    );
  }

  async deleteConversation(
    agent: AgentClient,
    conversationId: string,
    options: AgentRequestOptions = {},
  ): Promise<void> {
    await this.transport.request(
      this.conversationPath(agent.id, conversationId),
      { method: "DELETE", signal: options.signal },
    );
    agent.forgetConversation(conversationId);
  }

  async prompt(
    agentId: string,
    conversationId: string,
    text: string,
    options: MachineConversationPromptOptions,
  ): Promise<void> {
    if (!text) throw new Error("Prompt text is required");
    const attachments = options.attachments ?? [];
    for (const path of attachments) validateAttachment(path);

    const input = {
      content: [
        { type: "text", text },
        ...attachments.map((path) => ({ type: "attachment" as const, path })),
      ],
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
      ...(options.responseSchema !== undefined
        ? { responseSchema: options.responseSchema }
        : {}),
      ...(options.replaceTurnId
        ? { replaceTurnId: options.replaceTurnId }
        : {}),
    };
    const runPath = `${this.conversationPath(agentId, conversationId)}/run`;
    await this.transport.request(
      runPath,
      jsonRequest("POST", input, options.signal),
    );
  }

  async follow(
    agentId: string,
    conversationId: string,
    options: MachineConversationFollowOptions = {},
  ): Promise<boolean> {
    const runPath = `${this.conversationPath(agentId, conversationId)}/run`;
    const response = await this.transport.request(
      runPath,
      {
        headers: { Accept: "application/x-ndjson" },
        signal: options.signal,
      },
      true,
    );
    if (response.status === 404) return false;
    if (!response.ok) await throwProblemResponse(response);
    if (!response.body) throw new Error("Current run response has no body");

    await this.consumeRunEvents(response.body, options);
    return true;
  }

  async cancel(
    agentId: string,
    conversationId: string,
    options: AgentRequestOptions = {},
  ): Promise<boolean> {
    const response = await this.transport.request(
      `${this.conversationPath(agentId, conversationId)}/run`,
      { method: "DELETE", signal: options.signal },
      true,
    );
    if (response.status === 404) return false;
    if (!response.ok) await throwProblemResponse(response);
    return true;
  }

  private async consumeRunEvents(
    body: ReadableStream<Uint8Array>,
    options: MachineConversationFollowOptions,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffered = "";
    try {
      while (true) {
        const result = await reader.read();
        buffered += decoder.decode(result.value, { stream: !result.done });
        if (new TextEncoder().encode(buffered).byteLength > MAX_EVENT_BYTES) {
          throw new Error("Current run event is too large");
        }
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const event = line ? parseRunEvent(line) : undefined;
          if (event) options.onEvent?.(event);
        }
        if (result.done) break;
      }
      if (buffered.trim()) {
        const event = parseRunEvent(buffered);
        if (event) options.onEvent?.(event);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private agent(id: string, definition: MachineAgentDefinition): AgentClient {
    let agent = this.agents.get(id);
    if (!agent) {
      agent = new AgentClient(id, definition, this);
      this.agents.set(id, agent);
    } else {
      agent.updateDefinition(definition);
    }
    return agent;
  }

  private agentPath(agentId: string): string {
    return `${this.machinePath}/agents/${encodeURIComponent(agentId)}`;
  }

  private conversationPath(agentId: string, conversationId: string): string {
    return `${this.agentPath(agentId)}/conversations/${encodeURIComponent(conversationId)}`;
  }
}

class AgentClient implements MachineAgent {
  private currentDefinition: MachineAgentDefinition;
  private readonly conversations = new Map<string, ConversationClient>();

  constructor(
    readonly id: string,
    definition: MachineAgentDefinition,
    private readonly state: MachineAgentState,
  ) {
    this.currentDefinition = definition;
  }

  get definition(): MachineAgentDefinition {
    return { ...this.currentDefinition };
  }

  conversation(id: string): MachineConversation {
    return this.state.conversation(this, id);
  }

  createConversation(
    options?: MachineConversationCreateOptions,
  ): Promise<MachineConversation> {
    return this.state.createConversation(this, options);
  }

  listConversations(
    options?: AgentRequestOptions,
  ): Promise<MachineConversationSummary[]> {
    return this.state.listConversations(this, options);
  }

  replace(
    definition: MachineAgentDefinition,
    options?: AgentRequestOptions,
  ): Promise<MachineAgent> {
    return this.state.replaceAgent(this, definition, options);
  }

  delete(options?: AgentRequestOptions): Promise<void> {
    return this.state.deleteAgent(this, options);
  }

  updateDefinition(definition: MachineAgentDefinition): void {
    this.currentDefinition = definition;
  }

  cachedConversation(
    id: string,
    create: () => ConversationClient,
  ): ConversationClient {
    let conversation = this.conversations.get(id);
    if (!conversation) {
      conversation = create();
      this.conversations.set(id, conversation);
    }
    return conversation;
  }

  forgetConversation(id: string): void {
    this.conversations.delete(id);
  }
}

class ConversationClient implements MachineConversation {
  constructor(
    readonly agent: AgentClient,
    readonly id: string,
    private readonly state: MachineAgentState,
  ) {}

  get(
    options: AgentRequestOptions = {},
  ): Promise<MachineConversationState | undefined> {
    return this.state.getConversation(this.agent.id, this.id, options);
  }

  listTurns(
    options: AgentRequestOptions = {},
  ): Promise<MachineConversationTurn[]> {
    return this.state.listTurns(this.agent.id, this.id, options);
  }

  replace(
    metadata: MachineConversationMetadataInput,
    options?: AgentRequestOptions,
  ): Promise<MachineConversationMetadata> {
    return this.state.replaceConversation(
      this.agent.id,
      this.id,
      metadata,
      options,
    );
  }

  prompt(
    text: string,
    options: MachineConversationPromptOptions = {},
  ): Promise<void> {
    return this.state.prompt(this.agent.id, this.id, text, options);
  }

  follow(options?: MachineConversationFollowOptions): Promise<boolean> {
    return this.state.follow(this.agent.id, this.id, options);
  }

  cancel(options?: MachineConversationCancelOptions): Promise<boolean> {
    return this.state.cancel(this.agent.id, this.id, options);
  }

  async rename(
    name: string | null,
    options: AgentRequestOptions = {},
  ): Promise<void> {
    const current = await this.get(options);
    if (!current) throw new Error(`Conversation ${this.id} is unavailable`);
    await this.replace(
      {
        ...(name ? { name } : {}),
        visibility: current.visibility,
      },
      options,
    );
  }

  delete(options?: AgentRequestOptions): Promise<void> {
    return this.state.deleteConversation(this.agent, this.id, options);
  }
}

export function createMachineAgents(
  machinePath: string,
  transport: AgentTransport,
): MachineAgents {
  return new MachineAgentState(machinePath, transport);
}

function turnFromWire(turn: WireTurn): MachineConversationTurn {
  return {
    id: turn.id,
    ...(turn.userId ? { userId: turn.userId } : {}),
    createdAt: turn.createdAt,
    body: {
      role: turn.role,
      content: turn.content,
      ...(turn.request ? { request: turn.request } : {}),
      ...(turn.finish ? { finish: turn.finish } : {}),
      ...(turn.error ? { error: turn.error } : {}),
      ...(turn.usage ? { usage: turn.usage } : {}),
      ...(turn.aside !== undefined ? { aside: turn.aside } : {}),
    },
  };
}

function parseRunEvent(line: string): MachineRunEvent | undefined {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Current run event must be a JSON object");
  }
  const event = value as Record<string, unknown>;
  if (event.type === "keepalive") return { type: "keepalive" };
  if (
    event.type === "output.delta" &&
    event.content &&
    typeof event.content === "object" &&
    !Array.isArray(event.content)
  ) {
    return event as MachineRunEvent;
  }
  if (event.type === "completed") return event as MachineRunEvent;
  if (event.type === "cancelled") return { type: "cancelled" };
  if (
    event.type === "error" &&
    typeof event.code === "string" &&
    typeof event.detail === "string"
  ) {
    return event as MachineRunEvent;
  }
  return undefined;
}

function validateDefinition(definition: MachineAgentDefinition): void {
  if (!definition || typeof definition.system !== "string") {
    throw new Error("Agent system prompt must be a string");
  }
}

function validateMetadata(metadata: MachineConversationMetadataInput): void {
  if (metadata.visibility !== "private" && metadata.visibility !== "shared") {
    throw new Error("Conversation visibility must be private or shared");
  }
  if (metadata.name !== undefined && typeof metadata.name !== "string") {
    throw new Error("Conversation name must be a string");
  }
}

function validateAttachment(path: MachineFilePath): void {
  const supported =
    path.startsWith("/space/") || path.startsWith("/rool-drive/");
  if (!supported) {
    throw new Error(
      `Prompt attachments must be under /space or /rool-drive: ${path}`,
    );
  }
}

function validateId(value: string, label: string): void {
  if (VALID_ID.test(value)) return;
  throw new Error(
    `${label} must start with an alphanumeric character and contain at most 128 letters, digits, dots, hyphens, or underscores`,
  );
}

function jsonRequest(
  method: "POST" | "PUT",
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}
