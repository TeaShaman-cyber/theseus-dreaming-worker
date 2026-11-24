import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLocalLlamaSerializerExecutor,
  LocalLlamaSerializerError,
} from '../src/dreaming/serializer-llama-server.ts';
import { proposalSetJsonSchema } from '../src/dreaming/proposal-schema.ts';

const raw = 'FACT: One synthetic request timed out. Source ref: fixture:source:1. Evidence hash: sha256:fixture-source-1.';

function config(overrides = {}) {
  return {
    baseURL: 'http://127.0.0.1:18081/v1',
    timeoutMs: 1000,
    maxOutputTokens: 128,
    coldStartMs: 965,
    peakRssBytes: 814092 * 1024,
    ...overrides,
  };
}

test('local llama serializer rejects non-loopback endpoints before any network call', () => {
  assert.throws(
    () => createLocalLlamaSerializerExecutor(config({ baseURL: 'https://example.com/v1' })),
    /LOCAL_LLAMA_CONFIG_INVALID/,
  );
  assert.throws(
    () => createLocalLlamaSerializerExecutor(config({ baseURL: 'http://10.0.0.5:8080/v1' })),
    /LOCAL_LLAMA_CONFIG_INVALID/,
  );
});

test('local llama serializer sends only frozen raw output plus schema and returns typed execution evidence', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  let observedURL;
  let observedBody;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    observedURL = String(url);
    observedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: 'chatcmpl-local-1',
      model: '/tmp/Qwen3-0.6B-Q8_0.gguf',
      choices: [{
        finish_reason: 'stop',
        message: {
          content: '{"schema":"theseus.dreaming-worker.proposals.v1","proposals":[]}',
        },
      }],
      usage: {
        prompt_tokens: 41,
        completion_tokens: 17,
        total_tokens: 58,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const executor = createLocalLlamaSerializerExecutor(config());
  const result = await executor({
    rawOutput: raw,
    targetSchema: proposalSetJsonSchema,
  });

  assert.equal(calls, 1);
  assert.equal(observedURL, 'http://127.0.0.1:18081/v1/chat/completions');
  assert.equal(observedBody.temperature, 0);
  assert.equal(observedBody.max_tokens, 128);
  assert.equal(observedBody.stream, false);
  assert.equal(observedBody.response_format.type, 'json_schema');
  assert.deepEqual(observedBody.response_format.json_schema.schema, proposalSetJsonSchema);
  assert.equal(observedBody.response_format.json_schema.strict, true);

  const serializedRequest = JSON.stringify(observedBody);
  assert.ok(serializedRequest.includes(raw));
  assert.equal(serializedRequest.includes('packetId'), false);
  assert.equal(serializedRequest.includes('goldenOutput'), false);
  assert.equal(serializedRequest.includes('Synthetic observation'), false);
  assert.ok(serializedRequest.includes('/no_think'));

  assert.equal(result.finishReason, 'stop');
  assert.equal(result.text, '{"schema":"theseus.dreaming-worker.proposals.v1","proposals":[]}');
  assert.deepEqual(result.measurement, {
    coldStartMs: 965,
    peakRssBytes: 814092 * 1024,
    usage: {
      inputTokens: 41,
      outputTokens: 17,
      totalTokens: 58,
      reasoningTokens: 0,
      cachedInputTokens: 3,
    },
  });
});

test('local llama serializer never retries an HTTP failure', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('nope', { status: 503 });
  };

  const executor = createLocalLlamaSerializerExecutor(config());

  await assert.rejects(
    () => executor({ rawOutput: raw, targetSchema: proposalSetJsonSchema }),
    error => error instanceof LocalLlamaSerializerError && error.code === 'HTTP_ERROR',
  );
  assert.equal(calls, 1);
});

test('local llama serializer rejects malformed response JSON and missing content distinctly', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const executor = createLocalLlamaSerializerExecutor(config());

  globalThis.fetch = async () => new Response('{', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    () => executor({ rawOutput: raw, targetSchema: proposalSetJsonSchema }),
    error => error instanceof LocalLlamaSerializerError && error.code === 'MALFORMED_RESPONSE',
  );

  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: {} }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    () => executor({ rawOutput: raw, targetSchema: proposalSetJsonSchema }),
    error => error instanceof LocalLlamaSerializerError && error.code === 'EMPTY_CONTENT',
  );
});

test('local llama serializer validates bounded configuration before creating executor', () => {
  for (const bad of [
    { timeoutMs: 0 },
    { timeoutMs: Number.NaN },
    { maxOutputTokens: 0 },
    { maxOutputTokens: 1.5 },
    { coldStartMs: -1 },
    { peakRssBytes: -1 },
  ]) {
    assert.throws(
      () => createLocalLlamaSerializerExecutor(config(bad)),
      /LOCAL_LLAMA_CONFIG_INVALID/,
    );
  }
});
