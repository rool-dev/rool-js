import type { RoolClientEvent } from "./events.js";
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

export interface MachineConversationTurn {
  id: string;
  userId?: string;
  createdAt: string;
  role: MachineConversationTurnRole;
  content: MachineConversationContentPart[];
  request?: Record<string, unknown>;
  finish?: MachineAssistantFinish;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  aside?: boolean;
}

export interface MachineAgentDefinition {
  /** Instructions added after Rool's built-in machine context. */
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

export interface MachineConversationView {
  readonly turns: readonly MachineConversationTurn[];
  readonly output: readonly MachineConversationContentPart[];
  readonly isRunning: boolean;
  readonly loading: boolean;
  readonly error: unknown;
}

export type MachineConversationListener = (
  view: MachineConversationView,
) => void;

export interface MachineConversation {
  readonly id: string;
  readonly agent: MachineAgent;
  get(
    options?: AgentRequestOptions,
  ): Promise<MachineConversationState | undefined>;
  listTurns(options?: AgentRequestOptions): Promise<MachineConversationTurn[]>;
  watch(listener: MachineConversationListener): () => void;
  replace(
    metadata: MachineConversationMetadataInput,
    options?: AgentRequestOptions,
  ): Promise<MachineConversationMetadata>;
  /** Return conversation-specific instructions; an empty string means none. */
  getInstructions(options?: AgentRequestOptions): Promise<string>;
  /** Replace conversation-specific instructions; pass an empty string to clear. */
  replaceInstructions(
    instructions: string,
    options?: AgentRequestOptions,
  ): Promise<string>;
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
  subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
}

type ConversationCollection = {
  conversations: Record<string, MachineConversationMetadata>;
};

type ConversationInstructions = { instructions: string };

type TurnUpdate = {
  turns: MachineConversationTurn[];
  reset: boolean;
  isRunning: boolean;
};

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_EVENT_BYTES = 1024 * 1024;
const WATCH_RETRY_MAX_MS = 5_000;

class MachineAgentState implements MachineAgents {
  private readonly agents = new Map<string, AgentClient>();

  constructor(
    readonly machineId: string,
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
    const update = await this.readTurnUpdate(
      agentId,
      conversationId,
      undefined,
      options.signal,
    );
    return { ...metadata, isRunning: update.isRunning, turns: update.turns };
  }

  async listTurns(
    agentId: string,
    conversationId: string,
    options: AgentRequestOptions = {},
  ): Promise<MachineConversationTurn[]> {
    return (
      await this.readTurnUpdate(
        agentId,
        conversationId,
        undefined,
        options.signal,
      )
    ).turns;
  }

  async readTurnUpdate(
    agentId: string,
    conversationId: string,
    after: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<TurnUpdate> {
    const query = after ? `?${new URLSearchParams({ after }).toString()}` : "";
    return this.transport.requestJson<TurnUpdate>(
      `${this.conversationPath(agentId, conversationId)}/turns${query}`,
      { signal },
    );
  }

  subscribeEvents(listener: (event: RoolClientEvent) => void): () => void {
    return this.transport.subscribeEvents(listener);
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

  async getConversationInstructions(
    agentId: string,
    conversationId: string,
    options: AgentRequestOptions = {},
  ): Promise<string> {
    const result = await this.transport.requestJson<ConversationInstructions>(
      `${this.conversationPath(agentId, conversationId)}/instructions`,
      { signal: options.signal },
    );
    return result.instructions;
  }

  async replaceConversationInstructions(
    agentId: string,
    conversationId: string,
    instructions: string,
    options: AgentRequestOptions = {},
  ): Promise<string> {
    validateInstructions(instructions);
    const result = await this.transport.requestJson<ConversationInstructions>(
      `${this.conversationPath(agentId, conversationId)}/instructions`,
      jsonRequest("PUT", { instructions }, options.signal),
    );
    return result.instructions;
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
  private readonly listeners = new Set<MachineConversationListener>();
  private turns: MachineConversationTurn[] = [];
  private output: MachineConversationContentPart[] = [];
  private isRunning = false;
  private loading = true;
  private error: unknown = null;
  private watchController: AbortController | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private syncRequested = false;
  private syncLoop: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 250;
  private followController: AbortController | null = null;
  private followTask: Promise<void> | null = null;
  private followRetryMs = 250;

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

  watch(listener: MachineConversationListener): () => void {
    this.listeners.add(listener);
    listener(this.view());
    if (!this.watchController) this.startWatching();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopWatching();
    };
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

  getInstructions(options?: AgentRequestOptions): Promise<string> {
    return this.state.getConversationInstructions(
      this.agent.id,
      this.id,
      options,
    );
  }

  replaceInstructions(
    instructions: string,
    options?: AgentRequestOptions,
  ): Promise<string> {
    return this.state.replaceConversationInstructions(
      this.agent.id,
      this.id,
      instructions,
      options,
    );
  }

  async prompt(
    text: string,
    options: MachineConversationPromptOptions = {},
  ): Promise<void> {
    try {
      await this.state.prompt(this.agent.id, this.id, text, options);
    } finally {
      this.requestSync();
    }
  }

  follow(options?: MachineConversationFollowOptions): Promise<boolean> {
    return this.state.follow(this.agent.id, this.id, options);
  }

  async cancel(options?: MachineConversationCancelOptions): Promise<boolean> {
    try {
      return await this.state.cancel(this.agent.id, this.id, options);
    } finally {
      this.requestSync();
    }
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

  private startWatching(): void {
    const controller = new AbortController();
    this.watchController = controller;
    this.unsubscribeEvents = this.state.subscribeEvents((event) => {
      const matchesConversation =
        event.type === "conversation_changed" &&
        event.machineId === this.state.machineId &&
        event.agentId === this.agent.id &&
        event.conversationId === this.id;
      if (event.type === "session" || matchesConversation) {
        if (!this.followTask || event.type === "session") this.requestSync();
      }
    });
    this.requestSync();
  }

  private stopWatching(): void {
    this.watchController?.abort();
    this.watchController = null;
    this.followController?.abort();
    this.followController = null;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.syncRequested = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private requestSync(): void {
    const controller = this.watchController;
    if (!controller || controller.signal.aborted) return;
    this.syncRequested = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.syncLoop) return;

    const loop = this.runSyncLoop(controller);
    this.syncLoop = loop;
    const finished = () => {
      if (this.syncLoop === loop) this.syncLoop = null;
      const current = this.watchController;
      if (current && this.syncRequested && !current.signal.aborted) {
        this.requestSync();
      }
    };
    void loop.then(finished, finished);
  }

  private async runSyncLoop(controller: AbortController): Promise<void> {
    while (
      this.watchController === controller &&
      !controller.signal.aborted &&
      this.syncRequested
    ) {
      this.syncRequested = false;
      try {
        const after = this.turns.at(-1)?.id;
        const update = await this.state.readTurnUpdate(
          this.agent.id,
          this.id,
          after,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        this.turns = update.reset
          ? update.turns
          : [...this.turns, ...update.turns];
        this.isRunning = update.isRunning;
        this.loading = false;
        this.error = null;
        this.retryMs = 250;
        if (!this.isRunning || (update.reset && this.followTask)) {
          this.followController?.abort();
          this.output = [];
        }
        this.emit();
        if (this.isRunning) this.ensureFollow(controller);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        this.loading = false;
        this.error = error;
        this.emit();
        this.scheduleRetry(controller);
        return;
      }
    }
  }

  private scheduleRetry(controller: AbortController): void {
    if (this.retryTimer || this.watchController !== controller) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, WATCH_RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requestSync();
    }, delay);
  }

  private ensureFollow(watchController: AbortController): void {
    if (this.followTask || this.watchController !== watchController) return;

    const controller = new AbortController();
    this.followController = controller;
    this.output = [];
    this.emit();
    const task = this.runFollow(controller);
    this.followTask = task;
    const finished = () => {
      if (this.followTask === task) this.followTask = null;
      if (this.followController === controller) this.followController = null;
      const current = this.watchController;
      if (current && !current.signal.aborted) this.requestSync();
    };
    void task.then(finished, finished);
  }

  private async runFollow(controller: AbortController): Promise<void> {
    let streamFailed: Error | null = null;
    try {
      await this.state.follow(this.agent.id, this.id, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "output.delta") {
            this.output = [...this.output, event.content];
            this.error = null;
            this.emit();
          } else if (
            event.type === "error" &&
            event.code === "run_stream_failed"
          ) {
            streamFailed = new Error(event.detail);
          }
        },
      });
      if (streamFailed) throw streamFailed;
      this.followRetryMs = 250;
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      this.error = error;
      this.emit();
      const delay = this.followRetryMs;
      this.followRetryMs = Math.min(this.followRetryMs * 2, WATCH_RETRY_MAX_MS);
      await abortableDelay(delay, controller.signal);
    }
  }

  private view(): MachineConversationView {
    let end = this.turns.length;
    if (this.isRunning) {
      for (let index = this.turns.length - 1; index >= 0; index--) {
        if (this.turns[index].role !== "user") continue;
        end = index + 1;
        break;
      }
    }
    return {
      turns: this.turns.slice(0, end),
      output: [...this.output],
      isRunning: this.isRunning,
      loading: this.loading,
      error: this.error,
    };
  }

  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }
}

export function createMachineAgents(
  machineId: string,
  machinePath: string,
  transport: AgentTransport,
): MachineAgents {
  return new MachineAgentState(machineId, machinePath, transport);
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
    throw new Error("Agent system instructions must be a string");
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

function validateInstructions(instructions: string): void {
  if (typeof instructions !== "string") {
    throw new Error("Conversation instructions must be a string");
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

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("was aborted"))
  );
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });

    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
