import test from 'node:test';
import assert from 'node:assert/strict';

import { runSerializerCandidateBenchmark } from '../src/dreaming/serializer-benchmark-runner.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'serializer-runner-synthetic',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [{
    sourceRef: 'fixture:source:1',
    evidenceHash: 'sha256:fixture-source-1',
    text: 'Synthetic observation: one request timed out.',
  }],
};

const raw = 'FACT: One synthetic request timed out. Source ref: fixture:source:1. Evidence hash: sha256:fixture-source-1.';
const golden = JSON.stringify({
  schema: 'theseus.dreaming-worker.proposals.v1',
  proposals: [{
    type: 'FACT',
    claim: 'One synthetic request timed out.',
    source_refs: [{ source_ref: 'fixture:source:1', evidence_hash: 'sha256:fixture-source-1' }],
  }],
});

function eligibleFixture(overrides = {}) {
  return {
    id: 'runner-positive',
    packet,
    reasoner: {
      rawOutput: raw,
      finishReason: 'stop',
      recovery: {
        classification: 'UNSTRUCTURED_COMPLETE',
        serializerEligible: true,
        rawModelOutput: raw,
      },
    },
    goldenOutput: golden,
    ...overrides,
  };
}

const localCandidate = {
  id: 'tiny-local',
  kind: 'LOCAL_MODEL',
  host: 'EXE_DEV',
  model: 'fixture/tiny-json',
};

test('runner does not invoke a candidate for an ineligible fixture', async () => {
  let calls = 0;
  const fixture = eligibleFixture({
    reasoner: {
      rawOutput: raw,
      finishReason: 'length',
      recovery: {
        classification: 'TRUNCATED_OUTPUT',
        serializerEligible: false,
        rawModelOutput: null,
      },
    },
  });

  const result = await runSerializerCandidateBenchmark(
    fixture,
    localCandidate,
    async () => {
      calls += 1;
      throw new Error('must not execute');
    },
  );

  assert.equal(calls, 0);
  assert.equal(result.outcome, 'NOT_ELIGIBLE');
  assert.equal(result.executorInvocations, 0);
  assert.equal(result.candidateModelCalls, 0);
  assert.equal(result.externalProviderCalls, 0);
  assert.equal(result.wallTimeMs, null);
  assert.equal(result.benchmark, null);
});

test('runner gives the serializer only frozen raw output and target schema, calls once, and evaluates the result', async () => {
  let calls = 0;
  let observedInput;
  const ticks = [100, 125];

  const result = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async input => {
      calls += 1;
      observedInput = input;
      return {
        text: golden,
        finishReason: 'stop',
        measurement: {
          coldStartMs: 7,
          peakRssBytes: 123456,
          cost: { amount: 0.004, currency: 'USD', source: 'fixture-meter' },
          usage: { inputTokens: 41, outputTokens: 37, totalTokens: 78 },
        },
      };
    },
    { nowMs: () => ticks.shift() },
  );

  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(observedInput).sort(), ['rawOutput', 'targetSchema']);
  assert.equal(observedInput.rawOutput, raw);
  assert.equal('packet' in observedInput, false);
  assert.equal('goldenOutput' in observedInput, false);
  assert.equal(JSON.stringify(observedInput).includes('Synthetic observation'), false);

  assert.equal(result.outcome, 'EVALUATED');
  assert.equal(result.executorInvocations, 1);
  assert.equal(result.candidateModelCalls, 1);
  assert.equal(result.externalProviderCalls, 0);
  assert.equal(result.retryCount, 0);
  assert.equal(result.wallTimeMs, 25);
  assert.equal(result.benchmark.outcome, 'EXACT_GOLDEN_MATCH');
  assert.equal(result.measurement.coldStartMs, 7);
  assert.equal(result.measurement.peakRssBytes, 123456);
  assert.deepEqual(result.measurement.cost, {
    state: 'OBSERVED',
    amount: 0.004,
    currency: 'USD',
    source: 'fixture-meter',
  });
  assert.deepEqual(result.measurement.usage, {
    inputTokens: 41,
    outputTokens: 37,
    totalTokens: 78,
  });
  assert.equal(result.canonicalWrites, 0);
});

test('runner distinguishes external provider calls from local model execution', async () => {
  const candidate = {
    id: 'external-json',
    kind: 'EXTERNAL_PROVIDER',
    host: 'EXE_DEV',
    provider: 'fixture-provider',
    model: 'fixture/model',
  };
  const ticks = [10, 14];

  const result = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    candidate,
    async () => ({ text: golden, finishReason: 'stop' }),
    { nowMs: () => ticks.shift() },
  );

  assert.equal(result.outcome, 'EVALUATED');
  assert.equal(result.candidateModelCalls, 1);
  assert.equal(result.externalProviderCalls, 1);
  assert.deepEqual(result.measurement.cost, { state: 'UNKNOWN' });
});

test('runner refuses to evaluate truncated or completion-unknown serializer output', async () => {
  for (const finishReason of ['length', undefined]) {
    const ticks = [1, 2];
    const result = await runSerializerCandidateBenchmark(
      eligibleFixture(),
      localCandidate,
      async () => ({ text: golden, finishReason }),
      { nowMs: () => ticks.shift() },
    );

    assert.equal(
      result.outcome,
      finishReason === 'length' ? 'CANDIDATE_TRUNCATED' : 'CANDIDATE_COMPLETION_UNKNOWN',
    );
    assert.equal(result.executorInvocations, 1);
    assert.equal(result.candidateModelCalls, 1);
    assert.equal(result.benchmark, null);
    assert.match(result.candidateOutputFingerprint, /^sha256:[a-f0-9]{64}$/);
  }
});

test('runner preserves one failed execution without retrying', async () => {
  let calls = 0;
  const ticks = [50, 61];

  const result = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => {
      calls += 1;
      throw new Error('fixture transport failure with details that must not enter receipt');
    },
    { nowMs: () => ticks.shift() },
  );

  assert.equal(calls, 1);
  assert.equal(result.outcome, 'EXECUTION_FAILED');
  assert.equal(result.failure.code, 'CANDIDATE_EXECUTION_FAILED');
  assert.equal('message' in result.failure, false);
  assert.equal(result.executorInvocations, 1);
  assert.equal(result.candidateModelCalls, 1);
  assert.equal(result.retryCount, 0);
  assert.equal(result.wallTimeMs, 11);
  assert.equal(result.benchmark, null);
});

test('runner fails measurement closed after a real candidate invocation instead of inventing metrics', async () => {
  const ticks = [20, 29];
  const result = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => ({
      text: golden,
      finishReason: 'stop',
      measurement: {
        peakRssBytes: -1,
        cost: { amount: Number.NaN, currency: 'USD', source: 'bad-meter' },
      },
    }),
    { nowMs: () => ticks.shift() },
  );

  assert.equal(result.outcome, 'MEASUREMENT_INVALID');
  assert.equal(result.failure.code, 'CANDIDATE_MEASUREMENT_INVALID');
  assert.equal(result.executorInvocations, 1);
  assert.equal(result.candidateModelCalls, 1);
  assert.equal(result.wallTimeMs, 9);
  assert.equal(result.benchmark, null);
});

test('runner rejects invalid candidate identity before any execution', async () => {
  let calls = 0;
  await assert.rejects(
    () => runSerializerCandidateBenchmark(
      eligibleFixture(),
      { ...localCandidate, model: '   ' },
      async () => {
        calls += 1;
        return { text: golden, finishReason: 'stop' };
      },
    ),
    /SERIALIZER_CANDIDATE_INVALID/,
  );
  assert.equal(calls, 0);
});

test('candidate identity requires provider only for external-provider candidates', async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    return { text: golden, finishReason: 'stop' };
  };

  await assert.rejects(
    () => runSerializerCandidateBenchmark(
      eligibleFixture(),
      { ...localCandidate, kind: 'EXTERNAL_PROVIDER' },
      execute,
    ),
    /SERIALIZER_CANDIDATE_INVALID/,
  );
  await assert.rejects(
    () => runSerializerCandidateBenchmark(
      eligibleFixture(),
      { ...localCandidate, provider: 'must-not-exist' },
      execute,
    ),
    /SERIALIZER_CANDIDATE_INVALID/,
  );
  assert.equal(calls, 0);
});

test('measurement scalar boundaries reject non-finite or negative values but accept zero', async () => {
  const invalidMeasurements = [
    { coldStartMs: -1 },
    { coldStartMs: Number.NaN },
    { coldStartMs: Number.POSITIVE_INFINITY },
    { peakRssBytes: -1 },
    { peakRssBytes: Number.NaN },
    { peakRssBytes: Number.POSITIVE_INFINITY },
    { usage: { inputTokens: -1 } },
    { usage: { outputTokens: Number.NaN } },
    { usage: { totalTokens: Number.POSITIVE_INFINITY } },
    { usage: { inputTokens: 1, outputTokens: -1 } },
  ];

  for (const measurement of invalidMeasurements) {
    const ticks = [1, 2];
    const result = await runSerializerCandidateBenchmark(
      eligibleFixture(),
      localCandidate,
      async () => ({ text: golden, finishReason: 'stop', measurement }),
      { nowMs: () => ticks.shift() },
    );
    assert.equal(result.outcome, 'MEASUREMENT_INVALID');
  }

  const ticks = [3, 3];
  const zero = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => ({
      text: golden,
      finishReason: 'stop',
      measurement: {
        coldStartMs: 0,
        peakRssBytes: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
        },
      },
    }),
    { nowMs: () => ticks.shift() },
  );
  assert.equal(zero.outcome, 'EVALUATED');
  assert.equal(zero.wallTimeMs, 0);
  assert.equal(zero.measurement.coldStartMs, 0);
  assert.equal(zero.measurement.peakRssBytes, 0);
  assert.equal(zero.measurement.usage.totalTokens, 0);

  const emptyMeasurementTicks = [5, 6];
  const emptyMeasurement = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => ({ text: golden, finishReason: 'stop', measurement: {} }),
    { nowMs: () => emptyMeasurementTicks.shift() },
  );
  assert.equal(emptyMeasurement.outcome, 'EVALUATED');
  assert.equal(emptyMeasurement.measurement.usage, null);
});

test('cost observation validates amount currency and source independently and accepts observed zero cost', async () => {
  const invalidCosts = [
    { amount: Number.NaN, currency: 'USD', source: 'meter' },
    { amount: Number.POSITIVE_INFINITY, currency: 'USD', source: 'meter' },
    { amount: -0.01, currency: 'USD', source: 'meter' },
    { amount: 1, currency: '   ', source: 'meter' },
    { amount: 1, currency: 'USD', source: '   ' },
  ];

  for (const cost of invalidCosts) {
    const ticks = [10, 11];
    const result = await runSerializerCandidateBenchmark(
      eligibleFixture(),
      localCandidate,
      async () => ({ text: golden, finishReason: 'stop', measurement: { cost } }),
      { nowMs: () => ticks.shift() },
    );
    assert.equal(result.outcome, 'MEASUREMENT_INVALID');
  }

  const ticks = [20, 21];
  const zero = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => ({
      text: golden,
      finishReason: 'stop',
      measurement: { cost: { amount: 0, currency: 'USD', source: 'observed-free-tier' } },
    }),
    { nowMs: () => ticks.shift() },
  );
  assert.equal(zero.outcome, 'EVALUATED');
  assert.deepEqual(zero.measurement.cost, {
    state: 'OBSERVED',
    amount: 0,
    currency: 'USD',
    source: 'observed-free-tier',
  });
});

test('wall-clock evidence fails closed for non-finite or backwards clocks but accepts zero duration', async () => {
  for (const ticks of [
    [Number.NaN, 5],
    [5, Number.NaN],
    [Number.POSITIVE_INFINITY, 5],
    [5, Number.POSITIVE_INFINITY],
    [6, 5],
  ]) {
    const values = [...ticks];
    const result = await runSerializerCandidateBenchmark(
      eligibleFixture(),
      localCandidate,
      async () => ({ text: golden, finishReason: 'stop' }),
      { nowMs: () => values.shift() },
    );
    assert.equal(result.outcome, 'MEASUREMENT_INVALID');
    assert.equal(result.wallTimeMs, null);
  }

  const equal = [7, 7];
  const result = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => ({ text: golden, finishReason: 'stop' }),
    { nowMs: () => equal.shift() },
  );
  assert.equal(result.outcome, 'EVALUATED');
  assert.equal(result.wallTimeMs, 0);
});

test('external-provider call accounting survives execution and measurement failure paths', async () => {
  const externalCandidate = {
    id: 'external-failure',
    kind: 'EXTERNAL_PROVIDER',
    host: 'EXE_DEV',
    provider: 'fixture-provider',
    model: 'fixture/model',
  };

  const failedTicks = [1, 2];
  const failed = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    externalCandidate,
    async () => {
      throw new Error('fixture failure');
    },
    { nowMs: () => failedTicks.shift() },
  );
  assert.equal(failed.outcome, 'EXECUTION_FAILED');
  assert.equal(failed.externalProviderCalls, 1);

  const invalidTicks = [3, 4];
  const invalid = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    externalCandidate,
    async () => ({
      text: golden,
      finishReason: 'stop',
      measurement: { coldStartMs: -1 },
    }),
    { nowMs: () => invalidTicks.shift() },
  );
  assert.equal(invalid.outcome, 'MEASUREMENT_INVALID');
  assert.equal(invalid.externalProviderCalls, 1);

  const localFailedTicks = [5, 6];
  const localFailed = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => {
      throw new Error('fixture failure');
    },
    { nowMs: () => localFailedTicks.shift() },
  );
  assert.equal(localFailed.externalProviderCalls, 0);

  const localInvalidTicks = [7, 8];
  const localInvalid = await runSerializerCandidateBenchmark(
    eligibleFixture(),
    localCandidate,
    async () => ({
      text: golden,
      finishReason: 'stop',
      measurement: { coldStartMs: -1 },
    }),
    { nowMs: () => localInvalidTicks.shift() },
  );
  assert.equal(localInvalid.externalProviderCalls, 0);
});
