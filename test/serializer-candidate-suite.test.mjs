import test from 'node:test';
import assert from 'node:assert/strict';

import { runSerializerCandidateSuite } from '../src/dreaming/serializer-candidate-suite.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'suite',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [{
    sourceRef: 'fixture:source:1',
    evidenceHash: 'sha256:fixture-source-1',
    text: 'Synthetic evidence.',
  }],
};
const golden = JSON.stringify({
  schema: 'theseus.dreaming-worker.proposals.v1',
  proposals: [{
    type: 'FACT',
    claim: 'One request timed out.',
    source_refs: [{
      source_ref: 'fixture:source:1',
      evidence_hash: 'sha256:fixture-source-1',
    }],
  }],
});
const corpus = {
  schema: 'theseus.dreaming-worker.serializer-candidate-corpus.v1',
  packet,
  cases: [
    {
      id: 'positive',
      reasonerRaw: 'TYPE=FACT CLAIM=One request timed out. SOURCE=fixture:source:1 HASH=sha256:fixture-source-1',
      finishReason: 'stop',
      classification: 'UNSTRUCTURED_COMPLETE',
      serializerEligible: true,
      goldenOutput: golden,
    },
    {
      id: 'blocked',
      reasonerRaw: '{',
      finishReason: 'length',
      classification: 'TRUNCATED_OUTPUT',
      serializerEligible: false,
      goldenOutput: null,
    },
  ],
};
const candidate = {
  id: 'fixture-local',
  kind: 'LOCAL_MODEL',
  host: 'EXE_DEV',
  model: 'fixture/model',
};

test('suite repeats eligible cases, preserves zero-call controls, and summarizes observed outcomes', async () => {
  let calls = 0;
  const result = await runSerializerCandidateSuite(
    corpus,
    candidate,
    async () => {
      calls += 1;
      return {
        text: golden,
        finishReason: 'stop',
        measurement: {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      };
    },
    { repeat: 2, nowMs: () => calls * 10 },
  );

  assert.equal(calls, 2);
  assert.equal(result.schema, 'theseus.dreaming-worker.serializer-candidate-suite.v1');
  assert.equal(result.repeat, 2);
  assert.equal(result.runs.length, 4);
  assert.deepEqual(result.runs.map(run => [run.caseId, run.iteration, run.result.outcome]), [
    ['positive', 1, 'EVALUATED'],
    ['blocked', 1, 'NOT_ELIGIBLE'],
    ['positive', 2, 'EVALUATED'],
    ['blocked', 2, 'NOT_ELIGIBLE'],
  ]);
  assert.deepEqual(result.summary, {
    executorInvocations: 2,
    candidateModelCalls: 2,
    externalProviderCalls: 0,
    exactGoldenMatches: 2,
    schemaValidUnreviewed: 0,
    provenanceRejected: 0,
    goldenMismatches: 0,
    notEligible: 2,
    executionFailures: 0,
    truncatedCandidates: 0,
    completionUnknown: 0,
    measurementInvalid: 0,
    observedUsage: {
      state: 'COMPLETE',
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    },
  });
});

test('suite reports aggregate usage UNKNOWN/PARTIAL instead of inventing missing token counts', async () => {
  let call = 0;
  const result = await runSerializerCandidateSuite(
    {
      ...corpus,
      cases: [corpus.cases[0]],
    },
    candidate,
    async () => {
      call += 1;
      return {
        text: golden,
        finishReason: 'stop',
        measurement: call === 1
          ? { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
          : undefined,
      };
    },
    { repeat: 2, nowMs: () => call * 10 },
  );

  assert.equal(result.summary.observedUsage.state, 'PARTIAL');
  assert.deepEqual(result.summary.observedUsage.observed, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  });
  assert.equal(result.summary.observedUsage.observedRuns, 1);
  assert.equal(result.summary.observedUsage.modelCallRuns, 2);
});

test('suite validates repeat and unique case identities before execution', async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    return { text: golden, finishReason: 'stop' };
  };

  await assert.rejects(
    () => runSerializerCandidateSuite(corpus, candidate, execute, { repeat: 0 }),
    /SERIALIZER_SUITE_INVALID/,
  );
  await assert.rejects(
    () => runSerializerCandidateSuite(
      { ...corpus, cases: [corpus.cases[0], corpus.cases[0]] },
      candidate,
      execute,
      { repeat: 1 },
    ),
    /SERIALIZER_SUITE_INVALID/,
  );
  assert.equal(calls, 0);
});
