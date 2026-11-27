import assert from 'node:assert/strict';
import test from 'node:test';
import { runPooledDurablePilot2 } from '../src/dreaming/pooled-durable-pilot2.ts';
import { ProviderAdapterError } from '../src/dreaming/openai-provider-adapter.ts';
import { PoolStartDeferred, preparePoolJournal, poolJournalAdmission, makePoolJournalEntry, replayPoolJournal } from '../src/dreaming/pool-attempt-journal.ts';

const request = {
  acceptedSourceFingerprint:'sha256:'+'a'.repeat(64),analysisVersion:'pooled-executor-test',
  request:{scope:'SYNTHETIC_FIXTURE',task:'Analyze fixture.',packet:{
    schema:'theseus-evidence-packet-v1',packetId:'pool-fixture',acceptedNewEvidence:true,
    coverage:{state:'COMPLETE',currentness:'CURRENT'},
    evidence:[{sourceRef:'fixture:1',evidenceHash:'sha256:fixture',text:'Synthetic observation.'}],
  }},
};
const proposal={type:'FACT',claim:'Synthetic observation.',source_refs:[{source_ref:'fixture:1',evidence_hash:'sha256:fixture'}]};
const body=JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[proposal]});
const route=(id,calls,behavior='success',extra={})=>({
  id,provider:'provider-'+id,model:'model-'+id,modelFamily:id,admission:'FREE_RESEARCH',
  qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:100000,
  async infer(){
    calls.push(id);
    if(behavior==='429')throw new ProviderAdapterError('RATE_LIMITED','fixture rate limit',{status:429,retryAfterMs:5000,providerState:'RESPONDED'});
    if(behavior==='unknown')throw new ProviderAdapterError('TIMEOUT','fixture timeout',{providerState:'UNKNOWN'});
    if(behavior==='generic')throw Error('unclassified callback failure');
    if(behavior==='402')throw new ProviderAdapterError('HTTP_ERROR','fixture payment required',{status:402,providerState:'RESPONDED'});
    return {provider:'provider-'+id,model:behavior==='wrong-model'?'wrong': 'model-'+id,
      finishReason:behavior==='length'?'length':'stop',
      text:behavior==='duplicate'?JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[proposal,proposal]}):body};
  },...extra,
});
const policy=(routes,extra={})=>({routes,taskClass:'analysis',maxAttempts:4,maxInvocations:4,rotation:0,cooldowns:[],clock:()=>100,...extra});
function fake({loseStartAck=false,loseOutcomeAck=false,loseCompleteAck=false}={}){
  let entries=[],ownerToken=null,completion=null;
  const state=raw=>replayPoolJournal(preparePoolJournal(raw),entries);
  const read=async raw=>entries.length?{status:'JOURNAL',ownerToken,completionExists:completion!==null,state:state(raw)}:{status:'ABSENT'};
  const journal={read,async admit(raw,max,owner){
    if(!entries.length){ownerToken=owner;entries=[makePoolJournalEntry(null,poolJournalAdmission(preparePoolJournal(raw),max))];}
    return read(raw);
  },async append(raw,tip,event){
    assert.equal(tip,state(raw).tip);
    const next=[...entries,makePoolJournalEntry(entries.at(-1),event)];
    replayPoolJournal(preparePoolJournal(raw),next);
    entries=next;
    if(loseStartAck&&event.kind==='START')throw Error('simulated lost start ack');
    if(loseOutcomeAck&&event.kind==='VALIDATED')throw Error('simulated lost outcome ack');
    return state(raw);
  }};
  const workStore={async readCompletion(){return structuredClone(completion);},async complete(owner,candidate){
    assert.equal(owner,ownerToken);assert.equal(completion,null);completion=structuredClone(candidate);
    if(loseCompleteAck)throw Error('simulated lost completion ack');
  }};
  return {journal,workStore,run:(p,r=request)=>runPooledDurablePilot2(r,p,journal,workStore),get state(){return state(request);}};
}
test('resumes only missing slot after typed 429, commits, and replays with no calls',async()=>{
  const calls=[],store=fake({loseCompleteAck:true});
  const p=policy([route('a',calls),route('b',calls,'429'),route('c',calls)]);
  const first=await store.run({...p,maxInvocations:2});
  assert.equal(first.decision,'BUDGET_EXHAUSTED');assert.equal(first.attemptedPasses,2);
  assert.deepEqual(calls,['a','b']);
  const frozen=structuredClone(store.state.validated[0]);
  assert.equal(store.state.failures[0].result.cooldown.notBeforeMs,5100);
  const next=await store.run({...p,maxInvocations:1,rotation:first.nextRotation});
  assert.equal(next.decision,'COMMITTED');assert.equal(next.attemptedPasses,1);
  assert.deepEqual(calls,['a','b','c']);
  assert.deepEqual(store.state.validated[0],frozen);
  assert.equal(next.completion.checkpoint.resultFingerprint,store.state.tip);
  assert.deepEqual(next.completion.records.map(r=>r.origin.route.id),['a','c']);
  const again=await store.run({...p,routes:[],maxInvocations:0});
  assert.equal(again.decision,'ALREADY_PROCESSED');assert.equal(again.attemptedPasses,0);
  assert.deepEqual(again.completion,next.completion);
  assert.deepEqual(calls,['a','b','c']);
});
test('unknown callback outcome and uncertain start cannot grant another dispatch',async()=>{
  for(const behavior of ['unknown','generic']){
    const calls=[],store=fake(),p=policy([route('a',calls,behavior),route('b',calls),route('c',calls)]);
    assert.equal((await store.run(p)).decision,'BLOCKED_UNKNOWN');
    assert.equal((await store.run(p)).attemptedPasses,0);
    assert.deepEqual(calls,['a']);
  }
  const calls=[],store=fake({loseStartAck:true}),p=policy([route('a',calls),route('b',calls)]);
  assert.equal((await store.run(p)).decision,'STORAGE_UNKNOWN');
  assert.equal((await store.run(p)).decision,'BLOCKED_UNKNOWN');
  assert.deepEqual(calls,[]);
});
test('lost successful outcome acknowledgement does not replay the frozen analysis',async()=>{
  const calls=[],store=fake({loseOutcomeAck:true});
  const p=policy([route('a',calls),route('b',calls)]);
  assert.equal((await store.run(p)).decision,'STORAGE_UNKNOWN');
  assert.deepEqual(calls,['a']);
  assert.equal((await store.run({...p,maxInvocations:1})).decision,'STORAGE_UNKNOWN');
  assert.deepEqual(calls,['a','b']);
  assert.equal((await store.run({...p,maxInvocations:0})).decision,'COMMITTED');
  assert.deepEqual(calls,['a','b']);
});
test('invalid artifacts and refused billing do not freeze a slot or select unapproved routes',async()=>{
  for(const behavior of ['wrong-model','duplicate','length','402']){
    const calls=[],store=fake();
    const p=policy([route('a',calls,behavior),route('b',calls),route('c',calls),
      route('paid',calls,'success',{admission:'NOT_AUTHORIZED'})]);
    const out=await store.run(p);
    assert.equal(out.decision,'COMMITTED',behavior);
    assert.deepEqual(calls,['a','b','c']);
    assert.equal(store.state.validated.length,2);
    assert.equal(store.state.failures.length,1);
    if(behavior==='402')assert.equal(store.state.failures[0].result.cooldown.notBeforeMs,Number.MAX_SAFE_INTEGER);
  }
});
test('no-data, inadequate budget and no eligible pair have zero callbacks',async()=>{
  const calls=[],store=fake(),p=policy([route('a',calls),route('b',calls)]);
  const noData={...request,request:{...request.request,packet:{...request.request.packet,acceptedNewEvidence:false}}};
  assert.equal((await store.run(p,noData)).decision,'NO_DATA');
  assert.equal((await store.run({...p,maxInvocations:1})).decision,'BUDGET_EXHAUSTED');
  assert.equal((await store.run({...p,routes:[route('a',calls),route('b',calls,'success',{admission:'UNKNOWN'})]})).decision,'INSUFFICIENT_ELIGIBILITY');
  assert.equal((await store.journal.read(request)).status,'ABSENT');
  assert.deepEqual(calls,[]);
});
test('full external cooldown set plus journal failure preserves all relevant restrictions',async()=>{
  const calls=[],store=fake();
  const cooldowns=Array.from({length:255},(_,i)=>({scope:'provider',key:'unrelated-'+i,notBeforeMs:9000}));
  cooldowns.push({scope:'route',key:'c',notBeforeMs:6000});
  const routes=[route('a',calls),route('b',calls,'429'),route('c',calls),route('d',calls,'success',{provider:'provider-b'})];
  const p=policy(routes,{cooldowns});
  const first=await store.run(p);
  assert.equal(first.decision,'DEFERRED');
  assert.equal(first.wakeAtMs,5100);
  assert.deepEqual(calls,['a','b']);
  const resumed=await store.run({...p,clock:()=>5100,rotation:first.nextRotation});
  assert.equal(resumed.decision,'COMMITTED');
  assert.deepEqual(calls,['a','b','d']);
});

test('shared cooldown prevents admission, expires, and locked deferral consumes no attempt',async()=>{
  const calls=[],store=fake(),p=policy([route('a',calls),route('b',calls)]);
  let clock=100;
  store.journal.readCooldowns=async providers=>{
    assert.deepEqual(providers,['provider-a','provider-b']);
    return [{scope:'provider',key:'provider-a',notBeforeMs:5100}];
  };
  const waiting=await store.run({...p,clock:()=>clock});
  assert.equal(waiting.decision,'DEFERRED');assert.equal(waiting.wakeAtMs,5100);
  assert.equal(waiting.attemptedPasses,0);
  assert.equal((await store.journal.read(request)).status,'ABSENT');
  clock=5100;
  const append=store.journal.append;
  store.journal.append=async (raw,tip,event)=>{
    if(event.kind==='START')throw new PoolStartDeferred(6100);
    return append(raw,tip,event);
  };
  const race=await store.run({...p,clock:()=>clock});
  assert.equal(race.decision,'DEFERRED');assert.equal(race.wakeAtMs,6100);
  assert.equal(race.attemptedPasses,0);assert.equal(store.state.attempts.length,0);
  assert.deepEqual(calls,[]);
  store.journal.append=append;clock=6100;
  assert.equal((await store.run({...p,clock:()=>clock})).decision,'COMMITTED');
  assert.deepEqual(calls,['a','b']);
});
test('shared cooldown is merged with local and caller restrictions; alternative is selected',async()=>{
  const calls=[],store=fake(),p=policy([route('a',calls),route('b',calls),route('c',calls),route('d',calls)]);
  store.journal.readCooldowns=async()=>[{scope:'provider',key:'provider-a',notBeforeMs:5100}];
  const next=await store.run({...p,cooldowns:[{scope:'provider',key:'provider-b',notBeforeMs:6100}]});
  assert.equal(next.decision,'COMMITTED');
  assert.deepEqual(calls,['c','d']);
});
