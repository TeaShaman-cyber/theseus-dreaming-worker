import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { preparePoolJournal, poolJournalAdmission, makePoolJournalEntry, replayPoolJournal } from '../src/dreaming/pool-attempt-journal.ts';

const input = {
  acceptedSourceFingerprint:'sha256:'+'a'.repeat(64), analysisVersion:'pool-v1',
  request:{scope:'SYNTHETIC_FIXTURE',task:'Analyze fixture.',packet:{
    schema:'theseus-evidence-packet-v1',packetId:'pool-fixture',acceptedNewEvidence:true,
    coverage:{state:'COMPLETE',currentness:'CURRENT'},evidence:[{sourceRef:'fixture:1',evidenceHash:'sha256:fixture',text:'Synthetic observation.'}],
  }},
};
const ctx=preparePoolJournal(input);
const route=(id,family=id)=>({id,provider:'provider-'+id,model:'model-'+id,modelFamily:family});
const start=(id,slot,family=id)=>({kind:'START',attemptId:randomUUID(),slot,route:route(id,family)});
const success=(s)=>({kind:'VALIDATED',attemptId:s.attemptId,receipt:{
  packetId:ctx.request.packet.packetId,requestFingerprint:ctx.requestFingerprint,evidenceFingerprint:ctx.evidenceFingerprint,
  provider:s.route.provider,model:s.route.model,finishReason:'stop',externalModelCalls:1,toolsUsed:0,memoryUsed:false,canonicalWrites:0,
},proposalSet:{schema:'theseus.dreaming-worker.proposals.v1',proposals:[{
  type:'FACT',claim:'Synthetic observation.',source_refs:[{source_ref:'fixture:1',evidence_hash:'sha256:fixture'}],
}]}});
const failed=s=>({kind:'KNOWN_FAILURE',attemptId:s.attemptId,providerState:'RESPONDED',code:'RATE_LIMITED',
  cooldown:{scope:'provider',key:s.route.provider,notBeforeMs:5000}});
const journal=(events,budget=4)=>[poolJournalAdmission(ctx,budget),...events].reduce((acc,e)=>[...acc,makePoolJournalEntry(acc.at(-1)??null,e)],[]);
const replay=(events,budget)=>replayPoolJournal(ctx,journal(events,budget));

test('known failure preserves immutable first result; second route fills only missing slot',()=>{
  const a=start('a',0),b=start('b',1),c=start('c',1);
  const partial=replay([a,success(a),b,failed(b)]);
  assert.equal(partial.unresolved,false);
  assert.equal(partial.validated.length,1);
  assert.equal(partial.remainingAttempts,2);
  assert.equal(partial.failures[0].result.cooldown.notBeforeMs,5000);
  const full=replay([a,success(a),b,failed(b),c,success(c)]);
  assert.deepEqual(full.validated[0],partial.validated[0]);
  assert.equal(full.validated.length,2);
  assert.equal(full.attempts.length,3);
  assert.throws(()=>replay([a,success(a),b,failed(b),c,success(c),start('d',1)]),/START_REJECTED/);
});
test('pending, unknown, wrong attempt and replayed route never admit replacement',()=>{
  const a=start('a',0),b=start('b',1),c=start('c',0);
  assert.equal(replay([a]).unresolved,true);
  assert.throws(()=>replay([a,c]),/START_REJECTED/);
  assert.equal(replay([a,{kind:'UNKNOWN',attemptId:a.attemptId,code:'TIMEOUT'}]).unresolved,true);
  assert.throws(()=>replay([a,{kind:'UNKNOWN',attemptId:a.attemptId,code:'TIMEOUT'},c]));
  assert.throws(()=>replay([a,success(b)]),/OUTCOME_MISMATCH/);
  assert.throws(()=>replay([a,failed(a),start('a',0)]),/START_REJECTED/);
  assert.throws(()=>replay([a,success(a),start('z',1,'a')]),/START_REJECTED/);
  assert.throws(()=>replay([a,failed(a),c,failed(c),start('z',0)],2),/START_REJECTED/);
});
test('tampered chain, changed request, invented evidence and invalid cooldown reject',()=>{
  const a=start('a',0),entries=journal([a,success(a)]);
  const changed=structuredClone(entries);changed[1].entryFingerprint='sha256:'+'f'.repeat(64);
  assert.throws(()=>replayPoolJournal(ctx,changed),/CHAIN/);
  assert.throws(()=>replayPoolJournal(preparePoolJournal({...input,request:{...input.request,task:'Changed.'}}),entries),/ADMISSION_MISMATCH/);
  const bad=success(a);bad.proposalSet.proposals[0].source_refs[0].evidence_hash='invented';
  assert.throws(()=>replay([a,bad]),/PROVENANCE_REJECTED/);
  const f=failed(a);f.cooldown.key='other';
  assert.throws(()=>replay([a,f]),/COOLDOWN_SCOPE/);
  assert.throws(()=>preparePoolJournal({...input,request:{...input.request,packet:{...input.request.packet,acceptedNewEvidence:false}}}),/NO_ADMISSIBLE_WORK/);
});
