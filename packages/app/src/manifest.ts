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

export interface AppManifest {
  id: string;
  name: string;
  description?: string;
  systemInstruction?: string | null;
  collections?: ManifestCollections;
  [key: string]: unknown;
}

export interface ManifestResult {
  manifest: AppManifest | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

export type Environment = 'dev' | 'prod';

export interface EnvironmentConfig {
  baseUrl: string;
  authUrl: string;
  label: string;
  appsDomain: string;
}

export const ENV_URLS: Record<Environment, EnvironmentConfig> = {
  dev: { baseUrl: 'https://api.dev.rool.dev', authUrl: 'https://api.dev.rool.dev/auth', label: 'api.dev.rool.dev', appsDomain: 'dev.rool.app' },
  prod: { baseUrl: 'https://api.rool.dev', authUrl: 'https://api.rool.dev/auth', label: 'api.rool.dev', appsDomain: 'rool.app' },
};
