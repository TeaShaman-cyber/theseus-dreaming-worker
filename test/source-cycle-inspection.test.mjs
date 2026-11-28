import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { inspectSourceCycle } from '../tools/agent/inspect-source-cycle.mjs';
import { prepareSourceBatchExecution } from '../src/dreaming/source-batch-receipt.ts';
import { preparePoolJournal, poolJournalAdmission, makePoolJournalEntry, replayPoolJournal } from '../src/dreaming/pool-attempt-journal.ts';
import { runPilot1 } from '../src/dreaming/pilot1-runner.ts';
import { buildPoolCompletion } from '../src/dreaming/pool-completion.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/source-reader.json',import.meta.url),'utf8'));
const batch=()=>structuredClone({
  candidate:fixture.candidate,expected:fixture.expected,analysisVersion:'inspect-v1',task:'Synthetic inspection.',
  maxSessions:2,bounds:{maxPages:20,maxChars:1000,maxMessages:50},previousCheckpoint:'sha256:'+'1'.repeat(64),
  entries:fixture.entries.map(e=>({sessionId:e.session_id,index:e.index,pages:e.pages})),
});
async function journalState(input,mode){
  const context=preparePoolJournal(input);
  const entries=[makePoolJournalEntry(null,poolJournalAdmission(context,4))];
  const add=event=>entries.push(makePoolJournalEntry(entries.at(-1),event));
  for(const [slot,id] of ['a','b'].entries()){
    const start={kind:'START',attemptId:randomUUID(),slot,route:{id,provider:id,model:id,modelFamily:id}};
    add(start);
    if(mode==='pending'&&slot===1)break;
    const run=await runPilot1(input.request,async()=>({provider:id,model:id,finishReason:'stop',
      text:JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[{
        type:'FACT',claim:'SYNTHETIC_BODY_NOT_IN_REPORT',
        source_refs:input.request.packet.evidence.map(e=>({source_ref:e.sourceRef,evidence_hash:e.evidenceHash})),
      }]})}));
    assert.equal(run.outcome,'PROPOSED');
    const {packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,externalModelCalls,toolsUsed,memoryUsed,canonicalWrites}=run.receipt;
    add({kind:'VALIDATED',attemptId:start.attemptId,receipt:{packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,externalModelCalls,toolsUsed,memoryUsed,canonicalWrites},proposalSet:run.proposalSet});
  }
  return {status:'JOURNAL',ownerToken:'OWNER_TOKEN_NOT_IN_REPORT',completionExists:mode==='complete',state:replayPoolJournal(context,entries)};
}
function readers(x){
  const {plan,prepared}=prepareSourceBatchExecution(x);
  const journal=new Map(),completions=new Map();
  const calls=[];
  return {plan,prepared,journal,completions,calls, deps:{
    source:{async readTip(){calls.push('tip');return {receiptFingerprint:x.previousCheckpoint};},
      async readPlans(){calls.push('plans');return [plan];}},
    journal:{async read(input){calls.push('journal');return journal.get(preparePoolJournal(input).workFingerprint)??{status:'ABSENT'};}},
    work:{async readCompletion(id){calls.push('completion');return completions.get(id)??null;}},
  }};
}
test('synthetic diagnostic preserves complete and unknown observations without exposing content',async()=>{
  const x=batch(),r=readers(x);
  const [a,b]=r.prepared;
  const complete=await journalState(a.input,'complete'),pending=await journalState(b.input,'pending');
  r.journal.set(a.workFingerprint,complete);r.journal.set(b.workFingerprint,pending);
  r.completions.set(a.workFingerprint,buildPoolCompletion(a.input,complete.state.entries));
  const report=await inspectSourceCycle(x,r.deps);
  assert.equal(report.snapshot,'INDEPENDENT_READS');
  assert.equal(report.tip.status,'PARENT');
  assert.equal(report.plan.status,'MATCHED');
  assert.deepEqual(report.work.map(w=>w.status),['POOL_COMPLETION_MATCHED','BLOCKED_UNKNOWN']);
  assert.deepEqual(report.work.map(w=>w.validated),[2,1]);
  assert.equal(report.work[1].pendingAttemptId,pending.state.pending.attemptId);
  assert.equal(report.work[1].remainingAttempts,2);
  assert.equal(report.resumeAuthorized,false);
  assert.equal(report.sourceCustodyVerified,false);
  assert.doesNotMatch(JSON.stringify(report),/SYNTHETIC_BODY_NOT_IN_REPORT|OWNER_TOKEN_NOT_IN_REPORT/);
  assert.equal(r.calls.length,6);
});
test('missing records are not completed; independent read errors and contradictory completion are explicit',async()=>{
  const x=batch(),r=readers(x);
  let report=await inspectSourceCycle(x,r.deps);
  assert.deepEqual(report.work.map(w=>w.status),['NOT_ADMITTED','NOT_ADMITTED']);
  r.deps.source.readTip=async()=>{throw Error('private error body');};
  r.deps.source.readPlans=async()=>[];
  const [a,b]=r.prepared;
  const complete=await journalState(a.input,'complete');
  r.completions.set(a.workFingerprint,buildPoolCompletion(a.input,complete.state.entries));
  r.deps.journal.read=async input=>{if(preparePoolJournal(input).workFingerprint===b.workFingerprint)throw Error('private error body');return {status:'ABSENT'};};
  report=await inspectSourceCycle(x,r.deps);
  assert.equal(report.tip.status,'UNKNOWN');
  assert.equal(report.plan.status,'ABSENT');
  assert.deepEqual(report.work.map(w=>w.status),['READ_INCONSISTENT','UNKNOWN']);
  assert.doesNotMatch(JSON.stringify(report),/private error body/);
});
test('invalid or non-synthetic witness fails before any reader is called',async()=>{
  const x=batch(),r=readers(x);
  x.candidate.scope='private:chatgpt';
  await assert.rejects(()=>inspectSourceCycle(x,r.deps));
  assert.deepEqual(r.calls,[]);
  const wrong=batch();wrong.previousCheckpoint='invalid';
  await assert.rejects(()=>inspectSourceCycle(wrong,r.deps));
  assert.deepEqual(r.calls,[]);
});
