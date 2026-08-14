const DEFAULT_API_URL = "https://api.rool.dev";

export interface AuthEndpointConfig {
  apiUrl?: string;
  authUrl?: string;
}

export function resolveAuthUrl(config: AuthEndpointConfig = {}): string {
  if (config.authUrl) return normalizeUrl(config.authUrl);

  const api = new URL(config.apiUrl ?? DEFAULT_API_URL);
  const isLoopback =
    api.hostname === "localhost" ||
    api.hostname === "127.0.0.1" ||
    api.hostname === "[::1]";
  if (isLoopback) {
    throw new Error("authUrl is required when apiUrl targets loopback");
  }
  if (api.hostname.startsWith("api.")) {
    api.hostname = api.hostname.slice(4);
  }
  api.pathname = "/auth";
  api.search = "";
  api.hash = "";
  return normalizeUrl(api.toString());
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("authUrl must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "authUrl must not contain credentials, a query, or a fragment",
    );
  }
  return url.toString().replace(/\/+$/, "");
}
