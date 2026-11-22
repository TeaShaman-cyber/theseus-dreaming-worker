import test from 'node:test';
import assert from 'node:assert/strict';

import { Hono } from 'hono';

import {
  INTERNAL_MASTRA_HEADER,
  createMastraApiGuard,
  runPilot1ThroughMastra,
} from '../src/runtime/cloudflare-pilot1-boundary.ts';

const fixture = {
  scope: 'SYNTHETIC_FIXTURE',
  task: 'Propose one bounded fact.',
  packet: {
    schema: 'theseus-evidence-packet-v1',
    packetId: 'fixture-boundary-001',
    acceptedNewEvidence: true,
    coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
    evidence: [
      {
        sourceRef: 'fixture:message:1',
        evidenceHash: 'sha256:fixture-message-1',
        text: 'Synthetic evidence: the bounded worker returned 503 once.',
      },
    ],
  },
};

const config = {
  id: 'dreaming-worker-pilot1',
  desired: {
    model: {
      provider: 'exe/nvidia',
      name: 'minimaxai/minimax-m3.1-flash',
    },
    defaultOptions: {
      maxSteps: 1,
      activeTools: [],
      toolChoice: 'none',
      requireToolApproval: false,
      modelSettings: {},
    },
  },
};

test('raw Mastra API is hidden externally and available only with the internal capability', async () => {
  const app = new Hono();
  const token = 'per-runtime-capability';

  app.use('/api/*', createMastraApiGuard(token));
  app.get('/api/agents', c => c.json({ ok: true }));

  const external = await app.request('/api/agents');
  assert.equal(external.status, 404);

  const internal = await app.request('/api/agents', {
    headers: { [INTERNAL_MASTRA_HEADER]: token },
  });
  assert.equal(internal.status, 200);
  assert.deepEqual(await internal.json(), { ok: true });
});

test('synthetic runner returns the deterministic Pilot 1 receipt from Mastra generate plus trace witness', async () => {
  const observed = [];

  const invoke = async (path, init) => {
    observed.push({ path, init });

    if (path.endsWith('/generate')) {
      return Response.json({
        text: JSON.stringify({
          schema: 'theseus.dreaming-worker.proposals.v1',
          proposals: [
            {
              type: 'FACT',
              claim: 'The synthetic request returned 503 once.',
              source_refs: [
                {
                  source_ref: 'fixture:message:1',
                  evidence_hash: 'sha256:fixture-message-1',
                },
              ],
            },
          ],
        }),
        finishReason: 'stop',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        runId: 'run-prod-1',
        traceId: 'trace-prod-1',
      });
    }

    if (path === '/api/observability/traces/trace-prod-1/light') {
      return Response.json({
        spans: [
          { spanType: 'agent_run' },
          { spanType: 'model_inference' },
        ],
      });
    }

    return new Response('not found', { status: 404 });
  };

  const result = await runPilot1ThroughMastra({
    request: fixture,
    config,
    invoke,
    traceRetryDelayMs: 0,
  });

  assert.equal(result.outcome, 'PROPOSED');
  assert.equal(result.receipt.schema, 'theseus.dreaming-worker.pilot1-receipt.v1');
  assert.equal(result.receipt.scope, 'SYNTHETIC_FIXTURE');
  assert.equal(result.receipt.externalModelCalls, 1);
  assert.equal(result.receipt.toolsUsed, 0);
  assert.equal(result.receipt.memoryUsed, false);
  assert.equal(result.receipt.canonicalWrites, 0);
  assert.equal(result.receipt.runtimeWitness, 'TRACE_VERIFIED');
  assert.equal(result.receipt.traceId, 'trace-prod-1');
  assert.equal(result.receipt.provider, 'exe/nvidia');
  assert.equal(result.receipt.model, 'minimaxai/minimax-m3.1-flash');

  assert.equal(observed[0].path, '/api/agents/dreaming-worker-pilot1/generate');
  const generateBody = JSON.parse(observed[0].init.body);
  assert.equal(generateBody.maxSteps, 1);
  assert.deepEqual(generateBody.activeTools, []);
  assert.equal(generateBody.toolChoice, 'none');
  assert.equal(generateBody.requestContext.observabilityScope, 'external-safe');
  assert.equal(
    generateBody.tracingOptions.metadata['theseus.scope'],
    'SYNTHETIC_FIXTURE',
  );
  assert.equal(
    generateBody.messages.includes('Synthetic evidence: the bounded worker returned 503 once.'),
    true,
  );

  assert.equal(observed[1].path, '/api/observability/traces/trace-prod-1/light');
});
