import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runSourceBatch, runPooledSourceBatch } from '../src/dreaming/source-batch-run.ts';
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

const pooledPolicy=(routes,extra={})=>({
  routes:routes.map(r=>({...r,admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:10000})),
  taskClass:'analysis',maxAttempts:4,maxInvocations:4,rotation:0,cooldowns:[],clock:()=>100,...extra,
});
function pooledStub(x,decisions){
  const plan=prepareSourceBatchExecution(x).plan;
  const visits=[],calls=[];
  const receiptPayload={schema:'theseus.dreaming-worker.source-batch-receipt.v2',previousCheckpoint:plan.previousCheckpoint,currentPlanFingerprint:plan.planFingerprint};
  const receipt={...receiptPayload,receiptFingerprint:sourceReceiptFingerprint(receiptPayload)};
  let tip={receiptFingerprint:x.previousCheckpoint},acks=0;
  const store={
    async readTip(){return tip;},
    async stage(){return {status:'STAGED',plan};},
    async runSelectedPooled(raw,id,p){
      const n=visits.length;
      const entry=plan.work.find(e=>e.witness.session.session_id===id);
      visits.push({id,budget:p.maxInvocations,rotation:p.rotation});
      const step=decisions[n];
      for(let i=0;i<(step.calls??0);i++)await p.routes[0].infer({packet:{evidence:[]}});
      const complete=['COMMITTED','ALREADY_PROCESSED'].includes(step.decision);
      return {workFingerprint:entry.workFingerprint,decision:step.decision,attemptedPasses:step.calls??0,
        completion:complete?{checkpoint:{workFingerprint:entry.workFingerprint}}:null,nextRotation:n+1,wakeAtMs:null,...step};
    },
    async acknowledge(){acks++;if(tip===receipt)return {status:'ALREADY_ACKNOWLEDGED',receipt};tip=receipt;return {status:'ACKNOWLEDGED',receipt};},
  };
  const routes=['a','b'].map(id=>({id,provider:id,model:id,modelFamily:id,async infer(){calls.push(id);}}));
  return {store,policy:pooledPolicy(routes),visits,calls,acks:()=>acks};
}
test('pooled batch passes remaining actual budget and rotation, recovers zero-call work and exact replay',async()=>{
  const x=input(),s=pooledStub(x,[{decision:'COMMITTED',calls:3},{decision:'COMMITTED',calls:1}]);
  const r=await runPooledSourceBatch(x,s.policy,s.store);
  assert.equal(r.status,'ACKNOWLEDGED');assert.equal(r.attemptedPasses,4);assert.equal(r.nextRotation,2);
  assert.deepEqual(s.visits.map(v=>[v.budget,v.rotation]),[[4,0],[1,1]]);
  assert.equal(s.acks(),1);
  const replay=await runPooledSourceBatch(x,{...s.policy,maxInvocations:0},s.store);
  assert.equal(replay.status,'ALREADY_ACKNOWLEDGED');assert.equal(replay.attemptedPasses,0);
  assert.deepEqual(replay.receipt,r.receipt);assert.equal(s.visits.length,2);
  const zero=pooledStub(x,[{decision:'COMMITTED'},{decision:'ALREADY_PROCESSED'}]);
  const recovered=await runPooledSourceBatch(x,{...zero.policy,maxInvocations:0},zero.store);
  assert.equal(recovered.status,'ACKNOWLEDGED');assert.equal(recovered.attemptedPasses,0);
  assert.deepEqual(zero.visits.map(v=>v.budget),[0,0]);
});
test('pooled batch considers each known pending work once but does not acknowledge partial plan',async()=>{
  for(const step of [{decision:'DEFERRED',wakeAtMs:5100},{decision:'INSUFFICIENT_ELIGIBILITY'},{decision:'BUDGET_EXHAUSTED',calls:2}]){
    const x=input(),s=pooledStub(x,[step,{decision:'COMMITTED',calls:2}]);
    const r=await runPooledSourceBatch(x,s.policy,s.store);
    assert.equal(r.status,step.decision==='INSUFFICIENT_ELIGIBILITY'?'WORK_UNRESOLVED':step.decision);
    assert.equal(r.wakeAtMs,step.wakeAtMs??null);assert.equal(r.attemptedPasses,(step.calls??0)+2);
    assert.equal(s.visits.length,2);assert.equal(s.acks(),0);assert.equal(r.receipt,null);
  }
});
test('pooled batch unknown, conflicting and inconsistent results stop later dispatch',async()=>{
  const x=input();
  for(const step of [{decision:'BLOCKED_UNKNOWN',calls:1},{decision:'STORAGE_UNKNOWN'},{decision:'POLICY_CONFLICT'},
    {decision:'LEGACY_UNRESOLVED'},{decision:'DEFERRED',wakeAtMs:null},{decision:'COMMITTED',workFingerprint:'wrong'},
    {decision:'ALREADY_PROCESSED',calls:1},{decision:'COMMITTED',attemptedPasses:2},{decision:'COMMITTED',nextRotation:-1}]){
    const s=pooledStub(x,[step]);
    const r=await runPooledSourceBatch(x,s.policy,s.store);
    assert.equal(r.status,['BLOCKED_UNKNOWN','POLICY_CONFLICT','LEGACY_UNRESOLVED'].includes(step.decision)?'WORK_UNRESOLVED':'STORAGE_UNKNOWN',step.decision);
    assert.equal(s.visits.length,1);assert.equal(s.acks(),0);
  }
});
test('pooled batch invalid policy/stage and overspend fail closed',async()=>{
  const x=input(),s=pooledStub(x,[{decision:'COMMITTED',calls:3}]);
  await assert.rejects(()=>runPooledSourceBatch(x,{...s.policy,maxInvocations:-1},s.store));
  await assert.rejects(()=>runPooledSourceBatch(x,{...s.policy,routes:[s.policy.routes[0],s.policy.routes[0]]},s.store));
  const rejected=await runPooledSourceBatch(x,s.policy,{...s.store,stage:async()=>({status:'STORAGE_UNKNOWN',plan:prepareSourceBatchExecution(x).plan})});
  assert.equal(rejected.status,'STORAGE_UNKNOWN');assert.equal(s.visits.length,0);
  const capped=await runPooledSourceBatch(x,{...s.policy,maxInvocations:2},s.store);
  assert.equal(capped.status,'STORAGE_UNKNOWN');assert.equal(capped.attemptedPasses,2);
  assert.equal(s.calls.length,2);assert.equal(s.acks(),0);
});

test('fixed route policy rejects missing or blank identity fields and wrong route count before storage', async () => {
  const x=input(), {store,routes,counts}=setup(x);
  for (const candidate of [[], [routes[0]], [...routes,routes[0]], ...['id','provider','model','modelFamily'].flatMap(key=>[undefined,'','  '].map(value=>[{...routes[0],[key]:value},routes[1]])), [{...routes[0],infer:null},routes[1]], [{...routes[0],modelFamily:' B '},routes[1]], [routes[0],{...routes[1],modelFamily:' A '}]]) {
    await assert.rejects(()=>runSourceBatch(x,candidate,store,4), /SOURCE_RUN_ROUTE_PLAN/);
  }
  for (const budget of [201,1.5,NaN]) await assert.rejects(()=>runSourceBatch(x,routes,store,budget));
  assert.deepEqual(counts(),{calls:0,stages:0,acks:0,reservations:0});
});

test('pooled batch rejects corrupt persisted receipts and distinguishes conflicts from uncertainty',async()=>{
  const x=input(),s=pooledStub(x,[{decision:'COMMITTED'},{decision:'ALREADY_PROCESSED'}]);
  const success=await runPooledSourceBatch(x,s.policy,s.store);
  assert.equal(success.status,'ACKNOWLEDGED');
  const good=success.receipt;
  for (const patch of [{schema:'wrong'},{previousCheckpoint:'wrong'},{currentPlanFingerprint:'wrong'},{receiptFingerprint:'wrong'}]) {
    const {receiptFingerprint: _fp,...payload}=good;
    const invalidPayload={...payload,...patch};
    const bad={...invalidPayload,receiptFingerprint:patch.receiptFingerprint??sourceReceiptFingerprint(invalidPayload)};
    const r=await runPooledSourceBatch(x,s.policy,{...s.store,readTip:async()=>bad});
    assert.equal(r.status,'CONFLICT'); assert.equal(r.receipt,null); assert.equal(r.attemptedPasses,0);
  }
  for (const ack of [{status:'ACKNOWLEDGED',receipt:good},{status:'ALREADY_ACKNOWLEDGED',receipt:null},{status:'ALREADY_ACKNOWLEDGED',receipt:{...good,receiptFingerprint:'wrong'}}]) {
    const r=await runPooledSourceBatch(x,s.policy,{...s.store,acknowledge:async()=>ack});
    assert.equal(r.status,'STORAGE_UNKNOWN'); assert.equal(r.receipt,null);
  }
  assert.equal(s.visits.length,2);
});

test('pooled batch validates each store outcome before advancing the next work',async()=>{
  const x=input();
  for (const step of [{decision:'COMMITTED',completion:null},{decision:'COMMITTED',completion:{checkpoint:{workFingerprint:'wrong'}}},
    {decision:'DEFERRED',wakeAtMs:-1},{decision:'DEFERRED',wakeAtMs:1.5},{decision:'COMMITTED',wakeAtMs:100},
    {decision:'COMMITTED',nextRotation:0.5},{decision:'COMMITTED',nextRotation:Number.MAX_SAFE_INTEGER+1},
    {decision:'BUDGET_EXHAUSTED',completion:{checkpoint:{workFingerprint:'wrong'}}},{decision:'STORAGE_UNKNOWN'}]) {
    const s=pooledStub(x,[step]);
    const r=await runPooledSourceBatch(x,s.policy,s.store);
    assert.equal(r.status,'STORAGE_UNKNOWN',JSON.stringify(step));
    assert.equal(s.visits.length,1);assert.equal(s.acks(),0);assert.equal(r.receipt,null);
  }
});

test('pooled batch preserves earliest valid wake and deferred precedence',async()=>{
  for(const [steps,expected] of [
    [[{decision:'DEFERRED',wakeAtMs:900},{decision:'DEFERRED',wakeAtMs:0}],0],
    [[{decision:'BUDGET_EXHAUSTED'},{decision:'DEFERRED',wakeAtMs:5100}],5100],
    [[{decision:'INSUFFICIENT_ELIGIBILITY'},{decision:'DEFERRED',wakeAtMs:5100}],5100]]){
    const x=input(),s=pooledStub(x,steps);
    const r=await runPooledSourceBatch(x,s.policy,s.store);
    assert.equal(r.status,'DEFERRED');assert.equal(r.wakeAtMs,expected);assert.equal(s.acks(),0);
    assert.deepEqual(r.work.map(w=>w.wakeAtMs),steps.map(w=>w.wakeAtMs??null));
  }
});

test('pooled batch rejects invalid stage custody and never dispatches work on a conflict',async()=>{
  const x=input(),s=pooledStub(x,[]),plan=prepareSourceBatchExecution(x).plan;
  const invalid=[{status:'CONFLICT',plan},{status:'STORAGE_UNKNOWN',plan},{status:'STAGED',plan:null},
    {status:'STAGED',plan:{...plan,planFingerprint:'wrong'}},{status:'STAGED',plan:{...plan,previousCheckpoint:'wrong'}}];
  for(const stage of invalid){
    const r=await runPooledSourceBatch(x,s.policy,{...s.store,stage:async()=>stage});
    assert.equal(r.status,stage.status==='CONFLICT'?'CONFLICT':'STORAGE_UNKNOWN');
    assert.equal(r.receipt,null);assert.equal(r.attemptedPasses,0);
  }
  assert.equal((await runPooledSourceBatch(x,s.policy,{...s.store,readTip:async()=>null})).status,'CONFLICT');
  assert.equal(s.visits.length,0);assert.equal(s.acks(),0);
});

test('fixed batch distinguishes invalid acknowledgement, conflict, and unknown work without advancing',async()=>{
  const x=input(),{store,routes,counts}=setup(x),plan=prepareSourceBatchExecution(x).plan;
  const badStage=await runSourceBatch(x,routes,{...store,stage:async()=>({status:'STAGED',plan:{...plan,previousCheckpoint:'wrong'}})},4);
  assert.equal(badStage.status,'STORAGE_UNKNOWN');
  assert.equal((await runSourceBatch(x,routes,{...store,stage:async()=>({status:'CONFLICT',plan})},4)).status,'CONFLICT');
  for(const ack of [{status:'CONFLICT',receipt:null},{status:'ACKNOWLEDGED',receipt:null},{status:'ALREADY_ACKNOWLEDGED',receipt:null}]){
    const r=await runSourceBatch(x,routes,{...store,acknowledge:async()=>ack},0);
    assert.equal(r.status,ack.status==='CONFLICT'?'CONFLICT':'STORAGE_UNKNOWN');assert.equal(r.receipt,null);
  }
  for(const outcome of [{decision:'STORAGE_UNKNOWN'},{decision:'COMMITTED',completion:null},{decision:'ALREADY_PROCESSED',completion:{checkpoint:{workFingerprint:'wrong'}}},{decision:'COMMITTED',attemptedPasses:1},{decision:'COMMITTED',workFingerprint:'wrong'}]){
    const r=await runSourceBatch(x,routes,{...store,async runSelected(){return {workFingerprint:plan.work[0].workFingerprint,attemptedPasses:0,...outcome};}},4);
    assert.equal(r.status,'STORAGE_UNKNOWN');assert.equal(r.receipt,null);
  }
  assert.equal(counts().calls,0);assert.equal(counts().reservations,0);
});

test('pooled acknowledgement only accepts an exact confirmed receipt',async()=>{
  const x=input();
  for(const ack of [{status:'CONFLICT',receipt:null},{status:'PENDING',receipt:null},{status:'ACKNOWLEDGED',receipt:null},{status:'ALREADY_ACKNOWLEDGED',receipt:null}]){
    const s=pooledStub(x,[{decision:'COMMITTED'},{decision:'ALREADY_PROCESSED'}]);
    const r=await runPooledSourceBatch(x,s.policy,{...s.store,acknowledge:async()=>ack});
    assert.equal(r.status,ack.status==='CONFLICT'?'CONFLICT':'STORAGE_UNKNOWN');assert.equal(r.receipt,null);
  }
});

test('fixed batch confirms exact acknowledgement states on both initial and replay paths', async()=>{
  const x=input(), {store,routes}=setup(x);
  const completed=await runSourceBatch(x,routes,store,4);
  const good=completed.receipt;
  assert.equal(completed.status,'ACKNOWLEDGED');
  assert.deepEqual(completed.work.map(w=>w.attemptedPasses),[2,2]);
  for(const [status,receipt,expected] of [['ALREADY_ACKNOWLEDGED',good,'ALREADY_ACKNOWLEDGED'],['ACKNOWLEDGED',good,'STORAGE_UNKNOWN'],['ALREADY_ACKNOWLEDGED',null,'STORAGE_UNKNOWN'],['ALREADY_ACKNOWLEDGED',{...good,receiptFingerprint:'wrong'},'STORAGE_UNKNOWN']]){
    const r=await runSourceBatch(x,routes,{...store,acknowledge:async()=>({status,receipt})},0);
    assert.equal(r.status,expected); assert.equal(r.attemptedPasses,0);
  }
  for(const [status,expected] of [['ALREADY_ACKNOWLEDGED','ALREADY_ACKNOWLEDGED'],['STORAGE_UNKNOWN','STORAGE_UNKNOWN']]){
    const r=await runSourceBatch(x,routes,{...store,readTip:async()=>({receiptFingerprint:x.previousCheckpoint}),acknowledge:async()=>({status,receipt:good})},0);
    assert.equal(r.status,expected);
    assert.deepEqual(r.receipt,expected==='ALREADY_ACKNOWLEDGED'?good:null);
  }
});

test('fixed batch rejects untrusted work summaries before acknowledging or dispatching later work',async()=>{
  const x=input(),plan=prepareSourceBatchExecution(x).plan;
  const fingerprint=plan.work[0].workFingerprint;
  for(const step of [
    {decision:'ANALYSIS_INCOMPLETE',workFingerprint:'wrong'},
    {decision:'ANALYSIS_INCOMPLETE',attemptedPasses:1},
    {decision:'ANALYSIS_INCOMPLETE',calls:3},
    {decision:'COMMITTED',calls:2,completion:null},
    {decision:'COMMITTED',calls:2,completion:{checkpoint:{workFingerprint:'wrong'}}},
    {decision:'COMMITTED',calls:1},
    {decision:'ALREADY_PROCESSED',calls:1},
  ]){
    const {store,routes,counts}=setup(x);let visits=0;
    const r=await runSourceBatch(x,routes,{...store,async runSelected(_raw,_id,bounded){
      visits++;for(let i=0;i<(step.calls??0);i++)await bounded[0].infer({packet:{evidence:[]}});
      return {workFingerprint:fingerprint,attemptedPasses:step.calls??0,completion:{checkpoint:{workFingerprint:fingerprint}},...step};
    }},4);
    assert.equal(r.status,'STORAGE_UNKNOWN',JSON.stringify(step));assert.equal(visits,1);assert.equal(counts().acks,0);
    if(step.decision==='ANALYSIS_INCOMPLETE')assert.deepEqual(r.work,[]);
  }
});

test('fixed and pooled adapters deny over-budget calls before provider dispatch',async()=>{
  const x=input();
  const fixed=setup(x);let fixedRejected;
  const r=await runSourceBatch(x,fixed.routes,{...fixed.store,async runSelected(_raw,_id,routes){
    for(let i=0;i<2;i++)await routes[0].infer({packet:{evidence:[]}});
    try{await routes[0].infer({packet:{evidence:[]}});}catch(e){fixedRejected=e.message;throw e;}
    throw Error('synthetic untrusted store abort');
  }},2);
  assert.equal(r.status,'STORAGE_UNKNOWN');assert.equal(fixedRejected,'SOURCE_RUN_PASS_BUDGET');assert.equal(r.attemptedPasses,2);assert.equal(fixed.counts().calls,2);assert.equal(fixed.counts().acks,0);
  const s=pooledStub(x,[]);let rejected;
  const p=await runPooledSourceBatch(x,{...s.policy,maxInvocations:0},{...s.store,async runSelectedPooled(_raw,_id,policy){
    try{await policy.routes[0].infer({packet:{evidence:[]}});}catch(e){rejected=e.message;throw e;}
    throw Error('unexpected invocation');
  }});
  assert.equal(p.status,'STORAGE_UNKNOWN');assert.equal(rejected,'SOURCE_RUN_PASS_BUDGET');assert.equal(s.calls.length,0);
});

test('pooled batch permits already-staged plans, zero rotation and already-acknowledged exact receipts',async()=>{
  const x=input(),plan=prepareSourceBatchExecution(x).plan;
  const seed=pooledStub(x,[{decision:'COMMITTED'},{decision:'ALREADY_PROCESSED'}]);
  const good=(await runPooledSourceBatch(x,seed.policy,seed.store)).receipt;
  const s=pooledStub(x,[{decision:'ALREADY_PROCESSED',nextRotation:0},{decision:'ALREADY_PROCESSED',nextRotation:0}]);
  const r=await runPooledSourceBatch(x,s.policy,{...s.store,stage:async()=>({status:'ALREADY_STAGED',plan}),acknowledge:async()=>({status:'ALREADY_ACKNOWLEDGED',receipt:good})});
  assert.equal(r.status,'ALREADY_ACKNOWLEDGED');assert.equal(r.nextRotation,0);assert.deepEqual(r.receipt,good);
  await assert.rejects(()=>runPooledSourceBatch(x,{...s.policy,routes:[{...s.policy.routes[0],infer:null},s.policy.routes[1]]},s.store),/POOL_EXECUTION_ADAPTER/);
});
