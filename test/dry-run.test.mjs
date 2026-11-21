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
  assert.match(result.receipt.inputFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('partial coverage explicitly blocks absence claims', () => {
  const result = runPilot0(packet);

  assert.ok(
    result.proposals.some(
      proposal =>
        proposal.type === 'UNKNOWN' &&
        proposal.code === 'ABSENCE_NOT_JUSTIFIED_BY_PARTIAL_COVERAGE',
    ),
  );
});

test('no accepted new evidence produces NO_DATA and zero external calls', () => {
  const result = runPilot0({
    ...packet,
    packetId: 'fixture-no-data-001',
    acceptedNewEvidence: false,
    evidence: [],
  });

  assert.equal(result.outcome, 'NO_DATA');
  assert.deepEqual(result.proposals, []);
  assert.equal(result.receipt.externalModelCalls, 0);
  assert.equal(result.receipt.evidenceCount, 0);
});

test('evidence without provenance is rejected', () => {
  assert.throws(
    () =>
      runPilot0({
        ...packet,
        evidence: [{ text: 'Synthetic evidence without source identity.' }],
      }),
    /sourceRef.*evidenceHash/i,
  );
});
