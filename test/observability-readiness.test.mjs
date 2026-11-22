import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeObservabilityReadiness } from '../tools/dev/observability-readiness.mjs';

test('readiness reports local-only state when no external config is present', () => {
  const result = summarizeObservabilityReadiness({});

  assert.equal(result.serviceName, 'theseus-dreaming-builder');
  assert.equal(result.grafana.status, 'UNCONFIGURED');
  assert.equal(result.langfuse.status, 'UNCONFIGURED');
  assert.equal(result.overall, 'LOCAL_ONLY');
});

test('readiness reports configured backends without disclosing any configuration values', () => {
  const env = {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://secret-otel.example.test/otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer%20SECRET-GRAFANA-TOKEN',
    LANGFUSE_PUBLIC_KEY: 'pk-secret-public',
    LANGFUSE_SECRET_KEY: 'sk-secret-private',
    LANGFUSE_BASE_URL: 'https://secret-langfuse.example.test',
    THESEUS_ENVIRONMENT: 'synthetic-test',
    THESEUS_RELEASE: 'sha-secret-release',
  };

  const result = summarizeObservabilityReadiness(env);
  const serialized = JSON.stringify(result);

  assert.equal(result.grafana.status, 'CONFIGURED');
  assert.equal(result.langfuse.status, 'CONFIGURED');
  assert.equal(result.overall, 'EXTERNAL_READY');
  assert.deepEqual(result.grafana.present, [
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_PROTOCOL',
    'OTEL_EXPORTER_OTLP_HEADERS',
  ]);
  assert.deepEqual(result.langfuse.present, [
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
    'LANGFUSE_BASE_URL',
  ]);

  for (const secret of Object.values(env)) {
    assert.equal(serialized.includes(secret), false, `must not disclose ${secret}`);
  }
});

test('readiness distinguishes partial Langfuse and ineffective partial Grafana config', () => {
  const result = summarizeObservabilityReadiness({
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=secret',
    LANGFUSE_PUBLIC_KEY: 'pk-only',
  });

  assert.equal(result.grafana.status, 'PARTIAL');
  assert.equal(result.langfuse.status, 'PARTIAL');
  assert.equal(result.overall, 'PARTIAL');
});

test('invalid Grafana protocol is reported without echoing the invalid value', () => {
  const result = summarizeObservabilityReadiness({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.test',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc-secret-ish-value',
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.grafana.status, 'INVALID');
  assert.equal(result.overall, 'INVALID');
  assert.equal(serialized.includes('grpc-secret-ish-value'), false);
});
