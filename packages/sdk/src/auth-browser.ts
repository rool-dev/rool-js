import { TokenAuth, type TokenAuthConfig } from "./auth-base.js";

export type BrowserAuthConfig = TokenAuthConfig;

export class BrowserAuth extends TokenAuth {
  async initialize(): Promise<boolean> {
    this.processCallback();
    return this.isAuthenticated();
  }

  async login(appName: string, params?: Record<string, string>): Promise<void> {
    this.redirectToAuth("login", appName, params);
  }

  async signup(
    appName: string,
    params?: Record<string, string>,
  ): Promise<void> {
    this.redirectToAuth("signup", appName, params);
  }

  private processCallback(): boolean {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const idToken = params.get("id_token");
    if (!idToken) return false;

    const incomingState = params.get("state");
    const storedState = this.readState();
    if (storedState && incomingState && incomingState !== storedState) {
      console.error("[RoolAuth] Browser auth state mismatch");
      return false;
    }

    const accepted = this.acceptTokenResponse({
      id_token: idToken,
      refresh_token: params.get("refresh_token"),
      rool_token: params.get("rool_token"),
      expires_in: params.get("expires_in"),
    });
    if (!accepted) return false;

    this.clearState();
    const cleanUrl =
      window.location.origin +
      window.location.pathname +
      window.location.search;
    window.history.replaceState({}, document.title, cleanUrl);
    this.emitAuthState(true);
    return true;
  }

  private redirectToAuth(
    flow: "login" | "signup",
    appName: string,
    params?: Record<string, string>,
  ): void {
    const url = new URL(`/${flow}`, new URL(this.authBaseUrl).origin);
    url.searchParams.set(
      "redirect_uri",
      window.location.origin +
        window.location.pathname +
        window.location.search,
    );
    url.searchParams.set("app_name", appName);
    for (const [name, value] of Object.entries(params ?? {})) {
      url.searchParams.set(name, value);
    }

    const state = randomState();
    this.storeState(state);
    url.searchParams.set("state", state);
    window.location.href = url.toString();
  }

  protected clearTransientState(): void {
    this.clearState();
  }

  private get stateKey(): string {
    return this.keyFor("auth_state");
  }

  private storeState(value: string): void {
    try {
      sessionStorage.setItem(this.stateKey, value);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }

  private readState(): string | null {
    try {
      return sessionStorage.getItem(this.stateKey);
    } catch {
      return null;
    }
  }

  private clearState(): void {
    try {
      sessionStorage.removeItem(this.stateKey);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
