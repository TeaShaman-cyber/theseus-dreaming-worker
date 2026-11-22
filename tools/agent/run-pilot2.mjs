#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runPilot2WithProviders } from '../../src/dreaming/pilot2-live-composition.ts';
import { resolvePilot2RouteSecrets } from './pilot2-route-config.mjs';

const [requestPath, routesPath] = process.argv.slice(2);
if (!requestPath || !routesPath) {
  console.error('usage: node tools/agent/run-pilot2.mjs <pilot2-request.json> <routes.json>');
  process.exit(2);
}

const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
const config = JSON.parse(readFileSync(resolve(routesPath), 'utf8'));
const providerEvidence = [];
const routes = resolvePilot2RouteSecrets(config, process.env);

const result = await runPilot2WithProviders(
  request,
  routes,
  record => providerEvidence.push(record),
);

process.stdout.write(JSON.stringify({
  schema: 'theseus.dreaming-worker.pilot2-e2e.v1',
  result,
  providerEvidence,
}, null, 2) + '\n');
