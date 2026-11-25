import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

import { runCheckpointedPilot2 } from '../src/dreaming/checkpoint-pilot2.ts';

const packet = {
  schema: 'theseus-evidence-packet-v1',
  packetId: 'fixture-1',
  acceptedNewEvidence: true,
  coverage: { state: 'PARTIAL', currentness: 'UNKNOWN' },
  evidence: [{ sourceRef: 'fixture:1', evidenceHash: 'sha256:fixture-1', text: 'A synthetic timeout occurred.' }],
};
const request = { scope: 'SYNTHETIC_FIXTURE', task: 'Analyze the timeout.', packet };
const hash = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const input = {
  request,
  acceptedSourceFingerprint: 'sha256:' + 'a'.repeat(64),
  analysisVersion: 'analysis-v1',
  checkpoint: { status: 'AVAILABLE', committed: null },
};

function adapters({ fail = [], finishReason = 'stop', onInput = () => {} } = {}) {
  const calls = [];
  const routes = ['a', 'b'].map(id => ({
    id,
    provider: 'provider-' + id,
    model: 'model-' + id,
    modelFamily: 'family-' + id,
    infer: async (seen, correlation) => {
      calls.push({ id, correlation });
      onInput(seen);
      if (fail.includes(id)) throw new Error('synthetic provider failure');
      return {
        text: JSON.stringify({
          schema: 'theseus.dreaming-worker.proposals.v1',
          proposals: [{
            type: 'FACT',
            claim: 'A synthetic timeout occurred.',
            source_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:fixture-1' }],
          }],
        }),
        provider: 'provider-' + id,
        model: 'model-' + id,
        finishReason,
        toolCalls: [],
      };
    },
  }));
  return { routes, calls };
}

test('complete bounded analysis yields only a checkpoint candidate; repeats skip even with a new packet ID', async () => {
  const { routes, calls } = adapters();
  const first = await runCheckpointedPilot2(input, routes);
  assert.equal(first.decision, 'ANALYZED');
  assert.equal(first.analysis.outcome, 'COMPLETE');
  assert.equal(calls.length, 2);
  assert.equal(first.checkpointCandidate.workFingerprint, first.workFingerprint);
  assert.equal(first.checkpointCandidate.requestFingerprint, first.analysis.receipt.requestFingerprint);
  assert.equal(first.workFingerprint, hash({
    schema: 'theseus.dreaming-worker.work-identity.v1',
    acceptedSourceFingerprint: input.acceptedSourceFingerprint,
    analysisVersion: input.analysisVersion,
    scope: request.scope,
    task: request.task,
    coverage: packet.coverage,
    evidence: packet.evidence,
  }));
  assert.deepEqual(first.checkpointCandidate, {
    schema: 'theseus.dreaming-worker.checkpoint.v1',
    workFingerprint: first.workFingerprint,
    requestFingerprint: first.analysis.receipt.requestFingerprint,
    resultFingerprint: hash(first.analysis),
  });
  assert.equal(first.attemptedPasses, 2);
  assert.equal(first.checkpointPersisted, false);

  const repeated = await runCheckpointedPilot2({
    ...input,
    request: { ...request, packet: { ...packet, packetId: 'new-transient-id' } },
    checkpoint: { status: 'AVAILABLE', committed: first.checkpointCandidate },
  }, routes);
  assert.equal(repeated.decision, 'ALREADY_PROCESSED');
  assert.equal(repeated.workFingerprint, first.workFingerprint);
  assert.equal(repeated.analysis, null);
  assert.equal(repeated.checkpointCandidate, null);
  assert.equal(repeated.attemptedPasses, 0);
  assert.equal(calls.length, 2);
});

test('new source, task, analysis version, payload or coverage does not reuse a previous checkpoint', async () => {
  const { routes, calls } = adapters();
  const first = await runCheckpointedPilot2(input, routes);
  const prior = { status: 'AVAILABLE', committed: first.checkpointCandidate };
  for (const change of [
    { acceptedSourceFingerprint: 'sha256:' + 'b'.repeat(64) },
    { analysisVersion: 'analysis-v2' },
    { request: { ...request, task: 'A different task.' } },
    { request: { ...request, scope: 'PUBLICATION_SAFE' } },
    { request: { ...request, packet: { ...packet, evidence: [{ ...packet.evidence[0], text: 'Changed payload.' }] } } },
    { request: { ...request, packet: { ...packet, coverage: { state: 'COMPLETE', currentness: 'CURRENT' } } } },
  ]) {
    const result = await runCheckpointedPilot2({ ...input, ...change, checkpoint: prior }, routes);
    assert.equal(result.decision, 'ANALYZED');
    assert.notEqual(result.workFingerprint, first.workFingerprint);
    assert.ok(result.checkpointCandidate);
  }
  assert.equal(calls.length, 14);
});

test('unavailable checkpoint and incomplete empty intake never invoke models or assert absence', async () => {
  const { routes, calls } = adapters();
  const cases = [
    [{ ...input, checkpoint: { status: 'UNAVAILABLE' } }, 'CHECKPOINT_UNAVAILABLE'],
    [{ ...input, request: { ...request, packet: { ...packet, acceptedNewEvidence: false, evidence: [] } } }, 'INTAKE_UNKNOWN'],
    [{ ...input, request: { ...request, packet: { ...packet, evidence: [], coverage: { state: 'COMPLETE', currentness: 'CURRENT' } } } }, 'INTAKE_UNKNOWN'],
    [{ ...input, request: { ...request, packet: { ...packet, acceptedNewEvidence: false, evidence: [], coverage: { state: 'COMPLETE', currentness: 'CURRENT' } } } }, 'NO_DATA'],
    [{ ...input, request: { ...request, packet: { ...packet, acceptedNewEvidence: false, coverage: { state: 'COMPLETE', currentness: 'CURRENT' } } } }, 'NO_DATA'],
  ];
  for (const [candidate, decision] of cases) {
    const result = await runCheckpointedPilot2(candidate, routes);
    assert.equal(result.decision, decision);
    assert.equal(result.attemptedPasses, 0);
    assert.equal(result.analysis, null);
    assert.equal(result.checkpointCandidate, null);
    assert.equal(result.checkpointPersisted, false);
  }
  assert.equal(calls.length, 0);
});

test('ambiguous provenance, invalid scope, invalid checkpoint and malformed coverage fail before inference', async () => {
  const { routes, calls } = adapters();
  for (const candidate of [
    { ...input, acceptedSourceFingerprint: 'unverified' },
    { ...input, acceptedSourceFingerprint: 'sha256:' + 'A'.repeat(64) },
    { ...input, acceptedSourceFingerprint: 'sha256:' + 'a'.repeat(63) },
    { ...input, acceptedSourceFingerprint: 'sha256:' + 'g'.repeat(64) },
    { ...input, acceptedSourceFingerprint: 'xsha256:' + 'a'.repeat(64) },
    { ...input, acceptedSourceFingerprint: 'sha256:' + 'a'.repeat(64) + 'x' },
    { ...input, analysisVersion: ' ' },
    { ...input, request: { ...request, task: ' ' } },
    { ...input, request: { ...request, packet: { ...packet, packetId: ' ' } } },
    { ...input, request: { ...request, packet: { ...packet, evidence: [{ ...packet.evidence[0], text: ' ' }] } } },
    { ...input, request: { ...request, packet: { ...packet, evidence: [{ ...packet.evidence[0], sourceRef: ' ' }] } } },
    { ...input, request: { ...request, packet: { ...packet, evidence: [{ ...packet.evidence[0], evidenceHash: ' ' }] } } },
    { ...input, request: { ...request, packet: { ...packet, schema: 'bad-schema' } } },
    { ...input, checkpoint: { status: 'UNAVAILABLE', committed: null } },
    { ...input, request: { ...request, packet: { ...packet, coverage: { ...packet.coverage, unknown: true } } } },
    { ...input, request: { ...request, packet: { ...packet, evidence: [{ ...packet.evidence[0], extra: true }] } } },
    { ...input, request: { ...request, extra: true } },
    { ...input, extra: true },
    { ...input, checkpoint: { status: 'AVAILABLE' } },
    { ...input, checkpoint: { status: 'AVAILABLE', committed: { workFingerprint: 'unverified' } } },
    { ...input, request: { ...request, scope: 'PRIVATE' } },
    { ...input, request: { ...request, packet: { ...packet, coverage: { state: 'COMPLETE', currentness: 'MAYBE' } } } },
    { ...input, request: { ...request, packet: { ...packet, evidence: [packet.evidence[0], { ...packet.evidence[0], evidenceHash: 'different' }] } } },
    { ...input, request: { ...request, packet: { ...packet, acceptedNewEvidence: 'false' } } },
  ]) {
    await assert.rejects(runCheckpointedPilot2(candidate, routes));
  }
  assert.equal(calls.length, 0);
});

test('partial, failed and completion-unknown analyses never yield a checkpoint candidate', async () => {
  for (const [options, outcome] of [
    [{ fail: ['b'] }, 'PARTIAL'],
    [{ fail: ['a', 'b'] }, 'FAIL_CLOSED'],
    [{ finishReason: null }, 'COMPLETE'],
  ]) {
    const { routes, calls } = adapters(options);
    const result = await runCheckpointedPilot2(input, routes);
    assert.equal(result.decision, 'ANALYZED');
    assert.equal(result.analysis.outcome, outcome);
    assert.equal(result.checkpointCandidate, null);
    assert.equal(result.checkpointPersisted, false);
    assert.equal(calls.length, 2);
  }
});

test('the admitted evidence snapshot is frozen before both adapters see it', async () => {
  const seen = [];
  const { routes } = adapters({ onInput(value) {
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.packet));
    assert.ok(Object.isFrozen(value.packet.coverage));
    assert.ok(Object.isFrozen(value.packet.evidence));
    assert.ok(Object.isFrozen(value.packet.evidence[0]));
    seen.push(value.packet.evidence[0].text);
  } });
  const result = await runCheckpointedPilot2(input, routes);
  assert.equal(result.analysis.outcome, 'COMPLETE');
  assert.deepEqual(seen, [packet.evidence[0].text, packet.evidence[0].text]);
});

test('invalid route plan yields no checkpoint candidate and no model calls', async () => {
  const result = await runCheckpointedPilot2(input, []);
  assert.equal(result.analysis.outcome, 'FAIL_CLOSED');
  assert.equal(result.attemptedPasses, 0);
  assert.equal(result.checkpointCandidate, null);
  assert.equal(result.checkpointPersisted, false);
});

test('checkpoint schema and exact evidence ordering are checked without inventing authority', async () => {
  const { routes, calls } = adapters();
  const first = await runCheckpointedPilot2(input, routes);
  for (const [key, value] of [
    ['schema', 'bad-schema'],
    ['workFingerprint', 'bad'],
    ['requestFingerprint', 'bad'],
    ['resultFingerprint', 'bad'],
    ['extra', true],
  ]) {
    await assert.rejects(runCheckpointedPilot2({
      ...input,
      checkpoint: { status: 'AVAILABLE', committed: { ...first.checkpointCandidate, [key]: value } },
    }, routes));
  }
  assert.equal(calls.length, 2);

  const item = { sourceRef: 'fixture:2', evidenceHash: 'sha256:fixture-2', text: 'Second fixture.' };
  const expanded = await runCheckpointedPilot2({
    ...input, request: { ...request, packet: { ...packet, evidence: [packet.evidence[0], item] } },
  }, routes);
  const reordered = await runCheckpointedPilot2({
    ...input,
    request: { ...request, packet: { ...packet, evidence: [item, packet.evidence[0]] } },
    checkpoint: { status: 'AVAILABLE', committed: expanded.checkpointCandidate },
  }, routes);
  assert.notEqual(expanded.workFingerprint, reordered.workFingerprint);
  assert.equal(reordered.decision, 'ANALYZED');
});
