import { TokenAuth, type TokenAuthConfig } from "./auth-base.js";

export type BrowserAuthConfig = TokenAuthConfig;

export class BrowserAuth extends TokenAuth {
  async initialize(): Promise<boolean> {
    this.processCallback();
    return this.isAuthenticated();
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
    // Website-first login has no SDK state: the user need not visit the app
    // before authenticating. A callback carrying state must match its attempt.
    if (incomingState !== null && incomingState !== storedState) {
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

  protected async startLogin(
    flow: "login" | "signup", appName: string, params?: Record<string, string>, emailToken?: string,
  ): Promise<void> {
    const callback = new URL(window.location.origin + window.location.pathname + window.location.search);
    callback.searchParams.delete("verify");
    const state = randomState();
    this.storeState(state);
    const target = { ...params, redirect_uri: callback.toString(), state, app_name: appName };
    try {
      const url = emailToken !== undefined
        ? await this.emailLoginUrl(emailToken, target)
        : `${new URL(`/${flow}`, new URL(this.authBaseUrl).origin)}?${new URLSearchParams(target)}`;
      // A newer attempt or logout can win while the handoff POST is in flight.
      if (this.readState() !== state) return;
      window.location.href = url;
    } catch (error) {
      if (this.readState() === state) this.clearState();
      throw error;
    }
  }

  protected clearTransientState(): void {
    this.clearState();
  }

  private get stateKey(): string {
    return this.keyFor("auth_state");
  }

  private storeState(value: string): void {
    // A callback cannot be verified without this state. Fail before leaving.
    sessionStorage.setItem(this.stateKey, value);
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
