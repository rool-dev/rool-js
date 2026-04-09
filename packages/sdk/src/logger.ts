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

/** Default logger — surfaces info and above via console. */
export const defaultLogger: Logger = {
  debug() {},
  info(message, ...args) {
    console.info(message, ...args);
  },
  warn(message, ...args) {
    console.warn(message, ...args);
  },
  error(message, ...args) {
    console.error(message, ...args);
  },
};
