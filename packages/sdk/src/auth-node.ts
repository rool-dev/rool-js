
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import open from 'open';
import type { AuthProvider, AuthUser } from './types.js';
import { defaultLogger, type Logger } from './logger.js';

export interface NodeAuthConfig {
    /** Path to store credentials (default: ~/.config/rool/credentials.json) */
    credentialsPath?: string;
    /** Timeout for login flow in ms (default: 5 minutes) */
    loginTimeoutMs?: number;
    onAuthStateChanged?: (authenticated: boolean) => void;
}

interface StoredCredentials {
    access_token: string;
    refresh_token: string | null;
    rool_token: string | null;
    expires_at: number;
}

export class NodeAuthProvider implements AuthProvider {
    private config: NodeAuthConfig;
    private _authUrl: string | null = null;
    private logger: Logger = defaultLogger;

    constructor(config: NodeAuthConfig = {}) {
        this.config = config;
    }

    /** Called by AuthManager to inject the auth URL */
    setAuthUrl(url: string): void {
        this._authUrl = url;
    }

    /** Called by AuthManager to inject the logger */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Get a short hash of the auth URL for scoping credentials by endpoint.
     */
    private get endpointHash(): string {
        if (!this._authUrl) {
            return 'default';
        }
        return crypto.createHash('sha256').update(this._authUrl).digest('hex').slice(0, 8);
    }

    private get credentialsPath(): string {
        if (this.config.credentialsPath) {
            return this.config.credentialsPath;
        }
        const homeDir = os.homedir();
        const configDir = path.join(homeDir, '.config', 'rool');
        // Scope credentials by endpoint to avoid mixing tokens from different environments
        return path.join(configDir, `credentials-${this.endpointHash}.json`);
    }

    /**
     * Get the auth endpoint URL (without trailing slash).
     */
    private get authEndpoint(): string {
        if (!this._authUrl) {
            throw new Error('Auth URL not set. Ensure RoolClient is configured correctly.');
        }
        return this._authUrl.replace(/\/+$/, '');
    }

    initialize(): boolean {
        // For Node.js, initialize just checks if credentials file exists
        // The actual validation happens in isAuthenticated()
        return this.readCredentials() !== null;
    }

    async getTokens(): Promise<{ accessToken: string; roolToken: string } | undefined> {
        const creds = this.readCredentials();
        if (!creds) return undefined;

        // Refresh if expiring in less than 5 minutes
        if (Date.now() >= creds.expires_at - 5 * 60 * 1000) {
            const refreshed = await this.refreshToken(creds);
            if (!refreshed) return undefined;
            const freshCreds = this.readCredentials();
            if (!freshCreds) return undefined;
            return { accessToken: freshCreds.access_token, roolToken: freshCreds.rool_token ?? '' };
        }

        return { accessToken: creds.access_token, roolToken: creds.rool_token ?? '' };
    }

    getAuthUser(): AuthUser {
        const creds = this.readCredentials();
        if (!creds?.access_token) return { email: null, name: null };

        try {
            const payload = JSON.parse(Buffer.from(creds.access_token.split('.')[1], 'base64').toString());
            return {
                email: payload.email || null,
                name: payload.name || null,
            };
        } catch {
            return { email: null, name: null };
        }
    }

    async isAuthenticated(): Promise<boolean> {
        const tokens = await this.getTokens();
        return tokens !== undefined;
    }

    async login(appName: string): Promise<void> {
        const { server, closeAll } = await this.startLoopbackServer();
        const port = (server.address() as any).port;
        const redirectUri = `http://localhost:${port}`;

        // Generate code verifier/state if needed, currently just state
        const state = Math.random().toString(36).substring(2);

        // Auth endpoint is the root of the auth service
        const loginUrl = new URL(`${this.authEndpoint}/`);
        loginUrl.searchParams.set('redirect_uri', redirectUri);
        loginUrl.searchParams.set('app_name', appName);
        loginUrl.searchParams.set('state', state);

        this.logger.info(`Opening browser to login to ${appName}:`, loginUrl.toString());
        await open(loginUrl.toString());

        const timeoutMs = this.config.loginTimeoutMs ?? 5 * 60 * 1000; // 5 minutes default

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                closeAll();
                reject(new Error('Login timed out. Please try again.'));
            }, timeoutMs);

            server.on('authenticated', (tokens: any) => {
                clearTimeout(timeout);
                const expiresAt = Date.now() + (tokens.expires_in * 1000);
                this.writeCredentials({
                    access_token: tokens.id_token, // GCIP returns id_token
                    refresh_token: tokens.refresh_token,
                    rool_token: tokens.rool_token ?? null,
                    expires_at: expiresAt
                });
                this.config.onAuthStateChanged?.(true);
                closeAll();
                resolve();
            });

            server.on('error', (err: Error) => {
                clearTimeout(timeout);
                closeAll();
                reject(err);
            });
        });
    }

    logout(): void {
        const filePath = this.credentialsPath;
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        this.config.onAuthStateChanged?.(false);
    }

    private get storagePath(): string {
        const dir = path.dirname(this.credentialsPath);
        // Scope storage by endpoint to match credentials scoping
        return path.join(dir, `storage-${this.endpointHash}.json`);
    }

    /**
     * Get cached storage data from filesystem.
     */
    getStorage(): Record<string, unknown> | null {
        try {
            const filePath = this.storagePath;
            if (!fs.existsSync(filePath)) return null;
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    /**
     * Set cached storage data to filesystem.
     */
    setStorage(data: Record<string, unknown>): void {
        try {
            const filePath = this.storagePath;
            const dir = path.dirname(filePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
        } catch (error) {
            this.logger.error('[RoolClient] Failed to save storage:', error);
        }
    }

    // ===========================================================================
    // Private Helpers
    // ===========================================================================

    private readCredentials(): StoredCredentials | null {
        try {
            const filePath = this.credentialsPath;
            if (!fs.existsSync(filePath)) return null;
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    private writeCredentials(creds: StoredCredentials): void {
        const filePath = this.credentialsPath;
        const dir = path.dirname(filePath);

        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
        } catch (error) {
            this.logger.error('[RoolClient] Failed to save credentials:', error);
        }
    }

    private async refreshToken(creds: StoredCredentials): Promise<string | undefined> {
        if (!creds.refresh_token) return undefined;

        try {
            const response = await fetch(`${this.authEndpoint}/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    refresh_token: creds.refresh_token,
                    rool_token: creds.rool_token,
                }),
            });

            if (!response.ok) {
                // 400/401 typically means invalid/expired refresh token - clear credentials
                if (response.status === 400 || response.status === 401) {
                    this.logger.warn('[RoolClient] Refresh token expired or invalid. Please login again.');
                    this.logout();
                } else {
                    this.logger.warn(`[RoolClient] Refresh failed: ${response.status}`);
                }
                return undefined;
            }

            const data = await response.json();

            const newCreds: StoredCredentials = {
                access_token: data.id_token,
                refresh_token: data.refresh_token || creds.refresh_token,
                rool_token: data.rool_token ?? creds.rool_token,
                expires_at: Date.now() + (Number(data.expires_in) * 1000),
            };

            this.writeCredentials(newCreds);
            return newCreds.access_token;
        } catch (error) {
            this.logger.error('[RoolClient] Refresh failed:', error);
            return undefined;
        }
    }

    private startLoopbackServer(): Promise<{ server: http.Server; closeAll: () => void }> {
        return new Promise((resolve) => {
            const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
                const url = new URL(req.url || '/', `http://localhost`);

                // 1. Serve the capture page if we just have a root request
                if (url.pathname === '/') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
            <html>
            <body>
              <h1>Authenticating...</h1>
              <script>
                // Extract hash and post to /callback
                if (window.location.hash) {
                  const hash = window.location.hash.substring(1);
                  fetch('/callback', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: hash
                  })
                  .then(() => document.body.innerHTML = '<h1>Login Successful. You can close this window.</h1>')
                  .catch(err => document.body.innerHTML = '<h1>Error: ' + err.message + '</h1>');
                }
              </script>
            </body>
            </html>
          `);
                    return;
                }

                // 2. Handle the callback POST
                if (url.pathname === '/callback' && req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk: Buffer) => body += chunk.toString());
                    req.on('end', () => {
                        const params = new URLSearchParams(body);
                        const idToken = params.get('id_token');
                        const refreshToken = params.get('refresh_token');
                        const roolToken = params.get('rool_token');
                        const expiresIn = params.get('expires_in');

                        if (idToken && expiresIn) {
                            res.writeHead(200);
                            res.end('OK');
                            server.emit('authenticated', {
                                id_token: idToken,
                                refresh_token: refreshToken,
                                rool_token: roolToken,
                                expires_in: Number(expiresIn)
                            });
                        } else {
                            res.writeHead(400);
                            res.end('Invalid tokens');
                        }
                    });
                    return;
                }

                res.writeHead(404);
                res.end();
            });

            // Listen on random port
            server.listen(0, '127.0.0.1', () => resolve({
                server,
                closeAll: () => {
                    server.close();
                    server.closeAllConnections();
                },
            }));
        });
    }
}
