import {
  TokenAuth,
  type AuthTokenResponse,
  type TokenAuthConfig,
} from "./auth-base.js";
import type { PasswordSignInResult } from "./types.js";

export type NativeAuthProvider = "google" | "apple";

export interface NativeAuthConfig extends TokenAuthConfig {
  redirectUri: string;
  defaultProvider?: NativeAuthProvider;
  openExternal: (url: string) => void | Promise<void>;
}

export class NativeAuth extends TokenAuth {
  private readonly redirectUri: string;
  private readonly defaultProvider: NativeAuthProvider;
  private readonly openExternal: (url: string) => void | Promise<void>;

  constructor(config: NativeAuthConfig) {
    super(config);
    this.redirectUri = config.redirectUri;
    this.defaultProvider = config.defaultProvider ?? "google";
    this.openExternal = config.openExternal;
  }

  async initialize(): Promise<boolean> {
    return this.isAuthenticated();
  }

  async login(
    _appName: string,
    params?: Record<string, string>,
  ): Promise<void> {
    await this.startPkce(params);
  }

  async signup(
    _appName: string,
    params?: Record<string, string>,
  ): Promise<void> {
    await this.startPkce(params);
  }

  async handleRedirect(url: string): Promise<boolean> {
    if (!url.startsWith(this.redirectUri)) return false;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const error = parsed.searchParams.get("error");
    if (error) {
      console.warn(`[RoolAuth] Native auth error: ${error}`);
      this.clearTransientState();
      return false;
    }

    const code = parsed.searchParams.get("code");
    const incomingState = parsed.searchParams.get("state");
    const verifier = this.readString(this.verifierKey);
    const storedState = this.readString(this.stateKey);
    if (!code || !verifier) return false;
    if (storedState && incomingState !== storedState) {
      this.clearTransientState();
      return false;
    }

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

    this.clearTransientState();
    if (!response.ok) return false;

    const data = await readJson<AuthTokenResponse>(response);
    if (!data || !this.acceptTokenResponse(data)) return false;
    this.emitAuthState(true);
    return true;
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<PasswordSignInResult> {
    let response: Response;
    try {
      response = await this.fetchAuth("/login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch (error) {
      console.error("[RoolAuth] Password sign-in failed:", error);
      throw new Error("Network error. Please try again.");
    }

    const data = await readJson<
      AuthTokenResponse & {
        ok?: boolean;
        status?: "signed_in" | "verify_required";
        error?: string;
      }
    >(response);
    if (!data) throw new Error("Unexpected response. Please try again.");
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Invalid email or password.");
    }
    if (data.status === "verify_required") {
      return { status: "verify_required" };
    }
    if (!this.acceptTokenResponse(data)) {
      throw new Error("Sign-in failed. Please try again.");
    }

    this.emitAuthState(true);
    return { status: "signed_in" };
  }

  async requestMagicLink(email: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchAuth("/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch (error) {
      console.error("[RoolAuth] Magic-link request failed:", error);
      throw new Error("Network error. Please try again.");
    }

    const data = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error || "Could not send the sign-in link. Please try again.",
      );
    }
  }

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

  private async startPkce(params?: Record<string, string>): Promise<void> {
    const requestedProvider = params?.provider;
    const provider = isProvider(requestedProvider)
      ? requestedProvider
      : this.defaultProvider;
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
    url.searchParams.set("provider", provider);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (params?.rvid) url.searchParams.set("rvid", params.rvid);
    await this.openExternal(url.toString());
  }
}

function isProvider(value: string | undefined): value is NativeAuthProvider {
  return value === "google" || value === "apple";
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
