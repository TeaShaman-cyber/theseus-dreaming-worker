#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runSerializerCandidateSuite } from '../../src/dreaming/serializer-candidate-suite.ts';
import { createLocalLlamaSerializerExecutor } from '../../src/dreaming/serializer-llama-server.ts';

const [corpusPath, configPath] = process.argv.slice(2);
if (!corpusPath || !configPath) {
  console.error('usage: node tools/agent/run-local-serializer.mjs <candidate-corpus.json> <local-config.json>');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(resolve(corpusPath), 'utf8'));
const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
if (config.schema !== 'theseus.dreaming-worker.local-serializer-config.v1') {
  throw new Error('LOCAL_SERIALIZER_CONFIG_INVALID');
}

function optionalObservedMetric(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('LOCAL_SERIALIZER_RUNTIME_METRIC_INVALID: ' + name);
  }
  return value;
}

const runtimeMeasurement = {
  coldStartMs: optionalObservedMetric('SERIALIZER_COLD_START_MS'),
  peakRssBytes: optionalObservedMetric('SERIALIZER_PEAK_RSS_BYTES'),
};

const executor = createLocalLlamaSerializerExecutor({
  baseURL: config.runtime.baseURL,
  timeoutMs: config.runtime.timeoutMs,
  maxOutputTokens: config.runtime.maxOutputTokens,
  ...runtimeMeasurement,
});

const result = await runSerializerCandidateSuite(
  corpus,
  config.candidate,
  executor,
  { repeat: config.repeat },
);

process.stdout.write(JSON.stringify({
  schema: 'theseus.dreaming-worker.local-serializer-benchmark.v1',
  configIdentity: {
    schema: config.schema,
    runtime: config.runtime,
    artifacts: config.artifacts,
  },
  runtimeMeasurement: {
    coldStartMs: runtimeMeasurement.coldStartMs ?? null,
    peakRssBytes: runtimeMeasurement.peakRssBytes ?? null,
  },
  result,
}, null, 2) + '\n');
