import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createPostgresPoolJournalStore, createPostgresWorkStore } from '../../src/dreaming/proposal-ledger-postgres.ts';
import { preparePoolJournal } from '../../src/dreaming/pool-attempt-journal.ts';
import { runPilot1 } from '../../src/dreaming/pilot1-runner.ts';
import { selectModelPool } from '../../src/dreaming/model-pool.ts';

const connectionString=process.env.LEDGER_DATABASE_URL;
assert.ok(connectionString);
const options={connectionString};
const requestFor=version=>({
  acceptedSourceFingerprint:'sha256:'+'b'.repeat(64), analysisVersion:version,
  request:{scope:'SYNTHETIC_FIXTURE',task:'Analyze the fixture.',packet:{
    schema:'theseus-evidence-packet-v1',packetId:'pool-pg',acceptedNewEvidence:true,
    coverage:{state:'COMPLETE',currentness:'CURRENT'},
    evidence:[{sourceRef:'fixture:pool',evidenceHash:'sha256:fixture',text:'Synthetic observation.'}],
  }},
});
const route=id=>({id,provider:'provider-'+id,model:'model-'+id,modelFamily:id});
const start=(id,slot)=>({kind:'START',attemptId:randomUUID(),slot,route:route(id)});
const calls=[];
async function validate(input,event) {
  const run=await runPilot1(input.request,async()=>{
    calls.push(event.route.id);
    return {provider:event.route.provider,model:event.route.model,finishReason:'stop',
      text:JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[{
        type:'FACT',claim:'Synthetic observation.',source_refs:[{source_ref:'fixture:pool',evidence_hash:'sha256:fixture'}],
      }]})};
  });
  assert.equal(run.outcome,'PROPOSED');
  const {packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,
    externalModelCalls,toolsUsed,memoryUsed,canonicalWrites}=run.receipt;
  return {kind:'VALIDATED',attemptId:event.attemptId,
    receipt:{packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,
      externalModelCalls,toolsUsed,memoryUsed,canonicalWrites},proposalSet:run.proposalSet};
}
const input=requestFor('pool-journal-test');
let store=createPostgresPoolJournalStore(options);
const admitted=await store.admit(input,4,randomUUID());
assert.equal(admitted.status,'JOURNAL');
const a=start('a',0),other=start('other',0);
const contested=await Promise.allSettled([
  store.append(input,admitted.state.tip,a),store.append(input,admitted.state.tip,other),
]);
assert.equal(contested.filter(r=>r.status==='fulfilled').length,1);
const won=contested[0].status==='fulfilled'?a:other;
let state=(await store.read(input)).state;
assert.equal(state.pending.attemptId,won.attemptId);
state=await store.append(input,state.tip,await validate(input,won));
const frozen=structuredClone(state.validated[0]);
const b=start('b',1);
state=await store.append(input,state.tip,b);
state=await store.append(input,state.tip,{kind:'KNOWN_FAILURE',attemptId:b.attemptId,providerState:'RESPONDED',
  code:'RATE_LIMITED',cooldown:{scope:'provider',key:b.route.provider,notBeforeMs:5000}});
store=createPostgresPoolJournalStore(options); // independent instance after loss of process-local state
state=(await store.read(input)).state;
assert.deepEqual(state.validated[0],frozen);
assert.equal(state.remainingAttempts,2);
const selection=selectModelPool({
  routes:[won.route,b.route,route('c')].map(r=>({...r,admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],
    catalog:'PRESENT',catalogValidUntilMs:10000})),
  taskClass:'analysis',nowMs:100,rotation:0,remainingAttempts:state.remainingAttempts,
  attemptedRouteIds:state.attempts.map(a=>a.route.id),
  cooldowns:state.failures.map(f=>f.result.cooldown).filter(Boolean),frozen:frozen.start.route,
  unresolvedAttempt:state.unresolved,
});
assert.equal(selection.status,'READY');
assert.deepEqual(selection.routes.map(r=>r.id),['c']);
const c=start('c',1);
state=await store.append(input,state.tip,c);
state=await store.append(input,state.tip,await validate(input,c));
assert.equal(state.validated.length,2);
assert.deepEqual(state.validated[0],frozen);
assert.deepEqual(calls,[won.route.id,'c']);
assert.equal(state.attempts.length,3);
await assert.rejects(store.append(input,state.tip,start('d',1)),/START_REJECTED/);
await assert.rejects(store.admit(input,5,randomUUID()),/ADMISSION_CONFLICT/);
assert.equal(await createPostgresWorkStore(options).readCompletion(preparePoolJournal(input).workFingerprint),null);
await assert.rejects(store.read({...input,request:{...input.request,packet:{...input.request.packet,packetId:'relabelled'}}}),/ADMISSION_MISMATCH/);
const legacy=requestFor('pool-legacy-test');
assert.equal(await createPostgresWorkStore(options).reserve(preparePoolJournal(legacy).workFingerprint,randomUUID()),true);
assert.equal((await store.admit(legacy,4,randomUUID())).status,'LEGACY_UNRESOLVED');
const ambiguous=requestFor('pool-ambiguous-test');
const root=await store.admit(ambiguous,4,randomUUID());
const lost=start('lost',0);
const loseAck=createPostgresPoolJournalStore({...options,clientFactory:()=>{
  const client=new Client({connectionString});
  return {connect:()=>client.connect(),end:()=>client.end(),async query(sql,values){
    const result=await client.query(sql,values);
    if(sql==='COMMIT')throw Error('SIMULATED_COMMIT_ACK_LOST');
    return result;
  }};
}});
await assert.rejects(loseAck.append(ambiguous,root.state.tip,lost),/SIMULATED_COMMIT_ACK_LOST/);
const pending=(await store.read(ambiguous)).state;
assert.equal(pending.pending.attemptId,lost.attemptId);
assert.equal(pending.unresolved,true);
await assert.rejects(store.append(ambiguous,pending.tip,start('retry',0)),/START_REJECTED/);
const unknown=await store.append(ambiguous,pending.tip,{kind:'UNKNOWN',attemptId:lost.attemptId,code:'EXECUTION_UNKNOWN'});
assert.equal(unknown.unresolved,true);
await assert.rejects(store.append(ambiguous,unknown.tip,start('retry2',0)));
const client=new Client({connectionString});
try{
  await client.connect();
  for(const statement of [
    'UPDATE dw_ledger.work_pool_journal SET ordinal=ordinal',
    'DELETE FROM dw_ledger.work_pool_journal',
    'TRUNCATE dw_ledger.work_pool_journal',
  ])await assert.rejects(client.query(statement),{code:'42501'});
}finally{await client.end();}
console.log('POOL_ATTEMPT_JOURNAL_PG_PASS concurrent_winners=1 restart_validated=2 original_replayed=0 known_failures=1 unknown_blocked=true legacy_takeover=false completion=false');

// Exercise the composed executor against independent real database clients.
const {runPooledDurablePilot2}=await import('../../src/dreaming/pooled-durable-pilot2.ts');
const {ProviderAdapterError}=await import('../../src/dreaming/openai-provider-adapter.ts');
const composed=requestFor('pooled-executor-pg');
const dispatched=[];
const candidate=(id,fail=false)=>({...route(id),admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],
  catalog:'PRESENT',catalogValidUntilMs:100000,
  async infer(){
    dispatched.push(id);
    if(fail)throw new ProviderAdapterError('RATE_LIMITED','synthetic 429',{status:429,retryAfterMs:5000,providerState:'RESPONDED'});
    return {provider:route(id).provider,model:route(id).model,finishReason:'stop',
      text:JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[{
        type:'FACT',claim:'Synthetic observation.',source_refs:[{source_ref:'fixture:pool',evidence_hash:'sha256:fixture'}],
      }]})};
  },
});
const policy={routes:[candidate('a'),candidate('b',true),candidate('c')],taskClass:'analysis',
  maxAttempts:4,maxInvocations:2,rotation:0,cooldowns:[],clock:()=>100};
const invoke=p=>runPooledDurablePilot2(composed,p,createPostgresPoolJournalStore(options),createPostgresWorkStore(options));
const partial=await invoke(policy);
assert.equal(partial.decision,'BUDGET_EXHAUSTED');
assert.deepEqual(dispatched,['a','b']);
assert.equal(await createPostgresWorkStore(options).readCompletion(preparePoolJournal(composed).workFingerprint),null);
const held=(await createPostgresPoolJournalStore(options).read(composed)).state.validated[0];
const done=await invoke({...policy,maxInvocations:1,rotation:partial.nextRotation});
assert.equal(done.decision,'COMMITTED');
assert.deepEqual(dispatched,['a','b','c']);
assert.deepEqual(done.completion.records.map(r=>r.origin.route.id),['a','c']);
const durable=await createPostgresPoolJournalStore(options).read(composed);
assert.deepEqual(durable.state.validated[0],held);
assert.equal(done.completion.checkpoint.resultFingerprint,durable.state.tip);
assert.deepEqual(await createPostgresWorkStore(options).readCompletion(preparePoolJournal(composed).workFingerprint),done.completion);
const replay=await invoke({...policy,routes:[],maxInvocations:0});
assert.equal(replay.decision,'ALREADY_PROCESSED');
assert.equal(replay.attemptedPasses,0);
assert.deepEqual(replay.completion,done.completion);
assert.deepEqual(dispatched,['a','b','c']);
console.log('POOLED_EXECUTOR_PG_PASS attempts=3 valid=2 restart_calls=1 replay_calls=0 completion=verified');
