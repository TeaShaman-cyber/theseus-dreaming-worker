#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) {
  console.error('usage: node tools/agent/sync-pilot1.mjs --check|--apply');
  process.exit(2);
}

const config = JSON.parse(
  readFileSync('config/agents/dreaming-worker-pilot1.json', 'utf8'),
);
const baseUrl = (process.env.MASTRA_API_URL ?? 'http://127.0.0.1:8001/api').replace(/\/$/, '');
const agentUrl = `${baseUrl}/stored/agents/${encodeURIComponent(config.id)}`;

async function readJson(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Mastra HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeCurrent(value, desired) {
  if (desired === null) return value ?? null;
  if (Array.isArray(desired)) return Array.isArray(value) ? value : [];
  if (desired && typeof desired === 'object') {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(
      Object.entries(desired).map(([key, child]) => [
        key,
        normalizeCurrent(source[key], child),
      ]),
    );
  }
  return value;
}

const current = await readJson(await fetch(agentUrl));
const observed = normalizeCurrent(current, config.desired);
const desiredJson = JSON.stringify(config.desired, null, 2);
const observedJson = JSON.stringify(observed, null, 2);

if (mode === '--check') {
  if (desiredJson !== observedJson) {
    console.error('PILOT1_CONFIG_DRIFT');
    console.error('--- desired ---');
    console.error(desiredJson);
    console.error('--- observed controlled fields ---');
    console.error(observedJson);
    process.exit(1);
  }
  console.log('PILOT1_CONFIG_IN_SYNC');
  process.exit(0);
}

const payload = {
  ...config.desired,
  ...config.apply,
};
const updated = await readJson(
  await fetch(agentUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
);

console.log(
  JSON.stringify(
    {
      status: 'PILOT1_CONFIG_APPLIED',
      id: updated.id,
      activeVersionId: updated.activeVersionId,
      agentStatus: updated.status,
    },
    null,
    2,
  ),
);
