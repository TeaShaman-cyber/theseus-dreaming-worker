import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLedgerEvent,
  createProposalRecord,
  createSupersessionEvent,
  materializeLedger,
} from '../src/dreaming/proposal-ledger.ts';

const routeA = { id: 'route-a', provider: 'provider-a', model: 'model-a', modelFamily: 'family-a' };
const routeB = { id: 'route-b', provider: 'provider-b', model: 'model-b', modelFamily: 'family-b' };

const hypothesisA = {
  type: 'HYPOTHESIS',
  claim: 'Timeouts correlate with provider saturation.',
  why_plausible: 'The failures cluster around high observed latency.',
  source_refs: [{ source_ref: 'fixture:1', evidence_hash: 'sha256:e1' }],
  falsifier: 'Timeout rate remains unchanged under low provider load.',
  required_evidence: ['Provider-side latency and saturation traces.'],
  competing_explanations: ['Client network instability.'],
  uncertainty: 'MEDIUM',
};

const hypothesisB = {
  ...hypothesisA,
  claim: 'Timeouts correlate with client-side connection churn.',
  why_plausible: 'Failures coincide with reconnect bursts.',
  falsifier: 'Timeouts persist when connection reuse is stable.',
  required_evidence: ['Connection reuse and retry traces.'],
  competing_explanations: ['Provider saturation.'],
};

function origin(perspectiveId, route) {
  return {
    packetId: 'packet-001',
    evidenceFingerprint: 'sha256:evidence',
    requestFingerprint: 'sha256:request',
    perspectiveId,
    route,
  };
}

test('proposal records are deterministic derived-only immutable snapshots', () => {
  const first = createProposalRecord({ proposal: hypothesisA, origin: origin('route-a', routeA) });
  const second = createProposalRecord({ proposal: structuredClone(hypothesisA), origin: origin('route-a', { ...routeA }) });

  assert.equal(first.recordId, second.recordId);
  assert.equal(first.authority, 'DERIVED_ONLY');
  assert.equal(first.proposal.type, 'HYPOTHESIS');
  assert.equal(first.proposal.falsifier, hypothesisA.falsifier);
  assert.deepEqual(first.proposal.required_evidence, hypothesisA.required_evidence);

  hypothesisA.claim = 'mutated caller object';
  assert.notEqual(first.proposal.claim, hypothesisA.claim);
});

test('append-only ledger preserves history and derives superseded state without overwrite', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'A' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'B' }, origin: origin('route-b', routeB) });

  let ledger = [];
  ledger = appendLedgerEvent(ledger, a);
  ledger = appendLedgerEvent(ledger, b);
  const beforeSupersession = structuredClone(ledger);
  const supersede = createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'New contradictory evidence requires a newer candidate.' });
  const next = appendLedgerEvent(ledger, supersede);

  assert.deepEqual(ledger, beforeSupersession);
  assert.equal(next.length, 3);

  const view = materializeLedger(next);
  assert.equal(view.records.length, 2);
  assert.equal(view.records.find(item => item.record.recordId === a.recordId).state, 'SUPERSEDED');
  assert.deepEqual(view.records.find(item => item.record.recordId === a.recordId).supersededBy, [b.recordId]);
  assert.equal(view.records.find(item => item.record.recordId === b.recordId).state, 'ACTIVE');
  assert.equal(view.events.length, 3);
});

test('duplicate event ids fail closed', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'duplicate' }, origin: origin('route-a', routeA) });
  const ledger = appendLedgerEvent([], a);
  assert.throws(() => appendLedgerEvent(ledger, a), /LEDGER_DUPLICATE_EVENT/);
});

test('supersession requires two existing distinct proposal records', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'A2' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'B2' }, origin: origin('route-b', routeB) });
  const onlyA = appendLedgerEvent([], a);

  assert.throws(
    () => appendLedgerEvent(onlyA, createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'missing replacement' })),
    /LEDGER_SUPERSESSION_REF_MISSING/,
  );
  assert.throws(
    () => createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: a.recordId, reason: 'self' }),
    /LEDGER_SELF_SUPERSESSION/,
  );
});

test('supersession cycles fail closed', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'cycle-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'cycle-b' }, origin: origin('route-b', routeB) });
  let ledger = appendLedgerEvent([], a);
  ledger = appendLedgerEvent(ledger, b);
  ledger = appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'A -> B' }));

  assert.throws(
    () => appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: b.recordId, replacementRecordId: a.recordId, reason: 'B -> A' })),
    /LEDGER_SUPERSESSION_CYCLE/,
  );
});

test('content-addressed ids are revalidated on append and tampering fails closed', () => {
  const record = createProposalRecord({ proposal: { ...hypothesisA, claim: 'tamper-record' }, origin: origin('route-a', routeA) });
  assert.throws(
    () => appendLedgerEvent([], { ...record, recordId: 'sha256:forged' }),
    /LEDGER_EVENT_ID_MISMATCH/,
  );

  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'tamper-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'tamper-b' }, origin: origin('route-b', routeB) });
  let ledger = appendLedgerEvent([], a);
  ledger = appendLedgerEvent(ledger, b);
  const supersede = createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'tamper relation' });
  assert.throws(
    () => appendLedgerEvent(ledger, { ...supersede, eventId: 'sha256:forged' }),
    /LEDGER_EVENT_ID_MISMATCH/,
  );
});


function canonicalizeForTest(value) {
  if (Array.isArray(value)) return value.map(canonicalizeForTest);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalizeForTest(item)]),
    );
  }
  return value;
}

function contentIdForTest(payload) {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canonicalizeForTest(payload))).digest('hex');
}

test('proposal fingerprint is independently revalidated even when outer record id is valid', () => {
  const record = createProposalRecord({ proposal: { ...hypothesisB, claim: 'fingerprint-forgery' }, origin: origin('route-b', routeB) });
  const forgedPayload = { ...record, proposalFingerprint: 'sha256:wrong' };
  const { recordId: _old, ...payloadWithoutId } = forgedPayload;
  const forged = { ...forgedPayload, recordId: contentIdForTest(payloadWithoutId) };

  assert.throws(
    () => appendLedgerEvent([], forged),
    /LEDGER_PROPOSAL_FINGERPRINT_MISMATCH/,
  );
});
