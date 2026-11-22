import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVABILITY_SCOPE_KEY,
  EXTERNAL_SAFE_SCOPE,
  OBSERVABILITY_SERVICE_NAME,
  createObservability,
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

test('observability routing constants are stable API keys', () => {
  assert.equal(OBSERVABILITY_SCOPE_KEY, 'observabilityScope');
  assert.equal(EXTERNAL_SAFE_SCOPE, 'external-safe');
  assert.equal(OBSERVABILITY_SERVICE_NAME, 'theseus-dreaming-builder');
});

test('OTLP parser ignores whitespace-only input and blank comma entries', () => {
  assert.deepEqual(parseOtelHeaders('   '), {});
  assert.deepEqual(
    parseOtelHeaders(' , Authorization = Basic%20abc123 , , foo = bar '),
    {
      Authorization: 'Basic abc123',
      foo: 'bar',
    },
  );
});

test('OTLP parser rejects missing/empty keys and invalid URL encoding', () => {
  for (const raw of ['broken', '=value']) {
    assert.throws(
      () => parseOtelHeaders(raw),
      error =>
        error instanceof Error &&
        error.message.includes('OBSERVABILITY_CONFIG_INVALID') &&
        error.message.includes('malformed OTEL header entry'),
    );
  }

  assert.throws(
    () => parseOtelHeaders('Authorization=%E0%A4%A'),
    error =>
      error instanceof Error &&
      error.message.includes('OBSERVABILITY_CONFIG_INVALID') &&
      error.message.includes('invalid URL encoding') &&
      error.message.includes('Authorization'),
  );
});

test('exporter plan trims env values and rejects unsupported OTLP protocol', () => {
  const plan = buildExporterPlan({
    OTEL_EXPORTER_OTLP_ENDPOINT: '  https://otlp.example/base  ',
    OTEL_EXPORTER_OTLP_PROTOCOL: '  http/protobuf  ',
    LANGFUSE_PUBLIC_KEY: '  pk-test  ',
    LANGFUSE_SECRET_KEY: '  sk-test  ',
    LANGFUSE_BASE_URL: '  https://langfuse.example  ',
  });

  assert.equal(plan.otel.endpoint, 'https://otlp.example/base');
  assert.equal(plan.otel.protocol, 'http/protobuf');
  assert.equal(plan.langfuse.publicKey, 'pk-test');
  assert.equal(plan.langfuse.secretKey, 'sk-test');
  assert.equal(plan.langfuse.baseUrl, 'https://langfuse.example');

  assert.throws(
    () =>
      buildExporterPlan({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/base',
        OTEL_EXPORTER_OTLP_PROTOCOL: ' grpc ',
      }),
    error =>
      error instanceof Error &&
      error.message.includes('OBSERVABILITY_CONFIG_INVALID') &&
      error.message.includes('http/protobuf') &&
      error.message.includes('grpc'),
  );
});

test('whitespace-only Langfuse credentials and base URL stay disabled/omitted', () => {
  assert.equal(
    buildExporterPlan({
      LANGFUSE_PUBLIC_KEY: '   ',
      LANGFUSE_SECRET_KEY: 'sk-test',
    }).langfuse,
    null,
  );

  assert.deepEqual(
    buildExporterPlan({
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: '   ',
    }).langfuse,
    {
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
  );
});

test('createObservability wires local storage, filters and exact external exporter options', () => {
  const calls = {
    storage: 0,
    filters: 0,
    otel: [],
    langfuse: [],
    observability: [],
  };

  const storage = () => ({ kind: 'storage', n: ++calls.storage });
  const filter = () => ({ kind: 'filter', n: ++calls.filters });

  const result = createObservability(
    {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/base',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20abc',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://langfuse.example',
      THESEUS_ENVIRONMENT: 'test',
      THESEUS_RELEASE: 'deadbeef',
    },
    {
      storage,
      sensitiveDataFilter: filter,
      otel(config) {
        calls.otel.push(config);
        return { kind: 'otel' };
      },
      langfuse(config) {
        calls.langfuse.push(config);
        return { kind: 'langfuse' };
      },
      observability(config) {
        calls.observability.push(config);
        return { kind: 'observability', config };
      },
    },
  );

  assert.equal(result.kind, 'observability');
  assert.equal(calls.storage, 2);
  assert.equal(calls.filters, 2);
  assert.equal(calls.otel.length, 1);
  assert.equal(calls.langfuse.length, 1);
  assert.equal(calls.observability.length, 1);

  assert.deepEqual(calls.otel[0].provider.custom, {
    endpoint: 'https://otlp.example/base',
    protocol: 'http/protobuf',
    headers: { Authorization: 'Basic abc' },
  });
  assert.deepEqual(calls.otel[0].signals, {
    traces: true,
    logs: false,
  });
  assert.deepEqual(calls.otel[0].resourceAttributes, {
    'deployment.environment.name': 'test',
    'service.version': 'deadbeef',
  });
  assert.equal(calls.otel[0].customSpanFormatter, operationalSpanFormatter);

  assert.deepEqual(calls.langfuse[0], {
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    baseUrl: 'https://langfuse.example',
    environment: 'test',
    release: 'deadbeef',
  });

  const config = calls.observability[0];
  assert.equal(config.configSelector, selectObservabilityConfig);
  assert.equal(config.configs.local.serviceName, OBSERVABILITY_SERVICE_NAME);
  assert.equal(
    config.configs[EXTERNAL_SAFE_SCOPE].serviceName,
    OBSERVABILITY_SERVICE_NAME,
  );
  assert.deepEqual(
    config.configs.local.exporters.map(item => item.kind),
    ['storage'],
  );
  assert.deepEqual(
    config.configs[EXTERNAL_SAFE_SCOPE].exporters.map(item => item.kind),
    ['storage', 'otel', 'langfuse'],
  );
  assert.deepEqual(
    config.configs.local.spanOutputProcessors.map(item => item.kind),
    ['filter'],
  );
  assert.deepEqual(
    config.configs[EXTERNAL_SAFE_SCOPE].spanOutputProcessors.map(
      item => item.kind,
    ),
    ['filter'],
  );
});

test('createObservability keeps external-safe storage even when no external backend is configured', () => {
  const calls = { storage: 0, observability: [] };

  createObservability(
    {},
    {
      storage() {
        calls.storage += 1;
        return { kind: 'storage', n: calls.storage };
      },
      sensitiveDataFilter() {
        return { kind: 'filter' };
      },
      otel() {
        throw new Error('OTel must stay disabled');
      },
      langfuse() {
        throw new Error('Langfuse must stay disabled');
      },
      observability(config) {
        calls.observability.push(config);
        return { kind: 'observability' };
      },
    },
  );

  const config = calls.observability[0];
  assert.equal(calls.storage, 2);
  assert.deepEqual(
    config.configs[EXTERNAL_SAFE_SCOPE].exporters.map(item => item.kind),
    ['storage'],
  );
});

test('Langfuse environment defaults to development when enabled without explicit label', () => {
  const langfuse = [];

  createObservability(
    {
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
    },
    {
      storage() {
        return { kind: 'storage' };
      },
      sensitiveDataFilter() {
        return { kind: 'filter' };
      },
      otel() {
        throw new Error('OTel must stay disabled');
      },
      langfuse(config) {
        langfuse.push(config);
        return { kind: 'langfuse' };
      },
      observability() {
        return { kind: 'observability' };
      },
    },
  );

  assert.equal(langfuse[0].environment, 'development');
  assert.equal(langfuse[0].release, undefined);
});

test('OTLP resource attributes trim environment and release labels', () => {
  const otelCalls = [];
  createObservability(
    {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/v1/traces',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      THESEUS_ENVIRONMENT: '  staging  ',
      THESEUS_RELEASE: '  abc123  ',
    },
    {
      storage: () => ({ kind: 'storage' }),
      sensitiveDataFilter: () => ({ kind: 'filter' }),
      otel(config) {
        otelCalls.push(config);
        return { kind: 'otel' };
      },
      langfuse: () => ({ kind: 'langfuse' }),
      observability: config => ({ kind: 'observability', config }),
    },
  );

  assert.equal(otelCalls.length, 1);
  assert.deepEqual(otelCalls[0].resourceAttributes, {
    'deployment.environment.name': 'staging',
    'service.version': 'abc123',
  });
});
