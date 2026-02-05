import type { RoolClient } from '../src/client.js';

/**
 * A test case for evaluating rool-server AI behavior.
 */
export interface TestCase {
  /** Human-readable description of what this test validates */
  description: string;

  /**
   * Run the test with access to an authenticated client.
   * Tests are responsible for creating/importing their own spaces.
   * Use chai's expect() for assertions - thrown errors indicate failure.
   */
  run: (client: RoolClient) => Promise<void>;
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
  /** Target server URL (default: http://localhost:1357) */
  targetUrl?: string;
  /** Auth server URL (default: https://api.dev.rool.dev) */
  authUrl?: string;
  /** Number of times to run each case (default: 1) */
  runs?: number;
  /** Number of parallel workers (default: 10) */
  workers?: number;
}
