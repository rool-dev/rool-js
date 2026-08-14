import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import open from "open";
import { resolveAuthUrl } from "./auth-url.js";
import type { RoolAuth, RoolRequestTokens } from "./types.js";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

interface StoredCredentials {
  access_token: string;
  refresh_token: string;
  rool_token?: string | null;
  expires_at: number;
  auth_url?: string;
}

interface LoginCredentials {
  accessToken: string;
  refreshToken: string;
  roolToken: string | null;
  expiresAt: number;
}

export interface NodeAuthConfig {
  /** API origin used to derive the auth endpoint. */
  apiUrl?: string;
  /** Auth endpoint override, required when the API origin is loopback. */
  authUrl?: string;
  /** Credential profile stored independently for the resolved auth endpoint. */
  profile?: string;
  /** Explicit credential file path, overriding the endpoint and profile path. */
  credentialsPath?: string;
  /** Browser login timeout in milliseconds. */
  loginTimeoutMs?: number;
  /** Custom transport for token refresh. */
  fetch?: typeof globalThis.fetch;
  /** Custom browser launcher. */
  openUrl?: (url: string) => void | Promise<void>;
}

export class NodeAuthLoginRequiredError extends Error {
  constructor(message = "Node authentication is required; call login()") {
    super(message);
    this.name = "NodeAuthLoginRequiredError";
  }
}

export class NodeAuth implements RoolAuth {
  readonly credentialsPath: string;
  readonly getTokens: () => Promise<RoolRequestTokens | undefined>;
  readonly getAccessToken: () => Promise<string>;

  private readonly authUrl: string;
  private readonly listeners = new Set<(authenticated: boolean) => void>();
  private readonly loginTimeoutMs: number;
  private readonly fetchRequest: typeof globalThis.fetch;
  private readonly openUrl: (url: string) => void | Promise<void>;
  private refreshInFlight: Promise<StoredCredentials> | null = null;

  constructor(config: NodeAuthConfig = {}) {
    this.authUrl = resolveAuthUrl(config);
    this.credentialsPath = resolveCredentialsPath(
      this.authUrl,
      config.profile,
      config.credentialsPath,
    );
    this.loginTimeoutMs = config.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    this.fetchRequest = config.fetch ?? globalThis.fetch;
    this.openUrl = config.openUrl ?? ((url) => open(url).then(() => undefined));
    this.getTokens = () => this.resolveTokens();
    this.getAccessToken = async () => {
      const tokens = await this.getTokens();
      if (!tokens) throw new NodeAuthLoginRequiredError();
      return tokens.accessToken;
    };
  }

  initialize(): Promise<boolean> {
    return this.isAuthenticated();
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.readCredentials()) !== null;
  }

  login(appName: string, params: Record<string, string> = {}): Promise<void> {
    return this.authFlow("login", appName, params);
  }

  signup(appName: string, params: Record<string, string> = {}): Promise<void> {
    return this.authFlow("signup", appName, params);
  }

  onAuthStateChanged(listener: (authenticated: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readonly logout = async (): Promise<void> => {
    try {
      await fs.unlink(this.credentialsPath);
      this.emitAuthState(false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };

  private async authFlow(
    flow: "login" | "signup",
    appName: string,
    params: Record<string, string>,
  ): Promise<void> {
    const state = randomBytes(32).toString("base64url");
    const server = createServer();
    await listen(server);

    const address = server.address();
    if (!address || typeof address === "string") {
      await close(server);
      throw new Error("Could not start the Node authentication callback");
    }

    const redirectUri = `http://127.0.0.1:${address.port}`;
    const loginUrl = new URL(`/${flow}`, new URL(this.authUrl).origin);
    for (const [name, value] of Object.entries(params)) {
      loginUrl.searchParams.set(name, value);
    }
    loginUrl.searchParams.set("redirect_uri", redirectUri);
    loginUrl.searchParams.set("app_name", appName);
    loginUrl.searchParams.set("state", state);

    const callback = receiveLogin(server, state, this.loginTimeoutMs);
    try {
      await this.openUrl(loginUrl.toString());
      const credentials = await callback.result;
      await this.writeCredentials({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        rool_token: credentials.roolToken,
        expires_at: credentials.expiresAt,
        auth_url: this.authUrl,
      });
      this.emitAuthState(true);
    } finally {
      callback.cancel();
      await close(server);
    }
  }

  private emitAuthState(authenticated: boolean): void {
    for (const listener of this.listeners) listener(authenticated);
  }

  private async resolveTokens(): Promise<RoolRequestTokens | undefined> {
    let credentials = await this.readCredentials();
    if (!credentials) return undefined;

    if (credentials.expires_at <= Date.now() + REFRESH_BUFFER_MS) {
      if (!this.refreshInFlight) {
        this.refreshInFlight = this.refresh(credentials).finally(() => {
          this.refreshInFlight = null;
        });
      }
      credentials = await this.refreshInFlight;
    }

    return {
      accessToken: credentials.access_token,
      roolToken: credentials.rool_token ?? "",
    };
  }

  private async refresh(
    credentials: StoredCredentials,
  ): Promise<StoredCredentials> {
    const response = await this.fetchRequest(`${this.authUrl}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: credentials.refresh_token,
        rool_token: credentials.rool_token ?? null,
      }),
    });

    if (response.status === 400 || response.status === 401) {
      await this.logout();
      throw new NodeAuthLoginRequiredError(
        "Node authentication expired; call login() again",
      );
    }
    if (!response.ok) {
      throw new Error(
        `Could not refresh Node authentication: HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = data.id_token;
    const refreshToken = data.refresh_token;
    const roolToken = data.rool_token;
    const expiresIn = Number(data.expires_in);
    const hasInvalidRoolToken =
      roolToken !== undefined &&
      roolToken !== null &&
      typeof roolToken !== "string";
    if (
      typeof accessToken !== "string" ||
      typeof refreshToken !== "string" ||
      hasInvalidRoolToken ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new Error("The authentication refresh response is invalid");
    }

    const refreshed: StoredCredentials = {
      access_token: accessToken,
      refresh_token: refreshToken,
      rool_token:
        typeof roolToken === "string"
          ? roolToken
          : roolToken === null
            ? null
            : (credentials.rool_token ?? null),
      expires_at: Date.now() + expiresIn * 1000,
      auth_url: this.authUrl,
    };
    await this.writeCredentials(refreshed);
    return refreshed;
  }

  private async readCredentials(): Promise<StoredCredentials | null> {
    let serialized: string;
    try {
      serialized = await fs.readFile(this.credentialsPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error(`Invalid Node credentials at ${this.credentialsPath}`);
    }
    if (!isStoredCredentials(value)) {
      throw new Error(`Invalid Node credentials at ${this.credentialsPath}`);
    }
    if (
      value.auth_url &&
      resolveAuthUrl({ authUrl: value.auth_url }) !== this.authUrl
    ) {
      throw new Error(
        `Node credentials at ${this.credentialsPath} belong to another auth endpoint`,
      );
    }
    return value;
  }

  private async writeCredentials(
    credentials: StoredCredentials,
  ): Promise<void> {
    const directory = dirname(this.credentialsPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.credentialsPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(credentials, null, 2)}\n`,
        { mode: 0o600 },
      );
      await fs.rename(temporaryPath, this.credentialsPath);
    } finally {
      try {
        await fs.unlink(temporaryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

function resolveCredentialsPath(
  authUrl: string,
  profile: string | undefined,
  configuredPath: string | undefined,
): string {
  if (configuredPath) {
    if (configuredPath === "~") return homedir();
    if (configuredPath.startsWith("~/")) {
      return join(homedir(), configuredPath.slice(2));
    }
    return configuredPath;
  }

  if (profile && !/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new Error("Node authentication profile contains invalid characters");
  }
  const endpointHash = createHash("sha256")
    .update(authUrl)
    .digest("hex")
    .slice(0, 8);
  const profileSuffix = profile ? `-${profile}` : "";
  return join(
    homedir(),
    ".config",
    "rool",
    `credentials-${endpointHash}${profileSuffix}.json`,
  );
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== "object") return false;
  const credentials = value as Record<string, unknown>;
  return (
    typeof credentials.access_token === "string" &&
    typeof credentials.refresh_token === "string" &&
    (credentials.rool_token === undefined ||
      credentials.rool_token === null ||
      typeof credentials.rool_token === "string") &&
    typeof credentials.expires_at === "number" &&
    (credentials.auth_url === undefined ||
      typeof credentials.auth_url === "string")
  );
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function receiveLogin(
  server: Server,
  expectedState: string,
  timeoutMs: number,
): { result: Promise<LoginCredentials>; cancel: () => void } {
  let settled = false;
  let resolveResult: (credentials: LoginCredentials) => void;
  let rejectResult: (error: unknown) => void;
  const result = new Promise<LoginCredentials>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const timeout = setTimeout(() => {
    settle(() => rejectResult(new Error("Node authentication timed out")));
  }, timeoutMs);
  const settle = (action: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    action();
  };

  server.on("request", (request, response) => {
    void handleCallbackRequest(request, response, expectedState)
      .then((credentials) => {
        if (credentials) settle(() => resolveResult(credentials));
      })
      .catch((error) => settle(() => rejectResult(error)));
  });
  server.once("error", (error) => settle(() => rejectResult(error)));

  return {
    result,
    cancel: () => settle(() => undefined),
  };
}

async function handleCallbackRequest(
  request: IncomingMessage,
  response: import("node:http").ServerResponse,
  expectedState: string,
): Promise<LoginCredentials | null> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(callbackPage);
    return null;
  }
  if (request.method !== "POST" || url.pathname !== "/callback") {
    response.writeHead(404);
    response.end();
    return null;
  }

  const body = await readRequestBody(request);
  const params = new URLSearchParams(body);
  if (params.get("state") !== expectedState) {
    response.writeHead(400);
    response.end("Invalid authentication state");
    throw new Error("Node authentication state mismatch");
  }

  const accessToken = params.get("id_token");
  const refreshToken = params.get("refresh_token");
  const roolToken = params.get("rool_token");
  const expiresIn = Number(params.get("expires_in"));
  if (
    !accessToken ||
    !refreshToken ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    response.writeHead(400);
    response.end("Invalid authentication response");
    throw new Error("The Node authentication response is invalid");
  }

  response.writeHead(200);
  response.end("Authentication complete. You can close this window.");
  return {
    accessToken,
    refreshToken,
    roolToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_CALLBACK_BODY_BYTES) {
        request.destroy();
        reject(new Error("The Node authentication response is too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

const callbackPage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Rool authentication</title></head>
  <body>
    <p>Completing authentication…</p>
    <script>
      const body = window.location.hash.slice(1);
      fetch('/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }).then(async (response) => {
        document.body.textContent = response.ok
          ? 'Authentication complete. You can close this window.'
          : await response.text();
      });
    </script>
  </body>
</html>`;
