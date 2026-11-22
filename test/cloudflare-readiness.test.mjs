import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeCloudflareReadiness } from '../tools/dev/cloudflare-readiness.mjs';

const secret = value => ({ type: 'secret', value });
const text = value => ({ type: 'text', value });
const hyperdrive = id => ({ type: 'hyperdrive', id });

function workerConfig(overrides = {}) {
  return {
    name: 'theseus-dreaming-worker-issue23',
    compatibilityDate: '2026-11-22',
    env: {
      HYPERDRIVE: hyperdrive('00000000-0000-0000-0000-000000000023'),
      MODEL_BASE_URL: text('https://unconfigured.invalid/v1'),
      MODEL_API_KEY: secret('model-secret-never-print'),
      OTEL_EXPORTER_OTLP_ENDPOINT: text(''),
      OTEL_EXPORTER_OTLP_PROTOCOL: text('http/protobuf'),
      OTEL_EXPORTER_OTLP_HEADERS: secret('otel-secret-never-print'),
      LANGFUSE_BASE_URL: text('https://cloud.langfuse.com'),
      LANGFUSE_PUBLIC_KEY: secret('pk-never-print'),
      LANGFUSE_SECRET_KEY: secret('sk-never-print'),
      THESEUS_ENVIRONMENT: text('production'),
      THESEUS_RELEASE: text('UNCONFIGURED'),
      ...overrides,
    },
  };
}

test('readiness reports build-ready but not deploy-ready for placeholder resources', () => {
  const result = summarizeCloudflareReadiness(workerConfig());

  assert.equal(result.overall, 'BUILD_READY');
  assert.deepEqual(result.unconfigured, [
    'CLOUDFLARE_HYPERDRIVE_ID',
    'MODEL_BASE_URL',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'THESEUS_RELEASE',
  ]);
  assert.equal(result.secretBindings.status, 'DECLARED_VALUES_UNVERIFIED');
  assert.equal(result.releaseBoundary, 'EXPLICIT_AUTHORIZATION_REQUIRED');
});

test('readiness reaches deploy-config-ready only with real resource text config and declared secret bindings', () => {
  const result = summarizeCloudflareReadiness(workerConfig({
    HYPERDRIVE: hyperdrive('3ad2e3dd-80c3-4d8c-912f-ccb962a29c8e'),
    MODEL_BASE_URL: text('https://models.example.invalid/v1'),
    OTEL_EXPORTER_OTLP_ENDPOINT: text('https://otel.example.invalid/otlp'),
    THESEUS_RELEASE: text('0123456789abcdef'),
  }));

  assert.equal(result.overall, 'DEPLOY_CONFIG_READY');
  assert.deepEqual(result.unconfigured, []);
  assert.equal(result.storage.schema, 'dw_issue23');
  assert.equal(result.storage.runtimeDdl, 'DISABLED');
});

test('readiness fails closed when a required secret binding is absent', () => {
  const config = workerConfig();
  delete config.env.MODEL_API_KEY;
  const result = summarizeCloudflareReadiness(config);

  assert.equal(result.overall, 'INVALID');
  assert.deepEqual(result.secretBindings.missing, ['MODEL_API_KEY']);
});

test('readiness never discloses binding values or resource ids', () => {
  const config = workerConfig({
    HYPERDRIVE: hyperdrive('secret-hyperdrive-id'),
    MODEL_BASE_URL: text('https://secret-model.example/v1'),
    OTEL_EXPORTER_OTLP_ENDPOINT: text('https://secret-otel.example/otlp'),
    THESEUS_RELEASE: text('secret-release-sha'),
  });
  const result = summarizeCloudflareReadiness(config);
  const serialized = JSON.stringify(result);

  for (const forbidden of [
    'secret-hyperdrive-id',
    'https://secret-model.example/v1',
    'https://secret-otel.example/otlp',
    'secret-release-sha',
    'model-secret-never-print',
    'otel-secret-never-print',
    'pk-never-print',
    'sk-never-print',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must not disclose ${forbidden}`);
  }
});
