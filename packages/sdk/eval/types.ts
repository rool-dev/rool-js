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

export type Environment = 'local' | 'dev' | 'prod';

/**
 * Runner configuration.
 */
export interface RunnerConfig {
  /** Target environment (default: local) */
  env?: Environment;
  /** Number of times to run each case (default: 1) */
  runs?: number;
  /** Number of parallel workers (default: 25) */
  workers?: number;
}
