import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateSerializerFixture } from '../src/dreaming/serializer-benchmark.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'serializer-benchmark-synthetic',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [{
    sourceRef: 'fixture:source:1',
    evidenceHash: 'sha256:fixture-source-1',
    text: 'Synthetic observation: one request timed out.',
  }],
};
const golden = JSON.stringify({
  schema: 'theseus.dreaming-worker.proposals.v1',
  proposals: [{
    type: 'FACT',
    claim: 'One synthetic request timed out.',
    source_refs: [{ source_ref: 'fixture:source:1', evidence_hash: 'sha256:fixture-source-1' }],
  }],
});

const completeRaw = 'FACT: One synthetic request timed out. Source ref: fixture:source:1. Evidence hash: sha256:fixture-source-1.';

function fixture(overrides = {}) {
  return {
    id: 'synthetic-format-only',
    packet,
    reasoner: {
      rawOutput: completeRaw,
      finishReason: 'stop',
      recovery: {
        classification: 'UNSTRUCTURED_COMPLETE',
        serializerEligible: true,
        rawModelOutput: completeRaw,
      },
    },
    goldenOutput: golden,
    ...overrides,
  };
}

test('serializer benchmark accepts a deterministic exact golden output but never claims real-world truth', () => {
  const result = evaluateSerializerFixture(fixture(), golden);
  assert.equal(result.outcome, 'EXACT_GOLDEN_MATCH');
  assert.equal(result.goldenComparison, 'EXACT_STRUCTURED_MATCH');
  assert.equal(result.externalModelCalls, 0);
  assert.equal(result.canonicalWrites, 0);
  assert.match(result.rawOutputFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.candidateOutputFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('serializer benchmark rejects schema-valid but semantically changed golden claim', () => {
  const changed = JSON.stringify({
    ...JSON.parse(golden),
    proposals: [{
      ...JSON.parse(golden).proposals[0],
      claim: 'Two synthetic requests timed out.',
    }],
  });
  const result = evaluateSerializerFixture(fixture(), changed);
  assert.equal(result.outcome, 'GOLDEN_MISMATCH');
  assert.equal(result.goldenComparison, 'DIFFERENT');
});

test('serializer benchmark rejects invented evidence even when shape is correct', () => {
  const invented = JSON.stringify({
    ...JSON.parse(golden),
    proposals: [{
      ...JSON.parse(golden).proposals[0],
      source_refs: [{ source_ref: 'fixture:invented', evidence_hash: 'sha256:invented' }],
    }],
  });
  assert.equal(evaluateSerializerFixture(fixture(), invented).outcome, 'PROVENANCE_REJECTED');
});

test('serializer benchmark rejects invalid JSON and invalid schema distinctly', () => {
  assert.equal(evaluateSerializerFixture(fixture(), '{').outcome, 'INVALID_JSON');
  assert.equal(evaluateSerializerFixture(fixture(), '{}').outcome, 'INVALID_SCHEMA');
});

test('serializer benchmark refuses semantic invalid, truncation, and missing completion evidence before candidate evaluation', () => {
  for (const reasoner of [
    { rawOutput: golden, finishReason: 'stop', recovery: { classification: 'SEMANTIC_INVALID', serializerEligible: false, rawModelOutput: null } },
    { rawOutput: '{', finishReason: 'length', recovery: { classification: 'TRUNCATED_OUTPUT', serializerEligible: false, rawModelOutput: null } },
    { rawOutput: golden, recovery: { classification: 'SCHEMA_MISMATCH_COMPLETE', serializerEligible: true, rawModelOutput: golden } },
    { rawOutput: golden, finishReason: 'stop', recovery: { classification: 'SCHEMA_MISMATCH_COMPLETE', serializerEligible: true, rawModelOutput: 'forged' } },
  ]) {
    const result = evaluateSerializerFixture(fixture({ reasoner }), golden);
    assert.equal(result.outcome, 'NOT_ELIGIBLE');
    assert.equal(result.candidateOutputFingerprint, null);
  }
});

test('serializer benchmark requires independent agreement of eligibility flag and recovery classification', () => {
  const contradictory = [
    { classification: 'UNSTRUCTURED_COMPLETE', serializerEligible: false },
    { classification: 'SCHEMA_MISMATCH_COMPLETE', serializerEligible: false },
    { classification: 'SEMANTIC_INVALID', serializerEligible: true },
    { classification: 'TRUNCATED_OUTPUT', serializerEligible: true },
  ];
  for (const { classification, serializerEligible } of contradictory) {
    const reasoner = {
      rawOutput: completeRaw,
      finishReason: 'stop',
      recovery: {
        classification,
        serializerEligible,
        rawModelOutput: completeRaw,
      },
    };
    const result = evaluateSerializerFixture(fixture({ reasoner }), golden);
    assert.equal(result.outcome, 'NOT_ELIGIBLE', classification);
    assert.equal(result.candidateOutputFingerprint, null, classification);
  }
});

test('serializer benchmark declines to assert semantic preservation if no golden oracle exists', () => {
  const result = evaluateSerializerFixture(fixture({ goldenOutput: null }), golden);
  assert.equal(result.outcome, 'SCHEMA_VALID_UNREVIEWED');
  assert.equal(result.goldenComparison, 'NOT_AVAILABLE');
});

test('versioned synthetic benchmark fixtures yield stable reference outcomes', async () => {
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../fixtures/serializer/contract-v1.json', import.meta.url));
  const corpus = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(corpus.schema, 'theseus.dreaming-worker.serializer-fixtures.v1');
  assert.equal(corpus.cases.length, 8);

  for (const item of corpus.cases) {
    const benchmarkFixture = {
      id: item.id,
      packet: corpus.packet,
      reasoner: {
        rawOutput: item.reasonerRaw,
        finishReason: item.finishReason,
        recovery: {
          classification: item.classification,
          serializerEligible: item.serializerEligible,
          rawModelOutput: item.serializerEligible ? item.reasonerRaw : null,
        },
      },
      goldenOutput: item.oracle === 'none' ? null : corpus.goldenOutput,
    };
    const candidate = item.candidate === 'golden' ? corpus.goldenOutput : item.candidate;
    const result = evaluateSerializerFixture(benchmarkFixture, candidate);
    assert.equal(result.outcome, item.expected, item.id);
    assert.equal(result.externalModelCalls, 0, item.id);
    assert.equal(result.canonicalWrites, 0, item.id);
  }
});

test('positive v1 corpus oracles require only semantic fields present in the frozen raw input', () => {
  const corpus = JSON.parse(readFileSync(new URL('../fixtures/serializer/contract-v1.json', import.meta.url), 'utf8'));
  const oracle = JSON.parse(corpus.goldenOutput);
  const positives = corpus.cases.filter(item => item.expected === 'EXACT_GOLDEN_MATCH');
  assert.ok(positives.length > 0);
  for (const item of positives) {
    for (const proposal of oracle.proposals) {
      for (const value of [proposal.type, proposal.claim, ...proposal.source_refs.flatMap(ref => [ref.source_ref, ref.evidence_hash])]) {
        assert.ok(item.reasonerRaw.includes(value), item.id + ': missing frozen semantic field ' + value);
      }
    }
  }
});
