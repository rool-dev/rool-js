#!/usr/bin/env node
import { createProgram } from './program.js';

const program = createProgram();

program.parseAsync().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
