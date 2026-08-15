import packageJson from "../package.json" with { type: "json" };
import { createRoolEvents, type RoolEvents } from "./events.js";
import type { MachineFileUploadProgress } from "./files.js";
import { RoolMachine } from "./machine.js";
import { throwProblemResponse } from "./problem.js";
import type {
  Gift,
  GiftClaimResult,
  GiftList,
  GiftPreview,
  GiftUpdate,
  Greeting,
  InviteRedemption,
  MachineInvitePreview,
  MachineSettings,
  MachineSummary,
  RoolClientConfig,
  RoolRequestTokens,
  RoolSession,
  UserAccount,
  UserAppData,
  UserProfile,
} from "./types.js";

const DEFAULT_API_URL = "https://api.rool.dev";

type SendOptions = {
  accept?: string;
  onUploadProgress?: (progress: MachineFileUploadProgress) => void;
};

export const roolSdkVersion = packageJson.version;

export class RoolClient {
  private readonly apiUrl: string;
  private readonly fetchRequest: typeof globalThis.fetch;
  private readonly usesDefaultFetch: boolean;
  private readonly getTokens: () => Promise<RoolRequestTokens | undefined>;
  private readonly onAuthInvalidated: RoolClientConfig["onAuthInvalidated"];
  private readonly identity: RoolClientConfig["client"];
  private readonly machines = new Map<string, RoolMachine>();
  readonly events: RoolEvents;

  constructor(config: RoolClientConfig = {}) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchRequest = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.usesDefaultFetch = config.fetch === undefined;
    this.identity = config.client;
    this.onAuthInvalidated = config.onAuthInvalidated;

    if (config.getTokens && config.getAccessToken) {
      throw new Error("getTokens and getAccessToken cannot be used together");
    }
    if (config.getTokens) {
      this.getTokens = async () => (await config.getTokens!()) ?? undefined;
    } else if (config.getAccessToken) {
      this.getTokens = async () => {
        const accessToken = await config.getAccessToken!();
        return accessToken ? { accessToken, roolToken: "" } : undefined;
      };
    } else {
      this.getTokens = async () => undefined;
    }

    this.events = createRoolEvents({
      poll: (syncToken, signal) => {
        const query = new URLSearchParams({ syncToken });
        return this.request(
          `/v2/events?${query}`,
          { headers: { Prefer: "wait=45" }, signal },
          true,
        );
      },
      getSession: () => this.getSession(),
    });
  }

  getSession(): Promise<RoolSession> {
    return this.requestJson("/v2/session");
  }

  getAccount(): Promise<UserAccount> {
    return this.requestJson("/v2/me");
  }

  async deleteAccount(): Promise<void> {
    await this.request("/v2/me", { method: "DELETE" });
  }

  getProfile(): Promise<UserProfile> {
    return this.requestJson("/v2/me/profile");
  }

  replaceProfile(profile: UserProfile): Promise<UserProfile> {
    return this.requestJson("/v2/me/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
  }

  getUserAppData(): Promise<UserAppData> {
    return this.requestJson("/v2/me/app-data");
  }

  async setUserAppData(key: string, value: unknown): Promise<void> {
    await this.request(`/v2/me/app-data/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  }

  async deleteUserAppData(key: string): Promise<void> {
    await this.request(`/v2/me/app-data/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  getGreeting(language?: string): Promise<Greeting> {
    if (!language) return this.requestJson("/v2/greeting");
    const query = new URLSearchParams({ language });
    return this.requestJson(`/v2/greeting?${query}`);
  }

  listMachines(): Promise<MachineSummary[]> {
    return this.requestJson("/v2/machines");
  }

  createMachine(settings: MachineSettings): Promise<MachineSummary> {
    return this.requestJson("/v2/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }

  machine(machineId: string): RoolMachine {
    let machine = this.machines.get(machineId);
    if (machine) return machine;

    machine = new RoolMachine(machineId, {
      send: (path, init, onUploadProgress) =>
        this.send(path, init, { onUploadProgress }),
      request: (path, init, allowHttpErrors) =>
        this.request(path, init, allowHttpErrors),
      requestJson: <T>(path: string, init?: RequestInit) =>
        this.requestJson<T>(path, init),
      deleted: () => this.machines.delete(machineId),
    });
    this.machines.set(machineId, machine);
    return machine;
  }

  getInvitePreview(token: string): Promise<MachineInvitePreview> {
    return this.requestJson(`/v2/invites/${encodeURIComponent(token)}`);
  }

  redeemInvite(token: string): Promise<InviteRedemption> {
    return this.requestJson(
      `/v2/invites/${encodeURIComponent(token)}/redemption`,
      { method: "POST" },
    );
  }

  /** Look up a gift by its code without claiming it. */
  previewGift(code: string): Promise<GiftPreview> {
    return this.requestJson(`/v2/gifts/${encodeURIComponent(code)}`);
  }

  /** Claim a gift for the current account. */
  claimGift(code: string): Promise<GiftClaimResult> {
    return this.requestJson(`/v2/gifts/${encodeURIComponent(code)}/claim`, {
      method: "POST",
    });
  }

  /** List the current user's claimed and unclaimed gifts. */
  listGifts(): Promise<GiftList> {
    return this.requestJson("/v2/me/gifts");
  }

  /** Set or clear a gift's note, or change its archived state. */
  updateGift(giftId: string, changes: GiftUpdate): Promise<Gift> {
    return this.requestJson(`/v2/me/gifts/${encodeURIComponent(giftId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
  }

  /** Mint a new code for an unclaimed gift. */
  rotateGiftCode(giftId: string): Promise<Gift> {
    return this.requestJson(`/v2/me/gifts/${encodeURIComponent(giftId)}/code`, {
      method: "POST",
    });
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  private async request(
    path: string,
    init?: RequestInit,
    allowHttpErrors = false,
  ): Promise<Response> {
    const accept =
      new Headers(init?.headers).get("Accept") ?? "application/json";
    const response = await this.send(path, init, { accept });
    if (response.status === 401) void this.onAuthInvalidated?.();
    if (response.ok || allowHttpErrors) return response;

    return throwProblemResponse(response);
  }

  private async send(
    path: string,
    init?: RequestInit,
    options: SendOptions = {},
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (options.accept) headers.set("Accept", options.accept);
    headers.set("X-Rool-SDK-Name", packageJson.name);
    headers.set("X-Rool-SDK-Version", packageJson.version);
    if (this.identity?.appName) {
      headers.set("X-Rool-App-Name", this.identity.appName);
    }
    if (this.identity?.appVersion) {
      headers.set("X-Rool-App-Version", this.identity.appVersion);
    }
    if (this.identity?.osVersion) {
      headers.set("X-Rool-OS-Version", this.identity.osVersion);
    }

    const tokens = await this.getTokens();
    if (tokens?.accessToken) {
      headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    }
    if (tokens?.roolToken) headers.set("X-Rool-Token", tokens.roolToken);

    const requestInit: RequestInit & { duplex?: "half" } = {
      ...init,
      headers,
    };
    if (isReadableStream(init?.body)) requestInit.duplex = "half";

    const url = `${this.apiUrl}${path}`;
    const body = init?.body;
    if (!options.onUploadProgress || body === undefined || body === null) {
      return this.fetchRequest(url, requestInit);
    }

    const useXmlHttpRequest =
      this.usesDefaultFetch &&
      typeof XMLHttpRequest !== "undefined" &&
      !isReadableStream(body);
    if (useXmlHttpRequest) {
      return sendXmlHttpRequest(
        url,
        requestInit,
        body,
        options.onUploadProgress,
      );
    }

    const progressRequest = requestWithUploadProgress(
      url,
      requestInit,
      body,
      options.onUploadProgress,
    );
    return this.fetchRequest(url, progressRequest);
  }
}

function isReadableStream(
  body: BodyInit | null | undefined,
): body is ReadableStream {
  return (
    typeof ReadableStream !== "undefined" && body instanceof ReadableStream
  );
}

function requestWithUploadProgress(
  url: string,
  init: RequestInit,
  body: BodyInit,
  onUploadProgress: (progress: MachineFileUploadProgress) => void,
): RequestInit & { duplex: "half" } {
  const preparedInit: RequestInit & { duplex?: "half" } = { ...init };
  if (isReadableStream(body)) preparedInit.duplex = "half";
  const preparedRequest = new Request(url, preparedInit);
  if (!preparedRequest.body)
    throw new Error("Upload request is missing its body");

  const totalBytes = uploadBodySize(body);
  let transferredBytes = 0;
  reportUploadProgress(onUploadProgress, transferredBytes, totalBytes);
  const progressBody = preparedRequest.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        transferredBytes += chunk.byteLength;
        reportUploadProgress(onUploadProgress, transferredBytes, totalBytes);
      },
    }),
  );

  return {
    ...init,
    headers: preparedRequest.headers,
    body: progressBody,
    duplex: "half",
  };
}

function sendXmlHttpRequest(
  url: string,
  init: RequestInit,
  body: Exclude<BodyInit, ReadableStream>,
  onUploadProgress: (progress: MachineFileUploadProgress) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const signal = init.signal;
    const totalBytes = uploadBodySize(body);
    let transferredBytes = 0;

    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => request.abort();
    request.upload.onprogress = (event) => {
      transferredBytes = event.loaded;
      const reportedTotal = event.lengthComputable ? event.total : totalBytes;
      reportUploadProgress(onUploadProgress, transferredBytes, reportedTotal);
    };
    request.upload.onload = (event) => {
      const loadedBytes = event.loaded;
      if (loadedBytes === transferredBytes) return;
      transferredBytes = loadedBytes;
      const reportedTotal = event.lengthComputable ? event.total : totalBytes;
      reportUploadProgress(onUploadProgress, transferredBytes, reportedTotal);
    };
    request.onload = () => {
      cleanup();
      const hasResponseBody =
        request.response instanceof ArrayBuffer &&
        request.response.byteLength > 0;
      const responseBody = hasResponseBody ? request.response : null;
      resolve(
        new Response(responseBody, {
          status: request.status,
          statusText: request.statusText,
          headers: parseXmlHttpRequestHeaders(request.getAllResponseHeaders()),
        }),
      );
    };
    request.onerror = () => {
      cleanup();
      reject(new TypeError("Network request failed"));
    };
    request.onabort = () => {
      cleanup();
      reject(
        signal?.reason ??
          new DOMException("This operation was aborted", "AbortError"),
      );
    };

    if (signal?.aborted) {
      reject(
        signal.reason ??
          new DOMException("This operation was aborted", "AbortError"),
      );
      return;
    }

    request.open(init.method ?? "GET", url);
    request.responseType = "arraybuffer";
    request.withCredentials = init.credentials === "include";
    new Headers(init.headers).forEach((value, name) => {
      request.setRequestHeader(name, value);
    });
    signal?.addEventListener("abort", abort, { once: true });
    reportUploadProgress(onUploadProgress, transferredBytes, totalBytes);
    request.send(body);
  });
}

function reportUploadProgress(
  listener: (progress: MachineFileUploadProgress) => void,
  transferredBytes: number,
  totalBytes: number | undefined,
): void {
  const progress: MachineFileUploadProgress = { transferredBytes };
  if (totalBytes !== undefined) progress.totalBytes = totalBytes;
  listener(progress);
}

function uploadBodySize(body: BodyInit): number | undefined {
  if (typeof body === "string")
    return new TextEncoder().encode(body).byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  return undefined;
}

function parseXmlHttpRequestHeaders(rawHeaders: string): Headers {
  const headers = new Headers();
  for (const line of rawHeaders.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) throw new Error(`Invalid response header: ${line}`);
    headers.append(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return headers;
}
