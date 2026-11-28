import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareSourceBatchExecution,sourceReceiptFingerprint} from '../../../src/dreaming/source-batch-receipt.ts';
import {preparePoolJournal,replayPoolJournal} from '../../../src/dreaming/pool-attempt-journal.ts';
import {buildPoolCompletion} from '../../../src/dreaming/pool-completion.ts';

const base=new URL('./',import.meta.url);
const read=name=>readFileSync(new URL(name,base));
const json=name=>JSON.parse(read(name));
const rows=name=>read(name).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=json('heldout-live-v5-manifest.json');
assert.equal(manifest.schema,'theseus.dreaming-worker.heldout-live-evidence.v5');
for(const [name,meta] of Object.entries(manifest.files)){
  const bytes=read(name); assert.equal(sha(bytes),meta.sha256,name); assert.equal(bytes.length,meta.bytes,name);
}

const fixture=json('heldout-source.json');
const observed=rows('heldout-live-v5-observations.jsonl');
const replay=rows('heldout-live-v5-replay.jsonl');
const readback=json('heldout-live-v5-readback.json');
const summary=json('heldout-live-v5-receipt.json');
assert.equal(readback.schema,'theseus.dreaming-worker.heldout-live-readback.v5');
assert.equal(readback.analysisVersion,manifest.analysisVersion);
assert.equal(summary.analysis_version,manifest.analysisVersion);
assert.equal(summary.fixture_sha256,manifest.files['heldout-source.json'].sha256);

const attempts=observed.filter(x=>x.kind==='attempt');
const transports=observed.filter(x=>x.kind==='transport');
const result=observed.find(x=>x.kind==='result');
assert.equal(attempts.length,2);
assert.deepEqual(attempts.map(x=>x.route),['solar-nous','step-nous']);
assert.deepEqual(transports.map(x=>[x.route,x.status,x.finish,x.cost,x.usage?.total_tokens]),[
  ['solar-nous',200,'stop',0,3308],['step-nous',200,'stop',0,6047],
]);
assert.equal(result.status,'ACKNOWLEDGED');
assert.equal(result.physicalCalls,2); assert.equal(result.fixtureReads,1); assert.equal(result.attemptedPasses,2);

assert.equal(replay.filter(x=>x.kind==='attempt').length,0);
assert.equal(replay.filter(x=>x.kind==='transport').length,0);
const replayResult=replay.find(x=>x.kind==='result');
assert.equal(replayResult.status,'ALREADY_ACKNOWLEDGED'); assert.equal(replayResult.physicalCalls,0);
assert.equal(replayResult.attemptedPasses,0);

assert.equal(readback.checkpoints.length,2);
const root=readback.checkpoints.find(x=>x.previous===null);
const final=readback.checkpoints.find(x=>x.previous!==null);
assert.ok(root&&final);
for(const checkpoint of readback.checkpoints){
  assert.equal(checkpoint.fingerprint,checkpoint.receipt.receiptFingerprint);
  const {receiptFingerprint,...payload}=checkpoint.receipt;
  assert.equal(sourceReceiptFingerprint(payload),receiptFingerprint);
}
assert.equal(final.previous,root.fingerprint);
assert.equal(final.receipt.schema,'theseus.dreaming-worker.source-batch-receipt.v2');

const batch={candidate:fixture.candidate,expected:fixture.expected,entries:fixture.entries,maxSessions:1,
  previousCheckpoint:root.fingerprint,task:'Held-out synthetic Birch hypothesis.',analysisVersion:manifest.analysisVersion,
  bounds:{maxPages:4,maxChars:1000,maxMessages:10}};
const {plan,prepared}=prepareSourceBatchExecution(batch);
assert.equal(prepared.length,1);
assert.equal(readback.plan.chainId,readback.checkpoints[0].chainId);
assert.equal(readback.plan.previousCheckpoint,root.fingerprint);
assert.equal(readback.plan.planFingerprint,plan.planFingerprint);
assert.deepEqual(readback.plan.plan,plan);

assert.equal(readback.journal.length,5);
readback.journal.forEach((row,i)=>assert.equal(row.ordinal,i));
const journalState=replayPoolJournal(preparePoolJournal(prepared[0].input),readback.journal.map(x=>x.entry));
assert.equal(journalState.unresolved,false);
assert.deepEqual(journalState.entries.map(x=>x.event.kind),['ADMIT','START','VALIDATED','START','VALIDATED']);
assert.deepEqual(journalState.validated.map(x=>x.start.route.id),['solar-nous','step-nous']);

const completion=buildPoolCompletion(prepared[0].input,journalState.entries);
assert.equal(readback.completion.workFingerprint,completion.checkpoint.workFingerprint);
assert.equal(readback.completion.requestFingerprint,completion.checkpoint.requestFingerprint);
assert.equal(readback.completion.resultFingerprint,completion.checkpoint.resultFingerprint);
assert.equal(readback.completion.projectionFingerprint,completion.projectionFingerprint);
assert.deepEqual(readback.completion.observed,completion.observed);

assert.equal(readback.membership.length,completion.records.length);
assert.equal(readback.proposals.length,completion.records.length);
assert.equal(new Set(readback.proposals.map(x=>x.eventSeq)).size,readback.proposals.length);
const proposals=new Map(readback.proposals.map(x=>[x.recordId,x]));
completion.records.forEach((record,i)=>{
  const member=readback.membership[i];
  assert.equal(member.ordinal,i); assert.equal(member.workFingerprint,completion.checkpoint.workFingerprint);
  assert.equal(member.recordId,record.recordId);
  const stored=proposals.get(record.recordId); assert.ok(stored);
  assert.equal(stored.schemaName,record.schema); assert.equal(stored.authority,record.authority);
  assert.equal(stored.proposalFingerprint,record.proposalFingerprint);
  assert.equal(stored.packetId,record.origin.packetId);
  assert.equal(stored.evidenceFingerprint,record.origin.evidenceFingerprint);
  assert.equal(stored.requestFingerprint,record.origin.requestFingerprint);
  assert.equal(stored.perspectiveId,record.origin.perspectiveId);
  assert.equal(stored.routeId,record.origin.route.id); assert.equal(stored.routeProvider,record.origin.route.provider);
  assert.equal(stored.routeModel,record.origin.route.model); assert.equal(stored.routeModelFamily,record.origin.route.modelFamily);
  assert.equal(stored.proposalType,record.proposal.type); assert.deepEqual(stored.proposal,record.proposal);
});

assert.equal(readback.origins.length,1);
const sourceReceipt=final.receipt;
assert.equal(sourceReceipt.previousCheckpoint,root.fingerprint);
assert.equal(sourceReceipt.currentPlanFingerprint,plan.planFingerprint);
assert.equal(sourceReceipt.work.length,1);
assert.equal(sourceReceipt.work[0].workFingerprint,completion.checkpoint.workFingerprint);
assert.equal(sourceReceipt.work[0].completionFingerprint,completion.projectionFingerprint);
assert.equal(sourceReceipt.work[0].originalPacketId,plan.work[0].packetId);
assert.deepEqual(sourceReceipt.work[0].currentWitness,plan.work[0].witness);
assert.equal(readback.origins[0].chainId,readback.plan.chainId);
const {chainId:_originChain,...storedOrigin}=readback.origins[0];
assert.deepEqual(sourceReceipt.origins,[storedOrigin]);
assert.equal(sourceReceipt.origins[0].workFingerprint,completion.checkpoint.workFingerprint);
assert.equal(sourceReceipt.origins[0].previousCheckpoint,root.fingerprint);
assert.equal(sourceReceipt.origins[0].planFingerprint,plan.planFingerprint);

assert.equal(result.receiptFingerprint,sourceReceipt.receiptFingerprint);
assert.equal(result.tipFingerprint,sourceReceipt.receiptFingerprint);
assert.equal(replayResult.receiptFingerprint,sourceReceipt.receiptFingerprint);
assert.equal(summary.status,'ACKNOWLEDGED'); assert.equal(summary.physical_model_calls,2);
assert.equal(summary.work_fingerprint,completion.checkpoint.workFingerprint);
assert.equal(summary.projection_fingerprint,completion.projectionFingerprint);
assert.equal(summary.source_receipt_fingerprint,sourceReceipt.receiptFingerprint);
assert.equal(summary.proposal_count,completion.records.length);
assert.deepEqual(summary.proposal_types,[...new Set(completion.records.map(x=>x.proposal.type))].sort());
assert.deepEqual(summary.authority,[...new Set(completion.records.map(x=>x.authority))].sort());
assert.equal(summary.replay.status,'ALREADY_ACKNOWLEDGED'); assert.equal(summary.replay.physical_model_calls,0);

console.log('HELDOUT_LIVE_V5_ACCEPTANCE_PASS calls=2 validated=2 proposals=9 source_receipt=reconstructed replay_calls=0');
