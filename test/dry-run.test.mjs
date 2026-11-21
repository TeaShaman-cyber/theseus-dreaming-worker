import test from 'node:test';
import assert from 'node:assert/strict';

import { runPilot0 } from '../src/dreaming/dry-run.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-partial-001',
  acceptedNewEvidence: true,
  coverage: {
    state: 'PARTIAL',
    currentness: 'UNKNOWN',
  },
  evidence: [
    {
      sourceRef: 'fixture:message:1',
      evidenceHash: 'sha256:fixture-message-1',
      text: 'Synthetic evidence: a worker timed out after a provider request.',
    },
  ],
};

test('Pilot 0 processes accepted evidence without external calls', () => {
  const result = runPilot0(packet);

  assert.equal(result.outcome, 'PROCESSED');
  assert.equal(result.receipt.externalModelCalls, 0);
  assert.equal(result.receipt.evidenceCount, 1);
  assert.equal(result.receipt.coverageState, 'PARTIAL');
  assert.equal(result.receipt.currentness, 'UNKNOWN');
  assert.equal(result.receipt.packetId, 'fixture-partial-001');
  assert.equal(result.receipt.contractVersion, 'theseus-dreaming-worker-goal-v1');
  assert.equal(
    result.receipt.inputFingerprint,
    'sha256:a75ca1b8936f20c18ba1c99ce94f9f2301ca34181c276c4aea0b7ee3e2c9fed2',
  );

  const fact = result.proposals.find(proposal => proposal.type === 'FACT');
  assert.ok(fact);
  assert.equal(fact.code, 'EVIDENCE_PACKET_ACCEPTED');
  assert.deepEqual(fact.sourceRefs, ['fixture:message:1']);
  assert.match(fact.claim, /1 provenance-bearing evidence item/);
});

test('fingerprint is stable across object key ordering', () => {
  const reordered = {
    evidence: packet.evidence,
    coverage: {
      currentness: 'UNKNOWN',
      state: 'PARTIAL',
    },
    acceptedNewEvidence: true,
    packetId: 'fixture-partial-001',
    schema: 'theseus-evidence-packet-v1',
  };

  assert.equal(
    runPilot0(reordered).receipt.inputFingerprint,
    runPilot0(packet).receipt.inputFingerprint,
  );
});

test('partial or non-current coverage explicitly blocks absence claims', () => {
  for (const coverage of [
    { state: 'PARTIAL', currentness: 'CURRENT' },
    { state: 'COMPLETE', currentness: 'STALE' },
    { state: 'COMPLETE', currentness: 'UNKNOWN' },
  ]) {
    const result = runPilot0({ ...packet, coverage });
    const unknown = result.proposals.find(proposal => proposal.type === 'UNKNOWN');

    assert.ok(unknown);
    assert.equal(unknown.code, 'ABSENCE_NOT_JUSTIFIED_BY_PARTIAL_COVERAGE');
    assert.deepEqual(unknown.sourceRefs, ['fixture:message:1']);
    assert.ok(unknown.claim.length > 0);
  }
});

test('complete and current coverage does not emit an absence warning', () => {
  const result = runPilot0({
    ...packet,
    coverage: { state: 'COMPLETE', currentness: 'CURRENT' },
  });

  assert.equal(result.outcome, 'PROCESSED');
  assert.equal(result.proposals.filter(proposal => proposal.type === 'UNKNOWN').length, 0);
  assert.equal(result.proposals.filter(proposal => proposal.type === 'FACT').length, 1);
});

test('acceptedNewEvidence=false produces NO_DATA even when evidence is present', () => {
  const result = runPilot0({
    ...packet,
    packetId: 'fixture-no-data-accepted-flag',
    acceptedNewEvidence: false,
  });

  assert.equal(result.outcome, 'NO_DATA');
  assert.deepEqual(result.proposals, []);
  assert.equal(result.receipt.externalModelCalls, 0);
  assert.equal(result.receipt.evidenceCount, 1);
});

test('an empty evidence packet produces NO_DATA even when accepted flag is true', () => {
  const result = runPilot0({
    ...packet,
    packetId: 'fixture-no-data-empty',
    acceptedNewEvidence: true,
    evidence: [],
  });

  assert.equal(result.outcome, 'NO_DATA');
  assert.deepEqual(result.proposals, []);
  assert.equal(result.receipt.evidenceCount, 0);
});

test('unsupported schema is rejected', () => {
  assert.throws(
    () => runPilot0({ ...packet, schema: 'wrong-schema' }),
    /unsupported evidence packet schema/,
  );
});

test('missing packetId is rejected', () => {
  assert.throws(
    () => runPilot0({ ...packet, packetId: '' }),
    /packetId is required/,
  );
});

test('missing sourceRef is rejected', () => {
  assert.throws(
    () =>
      runPilot0({
        ...packet,
        evidence: [
          {
            sourceRef: '',
            evidenceHash: 'sha256:fixture-message-1',
            text: 'Synthetic evidence.',
          },
        ],
      }),
    /sourceRef.*evidenceHash/i,
  );
});

test('missing evidenceHash is rejected', () => {
  assert.throws(
    () =>
      runPilot0({
        ...packet,
        evidence: [
          {
            sourceRef: 'fixture:message:1',
            evidenceHash: '',
            text: 'Synthetic evidence.',
          },
        ],
      }),
    /sourceRef.*evidenceHash/i,
  );
});

test('missing evidence text is rejected', () => {
  assert.throws(
    () =>
      runPilot0({
        ...packet,
        evidence: [
          {
            sourceRef: 'fixture:message:1',
            evidenceHash: 'sha256:fixture-message-1',
            text: '',
          },
        ],
      }),
    /text is required/,
  );
});

test('all accepted source references survive into the proposal', () => {
  const result = runPilot0({
    ...packet,
    evidence: [
      packet.evidence[0],
      {
        sourceRef: 'fixture:message:2',
        evidenceHash: 'sha256:fixture-message-2',
        text: 'Synthetic evidence: retry succeeded.',
      },
    ],
  });

  const fact = result.proposals.find(proposal => proposal.type === 'FACT');
  assert.ok(fact);
  assert.deepEqual(fact.sourceRefs, ['fixture:message:1', 'fixture:message:2']);
  assert.match(fact.claim, /2 provenance-bearing evidence item/);
});

test('fingerprint preserves boundaries between multiple evidence items', () => {
  const result = runPilot0({
    schema: 'theseus-evidence-packet-v1',
    packetId: 'fixture-two-items',
    acceptedNewEvidence: true,
    coverage: { state: 'COMPLETE', currentness: 'CURRENT' },
    evidence: [
      { sourceRef: 'fixture:1', evidenceHash: 'sha256:1', text: 'one' },
      { sourceRef: 'fixture:2', evidenceHash: 'sha256:2', text: 'two' },
    ],
  });

  assert.equal(
    result.receipt.inputFingerprint,
    'sha256:0e6c4063539755fcd04343ef3c98840134d355c10e3902869f422fc2d88ffe48',
  );
});

test('null evidence item is rejected as a provenance error, not a runtime crash', () => {
  assert.throws(
    () =>
      runPilot0({
        ...packet,
        evidence: [null],
      }),
    /sourceRef.*evidenceHash/i,
  );
});
