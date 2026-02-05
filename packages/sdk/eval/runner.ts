import { RoolClient } from '../src/client.js';
import { NodeAuthProvider } from '../src/auth-node.js';
import type { TestCase, TestResult, TestCaseResults, RunnerConfig } from './types.js';

const DEFAULT_AUTH_URL = 'https://api.dev.rool.dev/auth';
const DEFAULT_TARGET_URL = 'http://localhost:1357';

interface QueuedTask {
  caseName: string;
  testCase: TestCase;
  runIndex: number;
}

/**
 * Minimal evaluation runner for SDK test cases.
 */
export class EvalRunner {
  private config: Required<RunnerConfig>;
  private client: RoolClient | null = null;

  constructor(config: RunnerConfig = {}) {
    this.config = {
      targetUrl: config.targetUrl ?? process.env.ROOL_TARGET_URL ?? DEFAULT_TARGET_URL,
      authUrl: config.authUrl ?? DEFAULT_AUTH_URL,
      runs: config.runs ?? 1,
      workers: config.workers ?? 10,
    };
  }

  /**
   * Initialize the client and authenticate.
   */
  async initialize(): Promise<void> {
    this.client = new RoolClient({
      baseUrl: this.config.targetUrl,
      authUrl: this.config.authUrl,
      authProvider: new NodeAuthProvider(),
    });

    if (!this.client.isAuthenticated()) {
      console.log('Not authenticated. Opening browser for login...');
      await this.client.login("Eval Agent");
    }

    const user = this.client.getAuthUser();
    console.log(`Authenticated as: ${user.email}`);
    console.log(`Target: ${this.config.targetUrl}`);
  }

  /**
   * Clear all spaces whose names start with the given prefix.
   */
  async clearSpaces(prefix: string): Promise<number> {
    if (!this.client) {
      throw new Error('Runner not initialized. Call initialize() first.');
    }

    const allSpaces = await this.client.listSpaces();
    const matching = allSpaces.filter(s => s.name.startsWith(prefix));

    if (matching.length > 0) {
      await Promise.all(matching.map(s => this.client!.deleteSpace(s.id)));
    }

    return matching.length;
  }

  /**
   * Run a single test case once.
   */
  private async runOnce(caseName: string, testCase: TestCase, _runIndex: number): Promise<TestResult> {
    if (!this.client) {
      throw new Error('Runner not initialized. Call initialize() first.');
    }

    const startTime = Date.now();

    try {
      // Run the test - it handles its own space creation/cleanup
      await testCase.run(this.client);

      return {
        passed: true,
        durationMs: Date.now() - startTime,
        spaceId: 'n/a',
      };
    } catch (error) {
      return {
        passed: false,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        spaceId: 'n/a',
      };
    }
  }

  /**
   * Run multiple test cases with parallel workers.
   */
  async run(cases: Record<string, TestCase>): Promise<TestCaseResults[]> {
    if (!this.client) {
      throw new Error('Runner not initialized. Call initialize() first.');
    }

    const caseNames = Object.keys(cases);
    console.log(`\nRunning ${caseNames.length} case(s), ${this.config.runs} run(s) each, ${this.config.workers} workers\n`);

    // Build task queue
    const tasks: QueuedTask[] = [];
    for (const caseName of caseNames) {
      for (let i = 0; i < this.config.runs; i++) {
        tasks.push({ caseName, testCase: cases[caseName], runIndex: i });
      }
    }

    // Results storage
    const resultsByCase = new Map<string, TestResult[]>();
    for (const caseName of caseNames) {
      resultsByCase.set(caseName, []);
    }

    // Progress tracking
    let completed = 0;
    const total = tasks.length;

    // Worker function
    const worker = async () => {
      while (tasks.length > 0) {
        const task = tasks.shift();
        if (!task) break;

        const result = await this.runOnce(task.caseName, task.testCase, task.runIndex);
        resultsByCase.get(task.caseName)!.push(result);

        completed++;
        const status = result.passed ? '✓' : '✗';
        process.stdout.write(`\r\x1b[K[${completed}/${total}] ${status} ${task.caseName} #${task.runIndex + 1}`);
      }
    };

    // Start workers
    const workers = Array.from({ length: this.config.workers }, () => worker());
    await Promise.all(workers);

    console.log('\n');

    // Aggregate results
    const results: TestCaseResults[] = [];
    for (const caseName of caseNames) {
      const runs = resultsByCase.get(caseName)!;
      const passCount = runs.filter(r => r.passed).length;
      const durations = runs.map(r => r.durationMs).sort((a, b) => a - b);

      results.push({
        caseName,
        description: cases[caseName].description,
        runs,
        passCount,
        failCount: runs.length - passCount,
        passRate: passCount / runs.length,
        minDurationMs: durations[0],
        maxDurationMs: durations[durations.length - 1],
        medianDurationMs: durations[Math.floor(durations.length / 2)],
      });
    }

    return results;
  }

  /**
   * Print results summary to console.
   */
  printResults(results: TestCaseResults[]): void {
    console.log('Results:\n');

    // Find max case name length for alignment
    const maxNameLen = Math.max(...results.map(r => r.caseName.length));

    for (const result of results) {
      const status = result.passRate === 1 ? '✓' : result.passRate === 0 ? '✗' : '~';
      const name = result.caseName.padEnd(maxNameLen);
      const minSec = (result.minDurationMs / 1000).toFixed(2);
      const medSec = (result.medianDurationMs / 1000).toFixed(2);
      const maxSec = (result.maxDurationMs / 1000).toFixed(2);

      // Right-align the time values
      const timeStr = `[${minSec.padStart(6)}s / ${medSec.padStart(6)}s / ${maxSec.padStart(6)}s]`;

      console.log(`${status} ${name}  ${timeStr}`);

      // Show errors for failed runs
      for (const run of result.runs) {
        if (!run.passed && run.error) {
          console.log(`    ✗ ${run.error.message}`);
        }
      }
    }

    // Overall summary
    const totalRuns = results.reduce((sum, r) => sum + r.runs.length, 0);
    const totalPassed = results.reduce((sum, r) => sum + r.passCount, 0);
    console.log(`\nTotal: ${totalPassed}/${totalRuns} passed`);
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}
