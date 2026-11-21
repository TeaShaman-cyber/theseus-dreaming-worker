#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runPilot0 } from '../src/dreaming/dry-run.ts';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: npm run pilot0 -- <evidence-packet.json>');
  process.exit(2);
}

const packet = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const result = runPilot0(packet);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
