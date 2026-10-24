import {
  TokenAuth,
  type AuthTokenResponse,
  type TokenAuthConfig,
} from "./auth-base.js";

export interface NativeAuthConfig extends TokenAuthConfig {
  redirectUri: string;
  openExternal: (url: string) => void | Promise<void>;
}

export class NativeAuth extends TokenAuth {
  private readonly redirectUri: string;
  private readonly openExternal: (url: string) => void | Promise<void>;

  constructor(config: NativeAuthConfig) {
    super(config);
    this.redirectUri = config.redirectUri;
    this.openExternal = config.openExternal;
  }

  async initialize(): Promise<boolean> {
    return this.isAuthenticated();
  }

  async login(
    _appName: string,
    params?: Record<string, string>,
  ): Promise<void> {
    await this.startPkce("login", params);
  }

  async signup(
    _appName: string,
    params?: Record<string, string>,
  ): Promise<void> {
    await this.startPkce("signup", params);
  }

  cancelLogin(): void {
    this.clearTransientState();
  }

  async verify(token: string): Promise<boolean> {
    // Email links start an independent sign-in, even after the browser was
    // closed. Invalidate its pending exchange before either response arrives.
    this.clearTransientState();
    return super.verify(token);
  }

  async handleRedirect(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const callback = new URL(this.redirectUri);
    if (parsed.protocol !== callback.protocol || parsed.host !== callback.host
      || parsed.pathname !== callback.pathname || parsed.username || parsed.password || parsed.hash) return false;

    const code = parsed.searchParams.get("code");
    const incomingState = parsed.searchParams.get("state");
    const verifier = this.readString(this.verifierKey);
    const storedState = this.readString(this.stateKey);
    if (!verifier || !storedState || incomingState !== storedState) return false;
    const error = parsed.searchParams.get("error");
    if (error) {
      this.clearTransientState();
      return false;
    }
    if (!code) return false;

    let response: Response;
    try {
      response = await this.fetchAuth("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier }),
      });
    } catch (error) {
      console.error("[RoolAuth] Native token exchange failed:", error);
      return false;
    }

    const data = await readJson<AuthTokenResponse>(response);
    // Email sign-in, cancellation or a newer attempt may have won while the
    // exchange was in flight. Never replace that session with a late callback.
    if (this.readString(this.stateKey) !== storedState) return false;
    this.clearTransientState();
    if (!response.ok || !data || !this.acceptTokenResponse(data)) return false;
    this.emitAuthState(true);
    return true;
  }

  protected async verificationParams(): Promise<Record<string, string>> {
    const verifier = base64Url(randomBytes(32));
    const state = base64Url(randomBytes(24));
    const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    this.writeString(this.verifierKey, verifier);
    this.writeString(this.stateKey, state);
    return { redirect_uri: this.redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" };
  }

  protected async continueVerification(url: string): Promise<void> { await this.openExternal(url); }
  protected async finishVerificationRedirect(url: string): Promise<boolean> { return this.handleRedirect(url); }

  protected clearTransientState(): void {
    this.removeString(this.verifierKey);
    this.removeString(this.stateKey);
  }

  private get verifierKey(): string {
    return this.keyFor("pkce_verifier");
  }

  private get stateKey(): string {
    return this.keyFor("pkce_state");
  }

  private async startPkce(flow: "login" | "signup", params?: Record<string, string>): Promise<void> {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const state = Array.from(randomBytes(16), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    this.writeString(this.verifierKey, verifier);
    this.writeString(this.stateKey, state);

    const url = new URL(`${this.authBaseUrl}/authorize`);
    url.searchParams.set("flow", flow);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (params?.rvid) url.searchParams.set("rvid", params.rvid);
    if (params?.invite) url.searchParams.set("invite", params.invite);
    try {
      await this.openExternal(url.toString());
    } catch (error) {
      if (this.readString(this.stateKey) === state) this.clearTransientState();
      throw error;
    }
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(buffer: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
