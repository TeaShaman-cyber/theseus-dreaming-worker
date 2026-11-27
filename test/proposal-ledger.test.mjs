import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLedgerEvent,
  createLedgerReplay,
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
  assert.deepEqual(view.events, next);
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


function contentIdForTest(payload) {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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


test('schema normalization makes record ids stable across caller key insertion order', () => {
  const normal = createProposalRecord({ proposal: { ...hypothesisA, claim: 'order-stable' }, origin: origin('route-a', routeA) });
  const reorderedOrigin = {
    route: { modelFamily: routeA.modelFamily, model: routeA.model, provider: routeA.provider, id: routeA.id },
    perspectiveId: 'route-a',
    requestFingerprint: 'sha256:request',
    evidenceFingerprint: 'sha256:evidence',
    packetId: 'packet-001',
  };
  const reorderedProposal = {
    uncertainty: hypothesisA.uncertainty,
    competing_explanations: [...hypothesisA.competing_explanations],
    required_evidence: [...hypothesisA.required_evidence],
    falsifier: hypothesisA.falsifier,
    source_refs: structuredClone(hypothesisA.source_refs),
    why_plausible: hypothesisA.why_plausible,
    claim: 'order-stable',
    type: 'HYPOTHESIS',
  };
  const reordered = createProposalRecord({ proposal: reorderedProposal, origin: reorderedOrigin });
  assert.equal(reordered.recordId, normal.recordId);
  assert.equal(reordered.proposalFingerprint, normal.proposalFingerprint);
});

test('whitespace-only ledger identity and supersession reason are rejected', () => {
  assert.throws(
    () => createProposalRecord({ proposal: { ...hypothesisA, claim: 'whitespace-origin' }, origin: { ...origin('route-a', routeA), perspectiveId: '   ' } }),
  );
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'whitespace-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'whitespace-b' }, origin: origin('route-b', routeB) });
  assert.throws(
    () => createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: '   ' }),
  );
});

test('append revalidates already-present ledger records before accepting a new event', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'existing-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'existing-b' }, origin: origin('route-b', routeB) });
  const forgedPayload = { ...a, proposalFingerprint: 'sha256:wrong-existing' };
  const { recordId: _old, ...payloadWithoutId } = forgedPayload;
  const forgedExisting = { ...forgedPayload, recordId: contentIdForTest(payloadWithoutId) };
  assert.throws(
    () => appendLedgerEvent([forgedExisting], b),
    /LEDGER_PROPOSAL_FINGERPRINT_MISMATCH/,
  );
});

test('direct self-supersession event fails even when its content id is valid', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'direct-self' }, origin: origin('route-a', routeA) });
  const payload = {
    schema: 'theseus.dreaming-worker.proposal-ledger-supersession.v1',
    eventType: 'SUPERSEDE',
    authority: 'DERIVED_ONLY',
    supersededRecordId: a.recordId,
    replacementRecordId: a.recordId,
    reason: 'direct forged self edge',
  };
  const event = { ...payload, eventId: contentIdForTest(payload) };
  assert.throws(() => appendLedgerEvent([a], event), /LEDGER_SELF_SUPERSESSION/);
});

test('supersession events cannot masquerade as proposal-record references', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'event-ref-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'event-ref-b' }, origin: origin('route-b', routeB) });
  let ledger = appendLedgerEvent([], a);
  ledger = appendLedgerEvent(ledger, b);
  const first = createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'first edge' });
  ledger = appendLedgerEvent(ledger, first);
  const invalid = createSupersessionEvent({ supersededRecordId: b.recordId, replacementRecordId: first.eventId, reason: 'event id is not a proposal record' });
  assert.throws(() => appendLedgerEvent(ledger, invalid), /LEDGER_SUPERSESSION_REF_MISSING/);
});

test('multi-hop supersession cycle is rejected', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'multi-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'multi-b' }, origin: origin('route-b', routeB) });
  const c = createProposalRecord({ proposal: { ...hypothesisA, claim: 'multi-c' }, origin: origin('route-a', routeA) });
  let ledger = appendLedgerEvent([], a);
  ledger = appendLedgerEvent(ledger, b);
  ledger = appendLedgerEvent(ledger, c);
  ledger = appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'A -> B' }));
  ledger = appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: b.recordId, replacementRecordId: c.recordId, reason: 'B -> C' }));
  assert.throws(
    () => appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: c.recordId, replacementRecordId: a.recordId, reason: 'C -> A' })),
    /LEDGER_SUPERSESSION_CYCLE/,
  );
});


test('branching and reconverging supersession history stays bounded during cycle checks', { timeout: 1500 }, () => {
  const records = [];
  for (let i = 0; i < 58; i += 1) {
    records.push(createProposalRecord({
      proposal: { ...hypothesisA, claim: `dag-${i}` },
      origin: origin(i % 2 === 0 ? 'route-a' : 'route-b', i % 2 === 0 ? routeA : routeB),
    }));
  }

  let ledger = [];
  for (const record of records) ledger = appendLedgerEvent(ledger, record);

  // Repeated diamonds: each pair fans out to two successors which reconverge.
  for (let i = 0; i + 3 < records.length; i += 2) {
    const edges = [
      [records[i], records[i + 1]],
      [records[i], records[i + 2]],
      [records[i + 1], records[i + 3]],
      [records[i + 2], records[i + 3]],
    ];
    for (const [from, to] of edges) {
      const event = createSupersessionEvent({
        supersededRecordId: from.recordId,
        replacementRecordId: to.recordId,
        reason: `dag edge ${from.recordId} -> ${to.recordId}`,
      });
      if (!ledger.some(existing => existing.eventType === 'SUPERSEDE' && existing.eventId === event.eventId)) {
        ledger = appendLedgerEvent(ledger, event);
      }
    }
  }

  const view = materializeLedger(ledger);
  assert.equal(view.records.length, records.length);
  assert.equal(view.events.length, ledger.length);
});


test('cycle detection keeps every outgoing branch from the same superseded record', () => {
  const a = createProposalRecord({ proposal: { ...hypothesisA, claim: 'branch-a' }, origin: origin('route-a', routeA) });
  const b = createProposalRecord({ proposal: { ...hypothesisB, claim: 'branch-b' }, origin: origin('route-b', routeB) });
  const c = createProposalRecord({ proposal: { ...hypothesisA, claim: 'branch-c' }, origin: origin('route-a', routeA) });
  let ledger = appendLedgerEvent([], a);
  ledger = appendLedgerEvent(ledger, b);
  ledger = appendLedgerEvent(ledger, c);
  ledger = appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: b.recordId, reason: 'A -> B first branch' }));
  ledger = appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: a.recordId, replacementRecordId: c.recordId, reason: 'A -> C second branch' }));

  assert.throws(
    () => appendLedgerEvent(ledger, createSupersessionEvent({ supersededRecordId: c.recordId, replacementRecordId: a.recordId, reason: 'C -> A closes only the second branch' })),
    /LEDGER_SUPERSESSION_CYCLE/,
  );
});

test('materialization validates a proposal-only history with linear snapshot work',()=>{
  const records=Array.from({length:64},(_,i)=>createProposalRecord({proposal:{...hypothesisA,claim:`linear-${i}`},origin:origin('route-a',routeA)}));
  const clone=globalThis.structuredClone;let copies=0;
  try {
    globalThis.structuredClone=(value,...args)=>{copies++;return clone(value,...args);};
    assert.deepEqual(materializeLedger(records).events,records);
  } finally {globalThis.structuredClone=clone;}
  assert.ok(copies<=4*records.length,`replay copies ${copies} objects for ${records.length} records`);
});

test('ordered replay matches legacy append on branching histories and rejects invalid prefixes',()=>{
  const records=Array.from({length:4},(_,i)=>createProposalRecord({proposal:{...hypothesisA,claim:`replay-${i}`},origin:origin('route-a',routeA)}));
  const edge=(a,b,reason='synthetic')=>createSupersessionEvent({supersededRecordId:records[a].recordId,replacementRecordId:records[b].recordId,reason});
  const valid=[...records,edge(0,1),edge(0,2),edge(1,3),edge(2,3)];
  for(let n=0;n<=valid.length;n++){
    const prefix=valid.slice(0,n);const expected=prefix.reduce((ledger,event)=>appendLedgerEvent(ledger,event),[]);
    assert.deepEqual(materializeLedger(prefix).events,expected);
  }
  for(const [history,code] of [[[...valid,edge(3,0)],/LEDGER_SUPERSESSION_CYCLE/],[[...valid,valid[4]],/LEDGER_DUPLICATE_EVENT/],[[records[0],edge(0,1),records[1]],/LEDGER_SUPERSESSION_REF_MISSING/],[[{...records[0],recordId:'forged'},records[1]],/LEDGER_EVENT_ID_MISMATCH/],[[...records,records[0]],/LEDGER_DUPLICATE_EVENT/]])assert.throws(()=>materializeLedger(history),code);
});


test('replay owns snapshots and a rejected append cannot poison subsequent validation',()=>{
  const a=createProposalRecord({proposal:{...hypothesisA,claim:'isolated-a'},origin:origin('route-a',routeA)});
  const b=createProposalRecord({proposal:{...hypothesisB,claim:'isolated-b'},origin:origin('route-b',routeB)});
  const replay=createLedgerReplay(),input=structuredClone(a);
  replay.append(input);input.proposal.claim='changed input';
  const exported=replay.snapshot();exported[0].proposal.claim='changed output';exported.push(b);
  assert.deepEqual(replay.snapshot(),[a]);
  const edge=createSupersessionEvent({supersededRecordId:a.recordId,replacementRecordId:b.recordId,reason:'synthetic'});
  assert.throws(()=>replay.append(edge),/LEDGER_SUPERSESSION_REF_MISSING/);
  assert.throws(()=>replay.append({...b,recordId:'forged'}),/LEDGER_EVENT_ID_MISMATCH/);
  assert.deepEqual(replay.snapshot(),[a]);
  replay.append(b);replay.append(edge);
  assert.deepEqual(replay.snapshot(),[a,b,edge]);
  assert.throws(()=>replay.append(createSupersessionEvent({supersededRecordId:b.recordId,replacementRecordId:a.recordId,reason:'cycle'})),/LEDGER_SUPERSESSION_CYCLE/);
  assert.deepEqual(replay.snapshot(),[a,b,edge]);
});
