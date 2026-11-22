import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOUDFLARE_STORAGE_SCHEMA,
  buildCloudflareRuntimePlan,
} from '../src/runtime/cloudflare-runtime.ts';

const pilotConfig = {
  id: 'dreaming-worker-pilot1',
  desired: {
    model: { provider: 'exe/nvidia', name: 'minimaxai/minimax-m3.1-flash' },
  },
};

const goodBindings = {
  HYPERDRIVE: { connectionString: 'postgresql://runtime:secret@example.invalid/db' },
  MODEL_BASE_URL: 'https://models.example.invalid/v1',
  MODEL_API_KEY: 'model-secret',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.invalid/otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer%20placeholder',
  LANGFUSE_BASE_URL: 'https://langfuse.example.invalid',
  LANGFUSE_PUBLIC_KEY: 'pk-placeholder',
  LANGFUSE_SECRET_KEY: 'sk-placeholder',
  THESEUS_ENVIRONMENT: 'production',
  THESEUS_RELEASE: 'deadbeef',
};

test('Cloudflare production plan uses issue-owned Postgres schema with runtime DDL disabled', () => {
  const plan = buildCloudflareRuntimePlan(goodBindings, pilotConfig);

  assert.equal(CLOUDFLARE_STORAGE_SCHEMA, 'dw_issue23');
  assert.deepEqual(plan.storage, {
    id: 'dreaming-worker-production',
    connectionString: goodBindings.HYPERDRIVE.connectionString,
    schemaName: CLOUDFLARE_STORAGE_SCHEMA,
    disableInit: true,
  });
});

test('Cloudflare production plan injects provider transport instead of exe.dev gateway authority', () => {
  const plan = buildCloudflareRuntimePlan(goodBindings, pilotConfig);

  assert.deepEqual(plan.model, {
    baseURL: goodBindings.MODEL_BASE_URL,
    apiKey: goodBindings.MODEL_API_KEY,
    modelName: pilotConfig.desired.model.name,
  });
  assert.equal('provider' in plan.model, false);
  assert.equal('NEON_API_KEY' in plan, false);
});

test('Cloudflare production plan preserves only application observability bindings', () => {
  const plan = buildCloudflareRuntimePlan(goodBindings, pilotConfig);

  assert.equal(plan.observabilityEnv.OTEL_EXPORTER_OTLP_ENDPOINT, goodBindings.OTEL_EXPORTER_OTLP_ENDPOINT);
  assert.equal(plan.observabilityEnv.LANGFUSE_SECRET_KEY, goodBindings.LANGFUSE_SECRET_KEY);
  assert.equal(plan.observabilityEnv.THESEUS_ENVIRONMENT, 'production');
  assert.equal(plan.observabilityEnv.THESEUS_RELEASE, 'deadbeef');
  assert.equal('HYPERDRIVE' in plan.observabilityEnv, false);
  assert.equal('NEON_API_KEY' in plan.observabilityEnv, false);
});

test('Cloudflare production plan fails closed without Hyperdrive runtime connection', () => {
  const changed = structuredClone(goodBindings);
  delete changed.HYPERDRIVE;
  assert.throws(
    () => buildCloudflareRuntimePlan(changed, pilotConfig),
    /CLOUDFLARE_RUNTIME_INVALID: HYPERDRIVE\.connectionString is required/,
  );
});

test('Cloudflare production plan fails closed without model transport secret', () => {
  const changed = structuredClone(goodBindings);
  delete changed.MODEL_API_KEY;
  assert.throws(
    () => buildCloudflareRuntimePlan(changed, pilotConfig),
    /CLOUDFLARE_RUNTIME_INVALID: MODEL_API_KEY is required/,
  );
});
