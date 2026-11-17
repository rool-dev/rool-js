import type { RoolClientEvent } from "./events.js";
import type { MachineFilePath } from "./files.js";
import { throwProblemResponse } from "./problem.js";
import { jsonRequest } from "./transport.js";

/** @deprecated Effort ids come from `machine.getModels()`. */
export type MachinePromptEffort = string;
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

export interface ConversationRequestOptions {
  signal?: AbortSignal;
}

export interface MachineConversationCreateOptions extends ConversationRequestOptions {
  id?: string;
  name?: string;
  visibility?: MachineConversationVisibility;
}

export interface MachineConversationPromptOptions extends ConversationRequestOptions {
  /** A model id from `machine.getModels()`; the catalog's default when omitted. */
  model?: string;
  /** One of `model`'s effort ids, so it needs `model`; its default effort when omitted. */
  effort?: string;
  readOnly?: boolean;
  attachments?: readonly MachineFilePath[];
  responseSchema?: Record<string, unknown>;
  replaceTurnId?: string;
  /** Your app's instructions for this prompt only; at most 16,000 characters. */
  appInstructions?: string;
}

export interface MachineConversationFollowOptions extends ConversationRequestOptions {
  onEvent?: (event: MachineRunEvent) => void;
  /** Fail the stream when no data arrives for this long. Default 30s. */
  stallTimeoutMs?: number;
}

export type MachineConversationCancelOptions = ConversationRequestOptions;

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
  readonly machineId: string;
  get(
    options?: ConversationRequestOptions,
  ): Promise<MachineConversationState | undefined>;
  listTurns(options?: ConversationRequestOptions): Promise<MachineConversationTurn[]>;
  watch(listener: MachineConversationListener): () => void;
  replace(
    metadata: MachineConversationMetadataInput,
    options?: ConversationRequestOptions,
  ): Promise<MachineConversationMetadata>;
  /** Return conversation-specific instructions; an empty string means none. */
  getInstructions(options?: ConversationRequestOptions): Promise<string>;
  /** Replace conversation-specific instructions; pass an empty string to clear. */
  replaceInstructions(
    instructions: string,
    options?: ConversationRequestOptions,
  ): Promise<string>;
  prompt(
    text: string,
    options?: MachineConversationPromptOptions,
  ): Promise<void>;
  follow(options?: MachineConversationFollowOptions): Promise<boolean>;
  cancel(options?: MachineConversationCancelOptions): Promise<boolean>;
  rename(name: string | null, options?: ConversationRequestOptions): Promise<void>;
  delete(options?: ConversationRequestOptions): Promise<void>;
}

interface ConversationTransport {
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
// 3× the server's keepalive cadence; a longer gap means the connection
// is dead even when the socket never errors (sleep, network switch).
const RUN_STALL_MS = 30_000;

export class MachineConversations {
  private readonly conversations = new Map<string, ConversationClient>();

  constructor(
    readonly machineId: string,
    private readonly machinePath: string,
    private readonly transport: ConversationTransport,
  ) {}

  conversation(id: string): MachineConversation {
    validateId(id, "conversationId");
    let conversation = this.conversations.get(id);
    if (!conversation) {
      conversation = new ConversationClient(this.machineId, id, this);
      this.conversations.set(id, conversation);
    }
    return conversation;
  }

  async createConversation(
    options: MachineConversationCreateOptions = {},
  ): Promise<MachineConversation> {
    const id = options.id ?? randomId();
    const conversation = this.conversation(id);
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
    options: ConversationRequestOptions = {},
  ): Promise<MachineConversationSummary[]> {
    const collection = await this.transport.requestJson<ConversationCollection>(
      `${this.machinePath}/conversations`,
      { signal: options.signal },
    );
    return Object.entries(collection.conversations).map(([id, metadata]) => ({
      id,
      ...metadata,
    }));
  }

  async getConversation(
    conversationId: string,
    options: ConversationRequestOptions,
  ): Promise<MachineConversationState | undefined> {
    const response = await this.transport.request(
      this.conversationPath(conversationId),
      { signal: options.signal },
      true,
    );
    if (response.status === 404) return undefined;
    if (!response.ok) await throwProblemResponse(response);
    const metadata = (await response.json()) as MachineConversationMetadata;
    const update = await this.readTurnUpdate(
      conversationId,
      undefined,
      options.signal,
    );
    return { ...metadata, isRunning: update.isRunning, turns: update.turns };
  }

  async listTurns(
    conversationId: string,
    options: ConversationRequestOptions = {},
  ): Promise<MachineConversationTurn[]> {
    return (
      await this.readTurnUpdate(
        conversationId,
        undefined,
        options.signal,
      )
    ).turns;
  }

  async readTurnUpdate(
    conversationId: string,
    after: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<TurnUpdate> {
    const query = after ? `?${new URLSearchParams({ after }).toString()}` : "";
    return this.transport.requestJson<TurnUpdate>(
      `${this.conversationPath(conversationId)}/turns${query}`,
      { signal },
    );
  }

  subscribeEvents(listener: (event: RoolClientEvent) => void): () => void {
    return this.transport.subscribeEvents(listener);
  }

  replaceConversation(
    conversationId: string,
    metadata: MachineConversationMetadataInput,
    options: ConversationRequestOptions = {},
  ): Promise<MachineConversationMetadata> {
    validateMetadata(metadata);
    return this.transport.requestJson(
      this.conversationPath(conversationId),
      jsonRequest("PUT", metadata, options.signal),
    );
  }

  async getConversationInstructions(
    conversationId: string,
    options: ConversationRequestOptions = {},
  ): Promise<string> {
    const result = await this.transport.requestJson<ConversationInstructions>(
      `${this.conversationPath(conversationId)}/instructions`,
      { signal: options.signal },
    );
    return result.instructions;
  }

  async replaceConversationInstructions(
    conversationId: string,
    instructions: string,
    options: ConversationRequestOptions = {},
  ): Promise<string> {
    validateInstructions(instructions);
    const result = await this.transport.requestJson<ConversationInstructions>(
      `${this.conversationPath(conversationId)}/instructions`,
      jsonRequest("PUT", { instructions }, options.signal),
    );
    return result.instructions;
  }

  async deleteConversation(
    conversationId: string,
    options: ConversationRequestOptions = {},
  ): Promise<void> {
    await this.transport.request(
      this.conversationPath(conversationId),
      { method: "DELETE", signal: options.signal },
    );
    this.conversations.delete(conversationId);
  }

  async prompt(
    conversationId: string,
    text: string,
    options: MachineConversationPromptOptions,
  ): Promise<void> {
    if (!text) throw new Error("Prompt text is required");
    if (options.effort && !options.model) {
      throw new Error("Prompt effort requires a model");
    }
    const attachments = options.attachments ?? [];
    for (const path of attachments) validateAttachment(path);

    const input = {
      content: [
        { type: "text", text },
        ...attachments.map((path) => ({ type: "attachment" as const, path })),
      ],
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
      ...(options.responseSchema !== undefined
        ? { responseSchema: options.responseSchema }
        : {}),
      ...(options.replaceTurnId
        ? { replaceTurnId: options.replaceTurnId }
        : {}),
      ...(options.appInstructions
        ? { appInstructions: options.appInstructions }
        : {}),
    };
    const runPath = `${this.conversationPath(conversationId)}/run`;
    await this.transport.request(
      runPath,
      jsonRequest("POST", input, options.signal),
    );
  }

  async follow(
    conversationId: string,
    options: MachineConversationFollowOptions = {},
  ): Promise<boolean> {
    const runPath = `${this.conversationPath(conversationId)}/run`;
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
    conversationId: string,
    options: ConversationRequestOptions = {},
  ): Promise<boolean> {
    const response = await this.transport.request(
      `${this.conversationPath(conversationId)}/run`,
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
    const stallMs = options.stallTimeoutMs ?? RUN_STALL_MS;
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffered = "";
    try {
      while (true) {
        const result = await readWithStallTimeout(reader, stallMs);
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
      // Tears down the connection after a stall or parse failure; a no-op
      // once the stream has completed.
      void body.cancel().catch(() => undefined);
    }
  }

  private conversationPath(conversationId: string): string {
    return `${this.machinePath}/conversations/${encodeURIComponent(conversationId)}`;
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
    readonly machineId: string,
    readonly id: string,
    private readonly state: MachineConversations,
  ) {}

  get(
    options: ConversationRequestOptions = {},
  ): Promise<MachineConversationState | undefined> {
    return this.state.getConversation(this.id, options);
  }

  listTurns(
    options: ConversationRequestOptions = {},
  ): Promise<MachineConversationTurn[]> {
    return this.state.listTurns(this.id, options);
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
    options?: ConversationRequestOptions,
  ): Promise<MachineConversationMetadata> {
    return this.state.replaceConversation(
      this.id,
      metadata,
      options,
    );
  }

  getInstructions(options?: ConversationRequestOptions): Promise<string> {
    return this.state.getConversationInstructions(
      this.id,
      options,
    );
  }

  replaceInstructions(
    instructions: string,
    options?: ConversationRequestOptions,
  ): Promise<string> {
    return this.state.replaceConversationInstructions(
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
      await this.state.prompt(this.id, text, options);
    } finally {
      this.requestSync();
    }
  }

  follow(options?: MachineConversationFollowOptions): Promise<boolean> {
    return this.state.follow(this.id, options);
  }

  async cancel(options?: MachineConversationCancelOptions): Promise<boolean> {
    try {
      return await this.state.cancel(this.id, options);
    } finally {
      this.requestSync();
    }
  }

  async rename(
    name: string | null,
    options: ConversationRequestOptions = {},
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

  delete(options?: ConversationRequestOptions): Promise<void> {
    return this.state.deleteConversation(this.id, options);
  }

  private startWatching(): void {
    const controller = new AbortController();
    this.watchController = controller;
    this.unsubscribeEvents = this.state.subscribeEvents((event) => {
      const matchesConversation =
        event.type === "conversation_changed" &&
        event.machineId === this.machineId &&
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
      await this.state.follow(this.id, {
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


function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("was aborted"))
  );
}

async function readWithStallTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stallMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Run stream stalled for ${stallMs}ms`)),
      stallMs,
    );
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
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
