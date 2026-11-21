import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVABILITY_SCOPE_KEY,
  buildExporterPlan,
  operationalSpanFormatter,
  parseOtelHeaders,
  selectObservabilityConfig,
} from '../src/mastra/observability-routing.ts';

function requestContext(values = {}) {
  return {
    get(key) {
      return values[key];
    },
  };
}

test('observability defaults to local-only config', () => {
  assert.equal(selectObservabilityConfig({}), 'local');
  assert.equal(
    selectObservabilityConfig({
      requestContext: requestContext({ [OBSERVABILITY_SCOPE_KEY]: 'private' }),
    }),
    'local',
  );
});

test('only explicit external-safe request context selects external exporters', () => {
  assert.equal(
    selectObservabilityConfig({
      requestContext: requestContext({
        [OBSERVABILITY_SCOPE_KEY]: 'external-safe',
      }),
    }),
    'external-safe',
  );
});

test('missing external configuration keeps both exporters disabled', () => {
  assert.deepEqual(buildExporterPlan({}), {
    otel: null,
    langfuse: null,
  });
});

test('Langfuse requires both keys and remains disabled on partial credentials', () => {
  assert.equal(
    buildExporterPlan({ LANGFUSE_PUBLIC_KEY: 'pk-only' }).langfuse,
    null,
  );

  assert.deepEqual(
    buildExporterPlan({
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://langfuse.example',
    }).langfuse,
    {
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: 'https://langfuse.example',
    },
  );
});

test('Grafana OTLP uses standard OpenTelemetry env and HTTP/protobuf', () => {
  assert.deepEqual(
    buildExporterPlan({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS:
        'Authorization=Basic%20abc123,X-Scope-OrgID=42',
    }).otel,
    {
      endpoint: 'https://otlp.example/otlp',
      protocol: 'http/protobuf',
      headers: {
        Authorization: 'Basic abc123',
        'X-Scope-OrgID': '42',
      },
    },
  );
});

test('OTLP header parser decodes values and preserves equals inside values', () => {
  assert.deepEqual(
    parseOtelHeaders('Authorization=Basic%20abc%3D%3D,foo=bar%2Cbaz'),
    {
      Authorization: 'Basic abc==',
      foo: 'bar,baz',
    },
  );
});

test('Grafana operational formatter removes model input/output but keeps correlation metadata', () => {
  const formatted = operationalSpanFormatter({
    id: 'span-1',
    traceId: 'trace-1',
    type: 'MODEL_GENERATION',
    name: 'model call',
    input: { secret: 'synthetic prompt still not needed in Grafana' },
    output: { text: 'synthetic output still not needed in Grafana' },
    metadata: {
      'theseus.request_fingerprint': 'sha256:req',
      'theseus.phase': 'PILOT_1_SYNTHETIC_INFERENCE',
    },
  });

  assert.equal(formatted.input, undefined);
  assert.equal(formatted.output, undefined);
  assert.equal(formatted.traceId, 'trace-1');
  assert.equal(
    formatted.metadata['theseus.request_fingerprint'],
    'sha256:req',
  );
});
