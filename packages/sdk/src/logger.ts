// =============================================================================
// Logger
// =============================================================================

/**
 * Logger interface accepted by RoolClient.
 * Compatible with `console` — pass `{ logger: console }` for quick debugging.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Default logger — only surfaces errors via console.error. */
export const defaultLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error(message, ...args) {
    console.error(message, ...args);
  },
};
