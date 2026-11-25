import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareSourceBatchReceipt, prepareSourceBatchPlan } from '../src/dreaming/source-batch-receipt.ts';
import { prepareVerifiedSessionWork } from '../src/dreaming/verified-session-work.ts';
import { runDurablePilot2 } from '../src/dreaming/durable-pilot2.ts';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-reader.json', import.meta.url), 'utf8'));
const input = () => structuredClone({
  candidate: fixture.candidate, expected: fixture.expected,
  entries: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index, pages: e.pages })),
  bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
  maxSessions: 2, task: 'Synthetic batch analysis.', analysisVersion: 'batch-v1',
  previousCheckpoint: sha256Fingerprint('synthetic-root'),
});
function storage() {
  const reserved = new Map(), completed = new Map();
  return {
    completed,
    async reserve(key, owner) { if (reserved.has(key)) return false; reserved.set(key, owner); return true; },
    async complete(owner, value) {
      assert.equal(reserved.get(value.checkpoint.workFingerprint), owner);
      completed.set(value.checkpoint.workFingerprint, structuredClone(value));
    },
    async readCompletion(key) { return structuredClone(completed.get(key) ?? null); },
  };
}
const routes = ['a','b'].map(id => ({
  id, provider: id, model: id, modelFamily: id,
  infer: async request => ({ provider: id, model: id, finishReason: 'stop', text: JSON.stringify({
    schema: 'theseus.dreaming-worker.proposals.v1', proposals: [{
      type: 'FACT', claim: 'Synthetic observation.', source_refs: request.packet.evidence.slice(0,1)
        .map(e => ({ source_ref: e.sourceRef, evidence_hash: e.evidenceHash })),
    }],
  }) }),
}));
async function complete(x, entry, store) {
  const work = prepareVerifiedSessionWork({ ...x, ...entry });
  const result = await runDurablePilot2(work.input, routes, store);
  assert.equal(result.decision, 'COMMITTED');
  return result;
}
test('exact full batch yields deterministic receipt, not acknowledgement; partial stays pending', async () => {
  const x = input(), store = storage();
  assert.equal((await prepareSourceBatchReceipt(x, store)).status, 'PENDING');
  await complete(x,x.entries[0],store);
  assert.equal((await prepareSourceBatchReceipt(x, store)).status, 'PENDING');
  await complete(x,x.entries[1],store);
  const result = await prepareSourceBatchReceipt(x, store);
  assert.equal(result.status, 'RECEIPT_CANDIDATE');
  assert.equal(result.receipt.checkpointAdvanced, false);
  assert.deepEqual(result.receipt.handoff, x.candidate);
  assert.equal(result.receipt.work.length, 2);
  assert.ok(result.receipt.work.every(w => w.originalPacketId && w.currentWitness.session.messages.every(m => !Object.hasOwn(m,'text'))));
  assert.deepEqual(await prepareSourceBatchReceipt({ ...x, entries: [...x.entries].reverse() },store),result);
  assert.notEqual((await prepareSourceBatchReceipt({...x,previousCheckpoint:sha256Fingerprint('other')},store)).receipt.receiptFingerprint,result.receipt.receiptFingerprint);
});
test('invalid selected set or budget blocks before reading completions', async () => {
  const x = input();
  let reads = 0;
  const store = { async readCompletion(){ reads++; return null; } };
  for (const entries of [[],x.entries.slice(0,1),[x.entries[0],x.entries[0]],[...x.entries,{...x.entries[0],sessionId:'extra'}]]) {
    await assert.rejects(() => prepareSourceBatchReceipt({...x,entries},store));
  }
  await assert.rejects(() => prepareSourceBatchReceipt({...x,maxSessions:1},store));
  const malformed = input();
  malformed.entries[1].pages.pop();
  await assert.rejects(() => prepareSourceBatchReceipt(malformed,store));
  assert.equal(reads,0);
});
test('unavailable or corrupt completion never yields a receipt',async () => {
  const x=input(), store=storage();
  await complete(x,x.entries[0],store);
  await complete(x,x.entries[1],store);
  assert.equal((await prepareSourceBatchReceipt(x,{async readCompletion(){throw Error('unavailable');}})).status,'STORAGE_UNKNOWN');
  for(const completion of store.completed.values()) completion.projectionFingerprint=sha256Fingerprint('bad');
  assert.equal((await prepareSourceBatchReceipt(x,store)).status,'STORAGE_UNKNOWN');
});
test('analysis intent and source witness remain independently bound',async () => {
  const x=input(), store=storage();
  await complete(x,x.entries[0],store);
  await complete(x,x.entries[1],store);
  assert.equal((await prepareSourceBatchReceipt({...x,analysisVersion:'v2'},store)).status,'PENDING');
  const first = await prepareSourceBatchReceipt(x,store);
  const y=input();
  y.entries[0].index.sessions[0].messages[0].sources.push({
    ...y.entries[0].index.sessions[0].messages[0].sources[0], member_name:'synthetic-extra-observation',
  });
  const second=await prepareSourceBatchReceipt(y,store);
  assert.equal(second.status,'RECEIPT_CANDIDATE');
  assert.deepEqual(second.receipt.work.map(w=>w.workFingerprint),first.receipt.work.map(w=>w.workFingerprint));
  assert.notEqual(second.receipt.receiptFingerprint,first.receipt.receiptFingerprint);
});

test('pending plan is metadata-only, binds request and preserves stable work across new witnesses', () => {
  const x=input();
  const first=prepareSourceBatchPlan(x);
  assert.equal(first.checkpointAdvanced,false);
  assert.equal(first.work.length,2);
  assert.ok(first.work.every(w => w.packetId && w.requestFingerprint && w.workFingerprint));
  assert.ok(first.work.every(w => w.witness.session.messages.every(m => !Object.hasOwn(m,'text'))));
  assert.deepEqual(prepareSourceBatchPlan({...x,entries:[...x.entries].reverse()}),first);
  const y=input();
  y.entries[0].index.sessions[0].messages[0].sources.push({
    ...y.entries[0].index.sessions[0].messages[0].sources[0],member_name:'synthetic-observation-two',
  });
  const second=prepareSourceBatchPlan(y);
  assert.deepEqual(second.work.map(w=>w.workFingerprint),first.work.map(w=>w.workFingerprint));
  assert.notEqual(second.planFingerprint,first.planFingerprint);
  assert.throws(()=>prepareSourceBatchPlan({...x,entries:x.entries.slice(0,1)}));
  assert.notEqual(prepareSourceBatchPlan({...x,analysisVersion:'v2'}).planFingerprint,first.planFingerprint);
});
