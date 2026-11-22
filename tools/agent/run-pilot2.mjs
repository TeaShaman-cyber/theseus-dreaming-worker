#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { buildPilot2Routes } from '../../src/dreaming/pilot2-e2e.ts';
import { runPilot2 } from '../../src/dreaming/pilot2-runner.ts';

const [requestPath, routesPath] = process.argv.slice(2);
if (!requestPath || !routesPath) {
  console.error('usage: node tools/agent/run-pilot2.mjs <pilot2-request.json> <routes.json>');
  process.exit(2);
}

const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const config = JSON.parse(readFileSync(routesPath, 'utf8'));
const providerEvidence = [];
const routes = buildPilot2Routes(config, {
  env: process.env,
  onEvidence: evidence => providerEvidence.push(evidence),
});

const result = await runPilot2(request, routes);

console.log(JSON.stringify({
  schema: 'theseus.dreaming-worker.pilot2-e2e.v1',
  result,
  providerEvidence,
}, null, 2));
