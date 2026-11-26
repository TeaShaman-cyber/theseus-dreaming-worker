import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runSourceBatch } from '../src/dreaming/source-batch-run.ts';
import { prepareSourceBatchExecution, prepareSourceBatchReceipt, sourceReceiptFingerprint } from '../src/dreaming/source-batch-receipt.ts';
import { runDurablePilot2 } from '../src/dreaming/durable-pilot2.ts';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-reader.json', import.meta.url), 'utf8'));
const input = () => structuredClone({
  candidate: fixture.candidate, expected: fixture.expected,
  entries: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index, pages: e.pages })),
  bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
  maxSessions: 2, task: 'Synthetic batch analysis.', analysisVersion: 'batch-run-v1',
  previousCheckpoint: sha256Fingerprint('synthetic-root'),
});
function setup(x) {
  let calls = 0, stages = 0, acks = 0;
  const reserved = new Map(), completed = new Map();
  const workStore = {
    async reserve(key, owner) { if (reserved.has(key)) return false; reserved.set(key, owner); return true; },
    async complete(owner, value) {
      assert.equal(reserved.get(value.checkpoint.workFingerprint), owner);
      completed.set(value.checkpoint.workFingerprint, structuredClone(value));
    },
    async readCompletion(key) { return structuredClone(completed.get(key) ?? null); },
  };
  let tip = { receiptFingerprint: x.previousCheckpoint };
  let plan;
  const store = {
    async readTip() { return structuredClone(tip); },
    async stage(raw) { stages++; plan = prepareSourceBatchExecution(raw).plan; return { status: 'STAGED', plan }; },
    async runSelected(raw, id, routes) {
      const entry = prepareSourceBatchExecution(raw).prepared.find(e => e.provenance.session.session_id === id);
      return runDurablePilot2(entry.input, routes, workStore);
    },
    async acknowledge(raw) {
      acks++;
      if (tip.currentPlanFingerprint === plan.planFingerprint) return { status:'ALREADY_ACKNOWLEDGED', receipt: tip };
      const result = await prepareSourceBatchReceipt(raw,workStore);
      if (!result.receipt) return {status:result.status,receipt:null};
      const {receiptFingerprint: _fp, ...payload}=result.receipt;
      const receipt={...payload,schema:'theseus.dreaming-worker.source-batch-receipt.v2',
        currentPlanFingerprint:plan.planFingerprint,origins:plan.work.map(w=>({
          workFingerprint:w.workFingerprint,previousCheckpoint:plan.previousCheckpoint,planFingerprint:plan.planFingerprint,
        }))};
      tip={...receipt,receiptFingerprint:sourceReceiptFingerprint(receipt)};
      return {status:'ACKNOWLEDGED',receipt:tip};
    },
  };
  const routes = ['a','b'].map(id => ({
    id, provider:id, model:id, modelFamily:id,
    infer:async request => {
      calls++;
      return { provider:id,model:id,finishReason:'stop',text:JSON.stringify({
        schema:'theseus.dreaming-worker.proposals.v1',proposals:[{
          type:'FACT',claim:'Synthetic observation.',source_refs:request.packet.evidence.slice(0,1)
            .map(e=>({source_ref:e.sourceRef,evidence_hash:e.evidenceHash})),
        }],
      })};
    },
  }));
  return {store,routes,counts:()=>({calls,stages,acks,reservations:reserved.size})};
}
test('budgeted restart completes only remaining work and exact replay uses no inference', async()=>{
  const x=input(), {store,routes,counts}=setup(x);
  const a=await runSourceBatch(x,routes,store,2);
  assert.equal(a.status,'BUDGET_EXHAUSTED');
  assert.equal(a.attemptedPasses,2);
  assert.equal(a.receipt,null);
  assert.equal((await store.readTip()).receiptFingerprint,x.previousCheckpoint);
  assert.equal(counts().acks,1); // Read/verify attempt, not checkpoint advancement.
  const b=await runSourceBatch(x,routes,store,2);
  assert.equal(b.status,'ACKNOWLEDGED');
  assert.deepEqual(b.work.map(w=>w.decision),['ALREADY_PROCESSED','COMMITTED']);
  assert.equal(b.attemptedPasses,2);
  assert.equal(counts().calls,4);
  const c=await runSourceBatch(x,routes,store,0);
  assert.equal(c.status,'ALREADY_ACKNOWLEDGED');
  assert.deepEqual(c.receipt,b.receipt);
  assert.equal(counts().calls,4);
});
test('invalid inputs and routes fail before staging or reserving',async()=>{
  const x=input(),{store,routes,counts}=setup(x);
  await assert.rejects(()=>runSourceBatch({...x,entries:[]},routes,store,2));
  await assert.rejects(()=>runSourceBatch(x,[routes[0],routes[0]],store,2));
  await assert.rejects(()=>runSourceBatch(x,routes,store,-1));
  assert.deepEqual(counts(),{calls:0,stages:0,acks:0,reservations:0});
});
test('missing root and unconfirmed stage block all work',async()=>{
  const x=input(),{store,routes,counts}=setup(x);
  assert.equal((await runSourceBatch(x,routes,{...store,readTip:async()=>null},2)).status,'CONFLICT');
  assert.equal((await runSourceBatch(x,routes,{...store,stage:async()=>({status:'STORAGE_UNKNOWN',plan:null})},2)).status,'STORAGE_UNKNOWN');
  assert.deepEqual(counts(),{calls:0,stages:0,acks:0,reservations:0});
});
test('partial analysis stops the batch; no automatic retry or acknowledgement',async()=>{
  const x=input(),{store,routes,counts}=setup(x);
  routes[1].infer=async()=>{throw Error('synthetic incomplete response')};
  const a=await runSourceBatch(x,routes,store,4);
  assert.equal(a.status,'WORK_UNRESOLVED');
  assert.equal(a.work.length,1);
  assert.equal(a.work[0].decision,'ANALYSIS_INCOMPLETE');
  assert.equal(a.attemptedPasses,2);
  assert.equal(counts().reservations,1);
  assert.equal(counts().acks,0);
  const b=await runSourceBatch(x,routes,store,4);
  assert.equal(b.work[0].decision,'RESERVATION_UNRESOLVED');
  assert.equal(b.attemptedPasses,0);
  assert.equal(counts().calls,1);
});
test('conflicting tip and mismatched staged plan are not authority to execute',async()=>{
  const x=input(),{store,routes,counts}=setup(x);
  const other={receiptFingerprint:sha256Fingerprint('other')};
  assert.equal((await runSourceBatch(x,routes,{...store,readTip:async()=>other},2)).status,'CONFLICT');
  const wrong=prepareSourceBatchExecution({...x,analysisVersion:'different'}).plan;
  assert.equal((await runSourceBatch(x,routes,{...store,stage:async()=>({status:'STAGED',plan:wrong})},2)).status,'STORAGE_UNKNOWN');
  assert.equal(counts().reservations,0);
});

test('completed batch can recover a lost acknowledgement with zero pass budget', async () => {
  const x = input(), { store, routes, counts } = setup(x);
  const interrupted = await runSourceBatch(x, routes, {
    ...store, acknowledge: async () => { throw Error('synthetic interruption before ack'); },
  }, 4);
  assert.equal(interrupted.status, 'STORAGE_UNKNOWN');
  assert.equal(counts().calls, 4);
  assert.equal((await store.readTip()).receiptFingerprint, x.previousCheckpoint);
  const recovered = await runSourceBatch(x, routes, store, 0);
  assert.equal(recovered.status, 'ACKNOWLEDGED');
  assert.equal(recovered.attemptedPasses, 0);
  assert.equal(recovered.receipt.work.length, 2);
  assert.equal(counts().calls, 4);
  assert.equal(counts().reservations, 2);
});

test('zero pass budget distinguishes unknown acknowledgement from incomplete work', async () => {
  const x = input(), { store, routes, counts } = setup(x);
  const a = await runSourceBatch(x, routes, store, 0);
  assert.equal(a.status, 'BUDGET_EXHAUSTED');
  assert.equal(a.receipt, null);
  const b = await runSourceBatch(x, routes, {
    ...store, acknowledge: async () => ({ status: 'STORAGE_UNKNOWN', receipt: null }),
  }, 0);
  assert.equal(b.status, 'STORAGE_UNKNOWN');
  assert.equal(counts().calls, 0);
  assert.equal(counts().reservations, 0);
  assert.equal((await store.readTip()).receiptFingerprint, x.previousCheckpoint);
});
