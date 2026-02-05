#!/usr/bin/env node

import { EvalRunner } from './runner.js';
import type { TestCase } from './types.js';

// Import test cases
import { testCase as haikuPrompt } from './cases/haiku-prompt.js';
import { testCase as cheeseImages } from './cases/cheese-images.js';
import { testCase as exoplanets } from './cases/exoplanets.js';
import { testCase as findVideo } from './cases/find-video.js';
import { testCase as newsBrowsers } from './cases/news-browsers.js';
import { testCase as poemNumber } from './cases/poem-number.js';
import { testCase as importExportArchive } from './cases/import-export-archive.js';
import { testCase as electricalShorten } from './cases/electrical-shorten.js';
import { testCase as topicEmoji } from './cases/topic-emoji.js';
import { testCase as topicExpand } from './cases/topic-expand.js';
import { testCase as sailingSplit } from './cases/sailing-split.js';
import { testCase as findCircuitProtection } from './cases/find-circuit-protection.js';
import { testCase as findImages } from './cases/find-images.js';
import { testCase as companyLookup } from './cases/company-lookup.js';
import { testCase as mathTest } from './cases/math-test.js';

// Register all test cases
const cases: Record<string, TestCase> = {
  'haiku-prompt': haikuPrompt,
  'cheese-images': cheeseImages,
  'exoplanets': exoplanets,
  'find-video': findVideo,
  'news-browsers': newsBrowsers,
  'poem-number': poemNumber,
  'import-export-archive': importExportArchive,
  'electrical-shorten': electricalShorten,
  'topic-emoji': topicEmoji,
  'topic-expand': topicExpand,
  'sailing-split': sailingSplit,
  'find-circuit-protection': findCircuitProtection,
  'find-images': findImages,
  'company-lookup': companyLookup,
  'math-test': mathTest,
};

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config: {
    runs: number;
    workers: number;
    include: string[];
    targetUrl?: string;
    clear?: string;
    clearOnly?: string;
  } = {
    runs: 1,
    workers: 25,
    include: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--runs':
        config.runs = parseInt(args[++i], 10);
        break;
      case '--workers':
        config.workers = parseInt(args[++i], 25);
        break;
      case '--include':
        config.include.push(args[++i]);
        break;
      case '--target':
        config.targetUrl = args[++i];
        break;
      case '--clear':
        config.clear = args[++i];
        break;
      case '--clear-only':
        config.clearOnly = args[++i];
        break;
      case '--list':
        console.log('Available cases:');
        for (const [name, testCase] of Object.entries(cases)) {
          console.log(`  ${name}: ${testCase.description}`);
        }
        process.exit(0);
        break;
      case '--help':
        console.log(`
Usage: eval [options]

Options:
  --runs <n>         Number of times to run each case (default: 1)
  --workers <n>      Number of parallel workers (default: 25)
  --include <pat>    Only run cases matching pattern (can be repeated)
  --target <url>     Target server URL (default: ROOL_TARGET_URL or http://localhost:1357)
  --clear <prefix>   Clear spaces starting with prefix before running
  --clear-only <prefix>  Clear spaces starting with prefix and exit
  --list             List available cases and exit
  --help             Show this help
`);
        process.exit(0);
    }
  }

  return config;
}

async function main() {
  const args = parseArgs();

  // Filter cases if --include specified
  let selectedCases = cases;
  if (args.include.length > 0) {
    selectedCases = {};
    for (const [name, testCase] of Object.entries(cases)) {
      if (args.include.some(pat => name.includes(pat))) {
        selectedCases[name] = testCase;
      }
    }
  }

  if (Object.keys(selectedCases).length === 0) {
    console.error('No cases selected');
    process.exit(1);
  }

  const runner = new EvalRunner({
    runs: args.runs,
    workers: args.workers,
    targetUrl: args.targetUrl,
  });

  try {
    await runner.initialize();

    // Handle --clear and --clear-only
    const clearPrefix = args.clearOnly ?? args.clear;
    if (clearPrefix) {
      const cleared = await runner.clearSpaces(clearPrefix);
      console.log(`Cleared ${cleared} space(s) with prefix "${clearPrefix}"`);

      if (args.clearOnly) {
        process.exit(0);
      }
    }

    const results = await runner.run(selectedCases);
    runner.printResults(results);

    // Exit with error if any tests failed
    const allPassed = results.every(r => r.passRate === 1);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    runner.destroy();
  }
}

main();
