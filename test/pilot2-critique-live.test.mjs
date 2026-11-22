import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiveCritique } from '../src/dreaming/pilot2-critique-live.ts';
import { critiqueArtifactJsonSchema } from '../src/dreaming/pilot2-critique.ts';

const input = {
  schema: 'theseus.dreaming-worker.critique-input.v1',
  pilot2Outcome: 'COMPLETE',
  packetId: 'fixture-live-critique-001',
  evidenceFingerprint: 'sha256:evidence',
  requestFingerprint: 'sha256:request',
  perspectives: [
    {
      perspectiveId: 'route-a',
      route: { id: 'route-a', provider: 'p-a', model: 'model-a', modelFamily: 'family-a' },
      proposals: [{
        proposalFingerprint: 'sha256:proposal-a',
        proposal: {
          type: 'FACT',
          claim: 'The first request timed out.',
          source_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:1' }],
        },
      }],
    },
    {
      perspectiveId: 'route-b',
      route: { id: 'route-b', provider: 'p-b', model: 'model-b', modelFamily: 'family-b' },
      proposals: [{
        proposalFingerprint: 'sha256:proposal-b',
        proposal: {
          type: 'INFERENCE',
          claim: 'The timeout may have been transient.',
          source_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:1' }],
          assumptions: ['The requests are materially comparable.'],
          uncertainty: 'MEDIUM',
        },
      }],
    },
  ],
  failedPerspectives: [],
};

const route = {
  id: 'critique-route',
  provider: 'fixture-provider',
  model: 'fixture-critic',
  modelFamily: 'fixture-critic-family',
  baseURL: 'https://critic.example/v1',
  timeoutMs: 1000,
  maxOutputTokens: 500,
};

const validArtifact = {
  schema: 'theseus.dreaming-worker.critique.v1',
  authority: 'DERIVED_ONLY',
  relations: [{
    relation: 'DISAGREEMENT',
    summary: 'The second pass proposes a transient explanation that the first pass does not establish.',
    proposal_refs: [
      { perspective_id: 'route-a', proposal_fingerprint: 'sha256:proposal-a' },
      { perspective_id: 'route-b', proposal_fingerprint: 'sha256:proposal-b' },
    ],
    evidence_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:1' }],
    requested_evidence: ['Comparable provider-side latency traces.'],
  }],
};

function response(content, { finishReason = 'stop', status = 200 } = {}) {
  return new Response(JSON.stringify({
    id: 'resp-critic-1',
    provider: 'observed-provider',
    model: 'observed-critic',
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  }), { status, headers: { 'content-type': 'application/json' } });
}

test('one bounded provider call returns a validated DERIVED_ONLY critique receipt', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, headers: options.headers, body: JSON.parse(options.body) });
    return response(JSON.stringify(validArtifact));
  };

  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'CRITIQUED');
    assert.equal(result.artifact.authority, 'DERIVED_ONLY');
    assert.equal(result.receipt.schema, 'theseus.dreaming-worker.critique-live-receipt.v1');
    assert.equal(result.receipt.externalModelCalls, 1);
    assert.equal(result.receipt.toolsUsed, 0);
    assert.equal(result.receipt.memoryUsed, false);
    assert.equal(result.receipt.canonicalWrites, 0);
    assert.equal(result.receipt.configuredRoute.model, 'fixture-critic');
    assert.equal(result.receipt.observedProvider, 'observed-provider');
    assert.equal(result.receipt.observedModel, 'observed-critic');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://critic.example/v1/chat/completions');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['content-type'], 'application/json');
    assert.equal(calls[0].body.max_tokens, 500);
    assert.equal(calls[0].body.stream, false);
    assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
    assert.match(calls[0].body.messages[0].content, /theseus\.dreaming-worker\.critique\.v1/);
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), input);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('free prose is a typed critique JSON failure rather than a partial success', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response('These perspectives probably disagree.');
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'CRITIQUE_JSON_INVALID');
    assert.equal(result.receipt.externalModelCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('invented frozen proposal references remain a typed failure', async () => {
  const originalFetch = globalThis.fetch;
  const bad = structuredClone(validArtifact);
  bad.relations[0].proposal_refs[0].proposal_fingerprint = 'sha256:invented';
  globalThis.fetch = async () => response(JSON.stringify(bad));
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'CRITIQUE_PROPOSAL_REF_REJECTED');
  } finally { globalThis.fetch = originalFetch; }
});

test('provider timeout is visible and is never retried', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'TIMEOUT_UNKNOWN_PROVIDER_STATE');
    assert.equal(result.receipt.externalModelCalls, 1);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('empty final content and output-budget exhaustion remain distinct failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [finishReason, expected] of [
      ['stop', 'EMPTY_FINAL_CONTENT'],
      ['length', 'OUTPUT_BUDGET_EXHAUSTED'],
    ]) {
      globalThis.fetch = async () => response('', { finishReason });
      const result = await runLiveCritique(input, route);
      assert.equal(result.outcome, 'FAILED');
      assert.equal(result.failure.code, expected);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid route identity and bounds fail before any provider call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network must not be reached'); };
  try {
    for (const field of ['id', 'provider', 'model', 'modelFamily', 'baseURL']) {
      await assert.rejects(
        () => runLiveCritique(input, { ...route, [field]: '   ' }),
        /CRITIQUE_ROUTE_INVALID/,
      );
    }
    for (const maxOutputTokens of [0, -1, 1.5]) {
      await assert.rejects(
        () => runLiveCritique(input, { ...route, maxOutputTokens }),
        /CRITIQUE_ROUTE_INVALID/,
      );
    }
    for (const timeoutMs of [0, -1, Number.NaN]) {
      await assert.rejects(
        () => runLiveCritique(input, { ...route, timeoutMs }),
        /CRITIQUE_ROUTE_INVALID/,
      );
    }
    await assert.rejects(
      () => runLiveCritique(input, { ...route, baseURL: 'not-a-url' }),
      /CRITIQUE_ROUTE_INVALID/,
    );
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('route values are normalized and trailing base slashes do not change the endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl;
  globalThis.fetch = async url => {
    observedUrl = String(url);
    return response(JSON.stringify(validArtifact));
  };
  try {
    const result = await runLiveCritique(input, {
      ...route,
      id: '  critique-route  ',
      provider: '  fixture-provider  ',
      model: '  fixture-critic  ',
      modelFamily: '  fixture-family  ',
      baseURL: '  https://critic.example/v1///  ',
    });
    assert.equal(result.outcome, 'CRITIQUED');
    assert.equal(observedUrl, 'https://critic.example/v1/chat/completions');
    assert.deepEqual(result.receipt.configuredRoute, {
      id: 'critique-route',
      provider: 'fixture-provider',
      model: 'fixture-critic',
      modelFamily: 'fixture-family',
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('rate limit, ordinary HTTP failure, and pre-response network failure stay distinct', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 429 });
    let result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'RATE_LIMITED');
    assert.equal(result.receipt.providerState, 'RESPONDED');

    globalThis.fetch = async () => new Response('', { status: 503 });
    result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'HTTP_ERROR');
    assert.equal(result.receipt.providerState, 'RESPONDED');

    globalThis.fetch = async () => { throw new Error('connection refused'); };
    result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'HTTP_ERROR');
    assert.equal(result.receipt.providerState, 'UNKNOWN');
  } finally { globalThis.fetch = originalFetch; }
});

test('unexpected SSE transport failure is normalized to MALFORMED_RESPONSE for critique', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'MALFORMED_RESPONSE');
    assert.equal(result.receipt.providerState, 'RESPONDED');
  } finally { globalThis.fetch = originalFetch; }
});

test('malformed provider JSON and malformed choices are typed transport failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('not-json', { status: 200 });
    let result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'MALFORMED_RESPONSE');

    for (const body of [[], {}, { choices: [] }, { choices: [null] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
      result = await runLiveCritique(input, route);
      assert.equal(result.outcome, 'FAILED');
      assert.equal(result.failure.code, 'MALFORMED_RESPONSE');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid critique schema and invented evidence stay distinct validation failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const badSchema = structuredClone(validArtifact);
    badSchema.authority = 'TRUTH';
    globalThis.fetch = async () => response(JSON.stringify(badSchema));
    let result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'CRITIQUE_SCHEMA_INVALID');

    const badEvidence = structuredClone(validArtifact);
    badEvidence.relations[0].evidence_refs[0] = { source_ref: 'fixture:invented', evidence_hash: 'sha256:invented' };
    globalThis.fetch = async () => response(JSON.stringify(badEvidence));
    result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'CRITIQUE_EVIDENCE_REF_REJECTED');
  } finally { globalThis.fetch = originalFetch; }
});

test('transport metadata comes only from response metadata and default bounds remain explicit', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    provider: '   ',
    model: '',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(validArtifact) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const { timeoutMs, ...withoutTimeout } = route;
    const result = await runLiveCritique(input, withoutTimeout);
    assert.equal(result.outcome, 'CRITIQUED');
    assert.equal(result.receipt.observedProvider, undefined);
    assert.equal(result.receipt.observedModel, undefined);
    assert.equal(result.receipt.bounds.timeoutMs, 15000);
    assert.equal(result.receipt.bounds.maxOutputTokens, 500);
  } finally { globalThis.fetch = originalFetch; }
});

test('live critique request has one exact model-facing protocol contract', async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return response(JSON.stringify(validArtifact));
  };

  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'CRITIQUED');
    assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
    assert.equal(body.messages[1].content, JSON.stringify(input));

    const expectedSystem = [
      'Return exactly one JSON object and no surrounding prose or markdown.',
      'Compare the frozen perspectives; do not decide truth or choose a winner.',
      'Use only proposal and evidence references present in the supplied critique input.',
      'Keep authority exactly DERIVED_ONLY.',
      'Return an INSTANCE that validates against the following JSON Schema. Do not return the JSON Schema itself.',
      'The top-level output keys must be exactly schema, authority, and relations.',
      JSON.stringify(critiqueArtifactJsonSchema),
    ].join(' ');

    assert.equal(body.messages[0].content, expectedSystem);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.stream, false);
    assert.equal(body.model, route.model);
    assert.equal(body.max_tokens, route.maxOutputTokens);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('system prompt keeps critique derived-only and forbids winner selection', async () => {
  const originalFetch = globalThis.fetch;
  let system;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    system = body.messages[0].content;
    return response(JSON.stringify(validArtifact));
  };
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'CRITIQUED');
    assert.match(system, /DERIVED_ONLY/);
    assert.match(system, /do not decide truth or choose a winner/);
    assert.match(system, /Do not return the JSON Schema itself/);
    assert.match(system, /top-level output keys must be exactly schema, authority, and relations/);
    assert.match(system, /theseus\.dreaming-worker\.critique\.v1/);
  } finally { globalThis.fetch = originalFetch; }
});


test('whitespace-only model content is still EMPTY_FINAL_CONTENT', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response('   \n\t ');
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'EMPTY_FINAL_CONTENT');
  } finally { globalThis.fetch = originalFetch; }
});

test('deadline signal abort is classified as timeout even when fetch throws a generic error', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    await new Promise((resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('abort signal did not fire')), 100);
      options.signal.addEventListener('abort', () => {
        clearTimeout(guard);
        resolve();
      }, { once: true });
    });
    throw new Error('aborted by signal');
  };
  try {
    const result = await runLiveCritique(input, { ...route, timeoutMs: 5 });
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.failure.code, 'TIMEOUT_UNKNOWN_PROVIDER_STATE');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('non-string transport identity is ignored rather than trusted', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    provider: 123,
    model: false,
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(validArtifact) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'CRITIQUED');
    assert.equal(result.receipt.observedProvider, undefined);
    assert.equal(result.receipt.observedModel, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('primitive payloads and non-object first choices are malformed responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [null, 'text', 42, { choices: 'not-an-array' }, { choices: [42] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
      const result = await runLiveCritique(input, route);
      assert.equal(result.outcome, 'FAILED');
      assert.equal(result.failure.code, 'MALFORMED_RESPONSE');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('missing or non-string message content is EMPTY_FINAL_CONTENT', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const message of [null, {}, { content: 123 }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message }],
      }), { status: 200 });
      const result = await runLiveCritique(input, route);
      assert.equal(result.outcome, 'FAILED');
      assert.equal(result.failure.code, 'EMPTY_FINAL_CONTENT');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('optional runtime apiKey is sent only as Authorization and never leaks into receipt or model input', async () => {
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (_url, options) => {
    observed = { headers: options.headers, body: JSON.parse(options.body) };
    return response(JSON.stringify(validArtifact));
  };
  try {
    const secret = 'critique-secret';
    const result = await runLiveCritique(input, { ...route, apiKey: secret });
    assert.equal(result.outcome, 'CRITIQUED');
    assert.equal(observed.headers.authorization, 'Bearer critique-secret');
    assert.equal(JSON.stringify(observed.body).includes(secret), false);
    assert.equal(JSON.stringify(result.receipt).includes(secret), false);
    assert.equal('apiKey' in result.receipt.configuredRoute, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Authorization header is omitted when no critique apiKey is configured', async () => {
  const originalFetch = globalThis.fetch;
  let observedAuthorization;
  globalThis.fetch = async (_url, options) => {
    observedAuthorization = options.headers.authorization;
    return response(JSON.stringify(validArtifact));
  };
  try {
    const result = await runLiveCritique(input, route);
    assert.equal(result.outcome, 'CRITIQUED');
    assert.equal(observedAuthorization, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
