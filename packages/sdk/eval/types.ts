import type { RoolSpace } from '../src/space.js';

/**
 * A test case for evaluating rool-server AI behavior.
 */
export interface TestCase {
  /** Human-readable description of what this test validates */
  description: string;

  /**
   * Run the test against a fresh space.
   * Use vitest's expect() for assertions - thrown errors indicate failure.
   */
  run: (space: RoolSpace) => Promise<void>;
}

/**
 * Result of running a single test case iteration.
 */
export interface TestResult {
  passed: boolean;
  error?: Error;
  durationMs: number;
  spaceId: string;
}

/**
 * Aggregated results for a test case across multiple runs.
 */
export interface TestCaseResults {
  caseName: string;
  description: string;
  runs: TestResult[];
  passCount: number;
  failCount: number;
  passRate: number;
  minDurationMs: number;
  maxDurationMs: number;
  medianDurationMs: number;
}

/**
 * Runner configuration.
 */
export interface RunnerConfig {
  /** Target server URL (default: https://api.dev.rool.dev) */
  targetUrl?: string;
  /** Auth server URL (default: https://api.dev.rool.dev) */
  authUrl?: string;
  /** Number of times to run each case (default: 1) */
  runs?: number;
  /** Number of parallel workers (default: 10) */
  workers?: number;
  /** Delete spaces after successful runs (default: true) */
  cleanupOnSuccess?: boolean;
  /** Prefix for space names (default: 'EVAL:') */
  spaceNamePrefix?: string;
}
