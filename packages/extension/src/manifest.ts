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
  public: boolean;
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
  domain: string;
  /** Override API origin for local dev (e.g. 'http://localhost:1357') */
  baseUrl?: string;
  label: string;
  appsDomain: string;
}

export const ENV_URLS: Record<Environment, EnvironmentConfig> = {
  local: { domain: 'dev.rool.dev', baseUrl: 'http://localhost:1357', label: 'localhost:1357', appsDomain: 'dev.rool.app' },
  dev: { domain: 'dev.rool.dev', label: 'api.dev.rool.dev', appsDomain: 'dev.rool.app' },
  prod: { domain: 'rool.dev', label: 'api.rool.dev', appsDomain: 'rool.app' },
};
