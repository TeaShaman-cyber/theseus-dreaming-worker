import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runSourceCycle, runPooledSourceCycle } from '../src/dreaming/source-cycle.ts';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-reader.json', import.meta.url), 'utf8'));
const input = () => structuredClone({
  candidate: fixture.candidate, expected: fixture.expected,
  indexes: fixture.entries.map(e => ({ sessionId: e.session_id, index: e.index })),
  bounds: { maxPages: 20, maxChars: 1000, maxMessages: 50 },
  maxSessions: 2, task: 'Synthetic cycle.', analysisVersion: 'cycle-v1',
  previousCheckpoint: sha256Fingerprint('synthetic-root'),
});
const limits = { maxRequests: 20, maxPageBytes: 8000, maxTotalBytes: 100000, timeoutMs: 1000, pageMessages: 2, pageChars: 3 };
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
function changed(x, mutate) {
  mutate(x.candidate);
  delete x.candidate.candidate_sha256;
  x.candidate.candidate_sha256 = sha256Fingerprint(canonical(x.candidate)).slice(7);
  return x;
}
function setup() {
  const counts = { transport: 0, store: 0, inference: 0 };
  const failStore = async () => { counts.store++; throw Error('unexpected store access'); };
  const routes = ['a', 'b'].map(id => ({
    id, provider: id, model: id, modelFamily: id,
    infer: async () => { counts.inference++; throw Error('unexpected inference'); },
  }));
  return { counts, options: {
    limits, maxPasses: 4, routes,
    transport: async () => { counts.transport++; return new Response('synthetic unavailable', { status: 503 }); },
    store: { readTip: failStore, stage: failStore, runSelected: failStore, acknowledge: failStore },
  } };
}
test('invalid handoff and execution policy stop before transport or storage', async () => {
  const { options, counts } = setup();
  const wrong = input();
  wrong.expected.previousSnapshotSha256 = '0'.repeat(64);
  for (const [x, opts] of [[wrong, options], [input(), { ...options, maxPasses: -1 }],
    [input(), { ...options, routes: [options.routes[0], options.routes[0]] }]]) {
    const r = await runSourceCycle(x, opts);
    assert.equal(r.status, 'INPUT_REJECTED');
    assert.equal(r.attemptedPasses, 0);
    assert.equal(r.run, null);
  }
  assert.deepEqual(counts, { transport: 0, store: 0, inference: 0 });
});
test('empty selection preserves candidate identity and unknown currentness without advancing', async () => {
  const { options, counts } = setup();
  const x = changed(input(), c => { c.selected = []; });
  x.indexes = [];
  const r = await runSourceCycle(x, options);
  assert.equal(r.status, 'NO_SELECTED_WORK');
  assert.equal(r.handoff.candidateSha256, x.candidate.candidate_sha256);
  assert.equal(r.handoff.currentness, 'UNKNOWN_WITHOUT_SOURCE_WATERMARK');
  assert.equal(r.handoff.membershipChanged, true);
  assert.equal(r.attemptedPasses, 0);
  assert.equal(r.run, null);
  assert.deepEqual(counts, { transport: 0, store: 0, inference: 0 });
  assert.equal((await runSourceCycle({ ...x, indexes: input().indexes }, options)).status, 'INPUT_REJECTED');
});
test('removal obligation stops even when other selected work exists', async () => {
  const { options, counts } = setup();
  const x = changed(input(), c => { c.removed = ['unresolved-synthetic-removal']; });
  const r = await runSourceCycle(x, options);
  assert.equal(r.status, 'REMOVAL_PENDING');
  assert.equal(r.handoff.removedCount, 1);
  assert.equal(r.handoff.selectedCount, 2);
  assert.equal(r.handoff.candidateSha256, x.candidate.candidate_sha256);
  assert.equal(r.run, null);
  assert.deepEqual(counts, { transport: 0, store: 0, inference: 0 });
});
test('failed acquisition is explicit and never touches the store', async () => {
  const { options, counts } = setup();
  const r = await runSourceCycle(input(), options);
  assert.equal(r.status, 'ACQUISITION_BLOCKED');
  assert.equal(r.attemptedPasses, 0);
  assert.equal(r.run, null);
  assert.deepEqual(counts, { transport: 1, store: 0, inference: 0 });
});
test('acquired verified work delegates to the existing source runner', async () => {
  const { options, counts } = setup();
  const x = input();
  const r = await runSourceCycle(x, {
    ...options,
    transport: async request => {
      counts.transport++;
      const entry = fixture.entries.find(e => e.session_id === request.session_id);
      const i = request.cursor ? entry.pages.findIndex(p => p.next_cursor === request.cursor) + 1 : 0;
      return Response.json(entry.pages[i]);
    },
    store: { ...options.store, readTip: async () => { counts.store++; return null; } },
  });
  assert.equal(r.status, 'CONFLICT');
  assert.equal(r.run.status, 'CONFLICT');
  assert.equal(r.attemptedPasses, 0);
  assert.deepEqual(counts, { transport: 12, store: 1, inference: 0 });
});

test('a valid handoff outside the synthetic scope cannot start a cycle', async () => {
  const { options, counts } = setup();
  const x = input();
  changed(x, c => {
    c.scope = 'private:chatgpt';
    for (const m of [c.previous_membership, c.current_membership]) {
      m.scope = c.scope;
      delete m.snapshot_sha256;
      m.snapshot_sha256 = sha256Fingerprint(canonical(m)).slice(7);
    }
    x.expected.scope = c.scope;
    x.expected.previousSnapshotSha256 = c.previous_membership.snapshot_sha256;
  });
  const r = await runSourceCycle(x, options);
  assert.equal(r.status, 'INPUT_REJECTED');
  assert.deepEqual(counts, { transport: 0, store: 0, inference: 0 });
});

test('stale generation response stops the cycle without touching the ledger', async () => {
  const { options, counts } = setup();
  const r = await runSourceCycle(input(), {
    ...options, transport: async request => {
      counts.transport++;
      const entry = fixture.entries.find(e => e.session_id === request.session_id);
      return Response.json({ ...entry.pages[0], generation_id: '0'.repeat(64) });
    },
  });
  assert.equal(r.status, 'ACQUISITION_BLOCKED');
  assert.equal(r.attemptedPasses, 0);
  assert.deepEqual(counts, { transport: 1, store: 0, inference: 0 });
});

function pooledSetup(){
  const {options,counts}=setup();
  const {routes,maxPasses,...rest}=options;
  return {counts,options:{...rest,policy:{
    routes:routes.map(r=>({...r,admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:10000})),
    taskClass:'analysis',maxAttempts:4,maxInvocations:maxPasses,rotation:0,cooldowns:[],clock:()=>100,
  }}};
}
test('pooled cycle rejects invalid policy and preserves no-work/removal gates',async()=>{
  const {options,counts}=pooledSetup();
  const wrong=structuredClone(input());wrong.expected.previousSnapshotSha256='0'.repeat(64);
  assert.equal((await runPooledSourceCycle(wrong,options)).status,'INPUT_REJECTED');
  assert.equal((await runPooledSourceCycle(input(),{...options,policy:{...options.policy,maxInvocations:-1}})).status,'INPUT_REJECTED');
  const empty=changed(input(),c=>{c.selected=[];});empty.indexes=[];
  assert.equal((await runPooledSourceCycle(empty,options)).status,'NO_SELECTED_WORK');
  assert.equal((await runPooledSourceCycle(changed(input(),c=>{c.removed=['synthetic-removal'];}),options)).status,'REMOVAL_PENDING');
  assert.deepEqual(counts,{transport:0,store:0,inference:0});
});
test('pooled cycle acquisition failure does not start ledger execution',async()=>{
  const {options,counts}=pooledSetup();
  const r=await runPooledSourceCycle(input(),options);
  assert.equal(r.status,'ACQUISITION_BLOCKED');assert.equal(r.attemptedPasses,0);
  assert.deepEqual(counts,{transport:1,store:0,inference:0});
});
test('pooled cycle preserves snapshotted execution budget and metadata across acquisition',async()=>{
  const {options,counts}=pooledSetup();
  const x=input();
  const {prepareSourceBatchPlan}=await import('../src/dreaming/source-batch-receipt.ts');
  let plan;
  const r=await runPooledSourceCycle(x,{
    ...options,
    transport:async request=>{
      counts.transport++;
      options.policy.maxInvocations=0;
      options.policy.routes[0].admission='NOT_AUTHORIZED';
      options.policy.routes[0].qualifiedTasks.length=0;
      const entry=fixture.entries.find(e=>e.session_id===request.session_id);
      const i=request.cursor?entry.pages.findIndex(p=>p.next_cursor===request.cursor)+1:0;
      return Response.json(entry.pages[i]);
    },
    store:{
      async readTip(){return {receiptFingerprint:x.previousCheckpoint};},
      async stage(raw){plan=prepareSourceBatchPlan(raw);return {status:'STAGED',plan};},
      async runSelectedPooled(raw,id,p){
        counts.store++;
        assert.equal(p.maxInvocations,4);
        assert.equal(p.routes[0].admission,'FREE_RESEARCH');
        assert.deepEqual(p.routes[0].qualifiedTasks,['analysis']);
        const entry=plan.work.find(w=>w.witness.session.session_id===id);
        return {workFingerprint:entry.workFingerprint,decision:'DEFERRED',attemptedPasses:0,nextRotation:0,wakeAtMs:5100,completion:null};
      },
      async acknowledge(){throw Error('unexpected acknowledgement');},
    },
  });
  assert.equal(r.status,'DEFERRED');assert.equal(r.run.wakeAtMs,5100);
  assert.equal(r.attemptedPasses,0);
  assert.deepEqual(counts,{transport:12,store:2,inference:0});
});
