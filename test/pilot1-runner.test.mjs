import test from 'node:test';
import assert from 'node:assert/strict';

import { runPilot1 } from '../src/dreaming/pilot1-runner.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-pilot1-001',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [
    {
      sourceRef: 'fixture:message:1',
      evidenceHash: 'sha256:fixture-message-1',
      text: 'Synthetic evidence: a worker timed out after a provider request.',
    },
  ],
};

const request = {
  scope: 'SYNTHETIC_FIXTURE',
  task: 'Propose bounded hypotheses for the timeout.',
  packet,
};

const validFactOutput = JSON.stringify({
  schema: 'theseus.dreaming-worker.proposals.v1',
  proposals: [
    {
      type: 'FACT',
      claim: 'The synthetic request timed out.',
      source_refs: [
        {
          source_ref: 'fixture:message:1',
          evidence_hash: 'sha256:fixture-message-1',
        },
      ],
    },
  ],
});

test('Pilot 1 receipt counts the actual model call instead of trusting model prose', async () => {
  let calls = 0;

  const result = await runPilot1(request, async () => {
    calls += 1;
    return {
      text: JSON.stringify({
        schema: 'theseus.dreaming-worker.proposals.v1',
        proposals: [
          {
            type: 'FACT',
            claim: 'The model prose may claim external_model_calls: 0.',
            source_refs: [
              {
                source_ref: 'fixture:message:1',
                evidence_hash: 'sha256:fixture-message-1',
              },
            ],
          },
        ],
      }),
      provider: 'nvidia',
      model: 'minimaxai/minimax-m3.1-flash',
      finishReason: 'stop',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      runId: 'run-1',
    };
  });

  assert.equal(calls, 1);
  assert.equal(result.outcome, 'PROPOSED');
  assert.match(result.rawModelOutput, /external_model_calls: 0/);
  assert.equal(result.receipt.scope, 'SYNTHETIC_FIXTURE');
  assert.match(result.receipt.requestFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.receipt.externalModelCalls, 1);
  assert.equal(result.receipt.toolsUsed, 0);
  assert.equal(result.receipt.memoryUsed, false);
  assert.equal(result.receipt.canonicalWrites, 0);
  assert.equal(result.receipt.provider, 'nvidia');
  assert.equal(result.receipt.model, 'minimaxai/minimax-m3.1-flash');
});

test('Pilot 1 skips inference when Pilot 0 says NO_DATA', async () => {
  let calls = 0;

  const result = await runPilot1(
    {
      ...request,
      packet: { ...packet, acceptedNewEvidence: false, evidence: [] },
    },
    async () => {
      calls += 1;
      throw new Error('must not run');
    },
  );

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'NO_DATA');
  assert.equal(result.receipt.externalModelCalls, 0);
  assert.equal(result.receipt.toolsUsed, 0);
});

test('Pilot 1 rejects unapproved evidence scope before inference', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      runPilot1(
        { ...request, scope: 'PRIVATE_EVIDENCE' },
        async () => {
          calls += 1;
          throw new Error('must not run');
        },
      ),
    /PILOT1_SCOPE_REJECTED/,
  );

  assert.equal(calls, 0);
});

test('Pilot 1 rejects an empty task before inference', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      runPilot1(
        { ...request, task: '   ' },
        async () => {
          calls += 1;
          throw new Error('must not run');
        },
      ),
    /PILOT1_TASK_REQUIRED/,
  );

  assert.equal(calls, 0);
});

test('Pilot 1 rejects any observed tool call', async () => {
  await assert.rejects(
    () =>
      runPilot1(request, async () => ({
        text: 'should be rejected',
        provider: 'nvidia',
        model: 'minimaxai/minimax-m3.1-flash',
        toolCalls: [{ toolName: 'mastra_workspace_read_file' }],
      })),
    /PILOT1_POLICY_VIOLATION.*tool/i,
  );
});

test('Pilot 1 records trace witness and keeps workspace actions distinct from tool calls', async () => {
  const result = await runPilot1(request, async () => ({
    text: validFactOutput,
    provider: 'nvidia',
    model: 'minimaxai/minimax-m3.1-flash',
    toolCalls: [],
    runtimeWitness: {
      source: 'MASTRA_TRACE',
      modelInferences: 1,
      toolCalls: 0,
      memoryOperations: 0,
      workspaceActions: 1,
    },
  }));

  assert.equal(result.receipt.runtimeWitness, 'TRACE_VERIFIED');
  assert.equal(result.receipt.externalModelCalls, 1);
  assert.equal(result.receipt.toolsUsed, 0);
  assert.equal(result.receipt.memoryUsed, false);
  assert.equal(result.receipt.workspaceActionsObserved, 1);
});

test('Pilot 1 rejects trace evidence of a memory operation', async () => {
  await assert.rejects(
    () =>
      runPilot1(request, async () => ({
        text: 'must be rejected',
        provider: 'nvidia',
        model: 'minimaxai/minimax-m3.1-flash',
        toolCalls: [],
        runtimeWitness: {
          source: 'MASTRA_TRACE',
          modelInferences: 1,
          toolCalls: 0,
          memoryOperations: 1,
          workspaceActions: 0,
        },
      })),
    /PILOT1_POLICY_VIOLATION.*memory/i,
  );
});

test('Pilot 1 rejects trace evidence of more than one model inference', async () => {
  await assert.rejects(
    () =>
      runPilot1(request, async () => ({
        text: 'must be rejected',
        provider: 'nvidia',
        model: 'minimaxai/minimax-m3.1-flash',
        toolCalls: [],
        runtimeWitness: {
          source: 'MASTRA_TRACE',
          modelInferences: 2,
          toolCalls: 0,
          memoryOperations: 0,
          workspaceActions: 0,
        },
      })),
    /PILOT1_POLICY_VIOLATION.*model inference/i,
  );
});

test('Pilot 1 accepts PUBLICATION_SAFE scope', async () => {
  let calls = 0;

  const result = await runPilot1(
    { ...request, scope: 'PUBLICATION_SAFE' },
    async () => {
      calls += 1;
      return {
        text: validFactOutput,
        provider: 'nvidia',
        model: 'minimaxai/minimax-m3.1-flash',
        toolCalls: [],
      };
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.outcome, 'PROPOSED');
  assert.equal(result.receipt.scope, 'PUBLICATION_SAFE');
});

test('Pilot 1 reports a missing task as a policy input error before inference', async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      runPilot1(
        { scope: 'SYNTHETIC_FIXTURE', packet },
        async () => {
          calls += 1;
          throw new Error('must not run');
        },
      ),
    /PILOT1_TASK_REQUIRED/,
  );

  assert.equal(calls, 0);
});

test('Pilot 1 request fingerprint changes when the task changes', async () => {
  const infer = async () => ({
    text: validFactOutput,
    provider: 'nvidia',
    model: 'minimaxai/minimax-m3.1-flash',
    toolCalls: [],
  });

  const first = await runPilot1(request, infer);
  const second = await runPilot1(
    { ...request, task: 'Ask a materially different bounded question.' },
    infer,
  );

  assert.notEqual(
    first.receipt.requestFingerprint,
    second.receipt.requestFingerprint,
  );
  assert.equal(
    first.receipt.evidenceFingerprint,
    second.receipt.evidenceFingerprint,
  );
});

test('Pilot 1 returns a typed proposal set, not free-form model text', async () => {
  const result = await runPilot1(request, async () => ({
    text: JSON.stringify({
      schema: 'theseus.dreaming-worker.proposals.v1',
      proposals: [
        {
          type: 'HYPOTHESIS',
          claim: 'A transient provider-side delay caused the first timeout.',
          why_plausible: 'The synthetic evidence contains a timeout.',
          source_refs: [
            {
              source_ref: 'fixture:message:1',
              evidence_hash: 'sha256:fixture-message-1',
            },
          ],
          falsifier: 'Repeated equivalent requests complete within the bound.',
          required_evidence: ['Provider latency telemetry.'],
          competing_explanations: ['Caller-side timeout configuration.'],
          uncertainty: 'HIGH',
        },
      ],
    }),
    provider: 'nvidia',
    model: 'minimaxai/minimax-m3.1-flash',
    toolCalls: [],
  }));

  assert.equal(result.outcome, 'PROPOSED');
  assert.equal(result.proposalSet.schema, 'theseus.dreaming-worker.proposals.v1');
  assert.equal(result.proposalSet.proposals[0].type, 'HYPOTHESIS');
  assert.equal(result.proposalSet.proposals[0].falsifier.length > 0, true);
});

test('Pilot 1 rejects free-form prose after inference', async () => {
  await assert.rejects(
    () =>
      runPilot1(request, async () => ({
        text: 'The timeout was probably transient.',
        provider: 'nvidia',
        model: 'minimaxai/minimax-m3.1-flash',
        toolCalls: [],
      })),
    /PILOT1_PROPOSAL_JSON_INVALID/,
  );
});
