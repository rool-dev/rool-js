/**
 * Shared manifest types and environment config.
 *
 * Browser-safe — no Node.js imports. Used by CLI code, the dev host shell,
 * and the publish command.
 */

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface ManifestFieldDef {
  name: string;
  type: Record<string, unknown>;
}

export interface ManifestCollections {
  write?: Record<string, ManifestFieldDef[]> | '*';
  read?: Record<string, ManifestFieldDef[]> | '*';
}

export interface Manifest {
  id: string;
  name: string;
  icon?: string;
  collections: ManifestCollections;
  description?: string;
  systemInstruction?: string | null;
  [key: string]: unknown;
}

export type ManifestResult =
  | { manifest: Manifest; error: null }
  | { manifest: null; error: string };

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

export type Environment = 'local' | 'dev' | 'prod';

export interface EnvironmentConfig {
  apiUrl: string;
  authUrl?: string;
  label: string;
  appsDomain: string;
}

export const ENV_URLS: Record<Environment, EnvironmentConfig> = {
  local: { apiUrl: 'http://localhost:1357', authUrl: 'https://dev.rool.dev/auth', label: 'localhost:1357', appsDomain: 'dev.rool.app' },
  dev: { apiUrl: 'https://api.dev.rool.dev', label: 'api.dev.rool.dev', appsDomain: 'dev.rool.app' },
  prod: { apiUrl: 'https://api.rool.dev', label: 'api.rool.dev', appsDomain: 'rool.app' },
};
