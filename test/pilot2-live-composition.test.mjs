import assert from 'node:assert/strict';
import test from 'node:test';

import { runPilot2WithProviders } from '../src/dreaming/pilot2-live-composition.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-pilot2-live-001',
  acceptedNewEvidence: true,
  coverage: { state: 'COMPLETE', currentness: 'CURRENT' },
  evidence: [
    {
      sourceRef: 'fixture:pilot2-live-001#fact-1',
      evidenceHash: 'sha256:fixture-pilot2-live-001-fact-1',
      text: 'The retry budget is bounded to one attempt.',
    },
  ],
};

function responseFor(model, claim) {
  return new Response(
    JSON.stringify({
      id: `resp-${model}`,
      model,
      provider: 'fixture-provider',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              schema: 'theseus.dreaming-worker.proposals.v1',
              proposals: [
                {
                  type: 'FACT',
                  claim,
                  source_refs: [
                    {
                      source_ref: 'fixture:pilot2-live-001#fact-1',
                      evidence_hash:
                        'sha256:fixture-pilot2-live-001-fact-1',
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

test('composes two explicit provider routes without runtime-specific coupling', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).startsWith('https://family-a.example/')) {
      return responseFor('family-a-model', 'The retry budget is bounded to one attempt.');
    }
    if (String(url).startsWith('https://family-b.example/')) {
      return responseFor('family-b-model', 'The supplied evidence states a one-attempt retry bound.');
    }
    throw new Error(`unexpected URL ${url}`);
  };

  try {
    const result = await runPilot2WithProviders(
      { scope: 'SYNTHETIC_FIXTURE', task: 'State what the evidence supports.', packet },
      [
        {
          id: 'route-a',
          provider: 'provider-a',
          model: 'family-a-model',
          modelFamily: 'family-a',
          baseURL: 'https://family-a.example/v1',
          timeoutMs: 1000,
          maxOutputTokens: 400,
        },
        {
          id: 'route-b',
          provider: 'provider-b',
          model: 'family-b-model',
          modelFamily: 'family-b',
          baseURL: 'https://family-b.example/v1',
          timeoutMs: 1000,
          maxOutputTokens: 400,
        },
      ],
    );

    assert.equal(result.outcome, 'COMPLETE');
    assert.equal(result.passes.length, 2);
    assert.equal(result.receipt.independence, 'CONFIGURED_DISTINCT');
    assert.deepEqual(calls.map(call => call.url).sort(), [
      'https://family-a.example/v1/chat/completions',
      'https://family-b.example/v1/chat/completions',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a live route without a positive output-token bound before provider calls', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network must not be reached');
  };

  try {
    await assert.rejects(
      () =>
        runPilot2WithProviders(
          { scope: 'SYNTHETIC_FIXTURE', task: 'State what the evidence supports.', packet },
          [
            {
              id: 'route-a', provider: 'provider-a', model: 'model-a', modelFamily: 'family-a',
              baseURL: 'https://family-a.example/v1', timeoutMs: 1000,
            },
            {
              id: 'route-b', provider: 'provider-b', model: 'model-b', modelFamily: 'family-b',
              baseURL: 'https://family-b.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
            },
          ],
        ),
      /PILOT2_PROVIDER_ROUTES_INVALID:.*maxOutputTokens/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('same-family live routes fail closed before provider calls', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network must not be reached');
  };

  try {
    const result = await runPilot2WithProviders(
      { scope: 'SYNTHETIC_FIXTURE', task: 'State what the evidence supports.', packet },
      [
        {
          id: 'route-a', provider: 'provider-a', model: 'model-a', modelFamily: 'same-family',
          baseURL: 'https://family-a.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
        },
        {
          id: 'route-b', provider: 'provider-b', model: 'model-b', modelFamily: 'same-family',
          baseURL: 'https://family-b.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
        },
      ],
    );

    assert.equal(result.outcome, 'FAIL_CLOSED');
    assert.equal(result.terminalFailure?.code, 'INDEPENDENCE_NOT_ESTABLISHED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserves adapter empty-content and output-budget failure codes through live composition', async () => {
  const originalFetch = globalThis.fetch;

  for (const failureCase of [
    { finishReason: 'stop', expected: 'EMPTY_FINAL_CONTENT' },
    { finishReason: 'length', expected: 'OUTPUT_BUDGET_EXHAUSTED' },
  ]) {
    globalThis.fetch = async url => {
      if (String(url).startsWith('https://family-a.example/')) {
        return responseFor('family-a-model', 'The retry budget is bounded to one attempt.');
      }

      if (String(url).startsWith('https://family-b.example/')) {
        return new Response(
          JSON.stringify({
            id: 'resp-family-b-model',
            model: 'family-b-model',
            choices: [{
              finish_reason: failureCase.finishReason,
              message: { content: '' },
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`unexpected URL ${url}`);
    };

    const result = await runPilot2WithProviders(
      { scope: 'SYNTHETIC_FIXTURE', task: 'State what the evidence supports.', packet },
      [
        {
          id: 'route-a', provider: 'provider-a', model: 'family-a-model', modelFamily: 'family-a',
          baseURL: 'https://family-a.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
        },
        {
          id: 'route-b', provider: 'provider-b', model: 'family-b-model', modelFamily: 'family-b',
          baseURL: 'https://family-b.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
        },
      ],
    );

    assert.equal(result.outcome, 'PARTIAL');
    const failed = result.passes.find(pass => pass.status === 'FAILED');
    assert.equal(failed?.failure.code, failureCase.expected);
  }

  globalThis.fetch = originalFetch;
});

test('live composition passes optional JSON mode and bearer auth to the generic adapter', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: String(url),
      authorization: options.headers.authorization,
      body: JSON.parse(options.body),
    });
    const model = String(url).includes('family-a') ? 'family-a-model' : 'family-b-model';
    return responseFor(model, 'The retry budget is bounded to one attempt.');
  };

  try {
    const result = await runPilot2WithProviders(
      { scope: 'SYNTHETIC_FIXTURE', task: 'State what the evidence supports.', packet },
      [
        {
          id: 'route-a', provider: 'provider-a', model: 'family-a-model', modelFamily: 'family-a',
          baseURL: 'https://family-a.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
          responseFormat: 'json_object', apiKey: 'secret-a',
        },
        {
          id: 'route-b', provider: 'provider-b', model: 'family-b-model', modelFamily: 'family-b',
          baseURL: 'https://family-b.example/v1', timeoutMs: 1000, maxOutputTokens: 400,
        },
      ],
    );

    assert.equal(result.outcome, 'COMPLETE');
    assert.equal(calls[0].authorization, 'Bearer secret-a');
    assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
    assert.equal(calls[1].authorization, undefined);
    assert.equal(calls[1].body.response_format, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
