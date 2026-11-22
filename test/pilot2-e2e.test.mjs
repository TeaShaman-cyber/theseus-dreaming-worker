import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { buildPilot2Routes } from '../src/dreaming/pilot2-e2e.ts';
import { runPilot2 } from '../src/dreaming/pilot2-runner.ts';

const baseConfig = {
  routes: [
    {
      id: 'route-a',
      provider: 'provider-a',
      model: 'family-a/model-a',
      modelFamily: 'family-a',
      baseURL: 'https://provider-a.example/v1',
      maxTokens: 800,
      timeoutMs: 5000,
      apiKeyEnv: 'PROVIDER_A_KEY',
    },
    {
      id: 'route-b',
      provider: 'provider-b',
      model: 'family-b/model-b',
      modelFamily: 'family-b',
      baseURL: 'https://provider-b.example/v1',
      maxTokens: 900,
      timeoutMs: 6000,
    },
  ],
};

test('Pilot 2 E2E composition creates exactly two explicit bounded routes', () => {
  const routes = buildPilot2Routes(baseConfig, {
    env: { PROVIDER_A_KEY: 'secret-a' },
  });

  assert.equal(routes.length, 2);
  assert.deepEqual(
    routes.map(route => ({
      id: route.id,
      provider: route.provider,
      model: route.model,
      modelFamily: route.modelFamily,
    })),
    [
      {
        id: 'route-a',
        provider: 'provider-a',
        model: 'family-a/model-a',
        modelFamily: 'family-a',
      },
      {
        id: 'route-b',
        provider: 'provider-b',
        model: 'family-b/model-b',
        modelFamily: 'family-b',
      },
    ],
  );
  assert.equal(typeof routes[0].infer, 'function');
  assert.equal(typeof routes[1].infer, 'function');
});

test('Pilot 2 E2E composition refuses an unbounded route before inference', () => {
  const config = structuredClone(baseConfig);
  delete config.routes[1].maxTokens;

  assert.throws(
    () => buildPilot2Routes(config, { env: { PROVIDER_A_KEY: 'secret-a' } }),
    /PILOT2_E2E_ROUTE_INVALID.*maxTokens/,
  );
});

test('Pilot 2 E2E composition requires declared API-key env vars when configured', () => {
  assert.throws(
    () => buildPilot2Routes(baseConfig, { env: {} }),
    /PILOT2_E2E_API_KEY_MISSING.*PROVIDER_A_KEY/,
  );
});


function startProvider({ provider, model, proposal }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'run-' + provider,
        provider,
        model,
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              schema: 'theseus.dreaming-worker.proposals.v1',
              proposals: [proposal],
            }),
          },
        }],
        usage: { prompt_tokens: 40, completion_tokens: 80, total_tokens: 120 },
      }));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseURL: 'http://127.0.0.1:' + address.port + '/v1',
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

test('Pilot 2 E2E composition joins two real adapter calls into one COMPLETE receipt', async () => {
  const ref = {
    source_ref: 'fixture:message:1',
    evidence_hash: 'sha256:fixture-message-1',
  };
  const providerA = await startProvider({
    provider: 'transport-a',
    model: 'family-a/model-observed',
    proposal: {
      type: 'HYPOTHESIS',
      claim: 'The first request may have exceeded a transient latency boundary.',
      why_plausible: 'The supplied evidence records a timeout followed by a successful retry.',
      source_refs: [ref],
      falsifier: 'A server-side trace showing the first request completed within the client deadline.',
      required_evidence: ['First-attempt server-side timing trace.'],
      competing_explanations: ['A transient network interruption.'],
      uncertainty: 'HIGH',
    },
  });
  const providerB = await startProvider({
    provider: 'transport-b',
    model: 'family-b/model-observed',
    proposal: {
      type: 'HYPOTHESIS',
      claim: 'The first request may have encountered a transient transport interruption.',
      why_plausible: 'The supplied evidence records a timeout but a later retry succeeded.',
      source_refs: [ref],
      falsifier: 'A transport trace showing uninterrupted connectivity during the first request.',
      required_evidence: ['First-attempt transport trace.'],
      competing_explanations: ['Provider-side latency exceeded the client deadline.'],
      uncertainty: 'HIGH',
    },
  });

  const evidence = [];
  try {
    const routes = buildPilot2Routes({
      routes: [
        {
          id: 'route-a',
          provider: 'configured-a',
          model: 'family-a/model-configured',
          modelFamily: 'family-a',
          baseURL: providerA.baseURL,
          maxTokens: 800,
          timeoutMs: 2000,
        },
        {
          id: 'route-b',
          provider: 'configured-b',
          model: 'family-b/model-configured',
          modelFamily: 'family-b',
          baseURL: providerB.baseURL,
          maxTokens: 800,
          timeoutMs: 2000,
        },
      ],
    }, { onEvidence: item => evidence.push(item) });

    const result = await runPilot2({
      scope: 'SYNTHETIC_FIXTURE',
      task: 'Return one evidence-linked hypothesis.',
      packet: {
        schema: 'theseus-evidence-packet-v1',
        packetId: 'fixture-e2e-001',
        acceptedNewEvidence: true,
        coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
        evidence: [{
          sourceRef: 'fixture:message:1',
          evidenceHash: 'sha256:fixture-message-1',
          text: 'Synthetic evidence: a first request timed out and a later retry succeeded.',
        }],
      },
    }, routes);

    assert.equal(result.outcome, 'COMPLETE');
    assert.equal(result.receipt.validPasses, 2);
    assert.equal(result.receipt.confirmedExternalModelCalls, 2);
    assert.equal(result.receipt.unresolvedExternalCallAttempts, 0);
    assert.equal(result.receipt.independence, 'CONFIGURED_DISTINCT');
    assert.equal(result.passes.length, 2);
    assert.equal(result.comparison.semanticRelation, 'UNRESOLVED_WITHOUT_CRITIQUE');
    assert.equal(result.comparison.sharedProposalFingerprints.length, 0);
    assert.equal(evidence.length, 2);
    assert.deepEqual(evidence.map(item => item.routeId).sort(), ['route-a', 'route-b']);
    assert.ok(evidence.every(item => item.outcome === 'SUCCESS' && item.usableArtifact));
  } finally {
    await Promise.all([providerA.close(), providerB.close()]);
  }
});

test('Pilot 2 E2E composition rejects unsupported response format modes', () => {
  const config = structuredClone(baseConfig);
  config.routes[1].responseFormat = 'json_schema';

  assert.throws(
    () => buildPilot2Routes(config, { env: { PROVIDER_A_KEY: 'secret-a' } }),
    /PILOT2_E2E_ROUTE_INVALID.*responseFormat/,
  );
});

async function startRawProvider(responsePayload) {
  return await new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(responsePayload));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseURL: 'http://127.0.0.1:' + address.port + '/v1',
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

async function runComposedFailureCase({ finishReason, content }) {
  const failing = await startRawProvider({
    id: 'run-failing',
    model: 'family-a/model-observed',
    choices: [{
      finish_reason: finishReason,
      message: { role: 'assistant', content },
    }],
  });
  const passing = await startProvider({
    provider: 'transport-b',
    model: 'family-b/model-observed',
    proposal: {
      type: 'UNKNOWN',
      claim: 'The synthetic evidence does not establish a unique cause.',
      why_unknown: 'Only timeout and retry-success observations are available.',
      source_refs: [{
        source_ref: 'fixture:message:1',
        evidence_hash: 'sha256:fixture-message-1',
      }],
      required_evidence: ['First-attempt provider and transport traces.'],
    },
  });

  try {
    const routes = buildPilot2Routes({
      routes: [
        {
          id: 'route-a',
          provider: 'configured-a',
          model: 'family-a/model-configured',
          modelFamily: 'family-a',
          baseURL: failing.baseURL,
          maxTokens: 800,
          timeoutMs: 2000,
        },
        {
          id: 'route-b',
          provider: 'configured-b',
          model: 'family-b/model-configured',
          modelFamily: 'family-b',
          baseURL: passing.baseURL,
          maxTokens: 800,
          timeoutMs: 2000,
        },
      ],
    });

    return await runPilot2({
      scope: 'SYNTHETIC_FIXTURE',
      task: 'Return one evidence-linked proposal.',
      packet: {
        schema: 'theseus-evidence-packet-v1',
        packetId: 'fixture-e2e-failure-001',
        acceptedNewEvidence: true,
        coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
        evidence: [{
          sourceRef: 'fixture:message:1',
          evidenceHash: 'sha256:fixture-message-1',
          text: 'Synthetic evidence: a first request timed out and a later retry succeeded.',
        }],
      },
    }, routes);
  } finally {
    await Promise.all([failing.close(), passing.close()]);
  }
}

test('Pilot 2 E2E preserves adapter output-budget exhaustion as a typed pass failure', async () => {
  const result = await runComposedFailureCase({
    finishReason: 'length',
    content: '',
  });

  assert.equal(result.outcome, 'PARTIAL');
  const failed = result.passes.find(pass => pass.status === 'FAILED');
  assert.equal(failed.failure.code, 'OUTPUT_BUDGET_EXHAUSTED');
});

test('Pilot 2 E2E preserves adapter empty final content as a typed pass failure', async () => {
  const result = await runComposedFailureCase({
    finishReason: 'stop',
    content: '',
  });

  assert.equal(result.outcome, 'PARTIAL');
  const failed = result.passes.find(pass => pass.status === 'FAILED');
  assert.equal(failed.failure.code, 'EMPTY_FINAL_CONTENT');
});
