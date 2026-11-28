// Offline verifier for the second held-out live experiment; no network or database.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fingerprintProposal,sha256Fingerprint} from '../../../src/dreaming/proposal-schema.ts';
import {prepareSourceBatchExecution} from '../../../src/dreaming/source-batch-receipt.ts';
import {preparePoolJournal,replayPoolJournal} from '../../../src/dreaming/pool-attempt-journal.ts';
import {buildPoolCompletion} from '../../../src/dreaming/pool-completion.ts';
import {parseCritiqueArtifact} from '../../../src/dreaming/pilot2-critique.ts';

const base=new URL('./',import.meta.url);
const read=name=>readFileSync(new URL(name,base));
const json=name=>JSON.parse(read(name));
const rows=name=>read(name).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=json('heldout-live-v3-manifest.json');

assert.equal(manifest.schema,'theseus.dw-heldout-live-evidence.v2');
assert.equal(sha(read('heldout-source.json')),manifest.fixture_sha256);
for(const [name,entry] of Object.entries(manifest.files))assert.equal(sha(read(name)),entry.sha256,name);

const live=rows('heldout-live-v3-observations.jsonl');
const run=live.find(r=>r.kind==='result');
assert.equal(run.status,'ACKNOWLEDGED');
assert.equal(run.physicalCalls,4);
assert.equal(run.fixtureReads,1);
assert.equal(run.work.length,1);
assert.equal(run.work[0].workFingerprint,manifest.work_fingerprint);
assert.equal(run.receiptFingerprint,manifest.receipt_fingerprint);
assert.equal(run.tipFingerprint,manifest.receipt_fingerprint);
const transports=live.filter(r=>r.kind==='transport');
assert.deepEqual(transports.map(r=>[r.route,r.status,r.finish]),[
  ['step-nous',200,'length'],
  ['ernie-openrouter',200,'stop'],
  ['hy4-nous',200,'length'],
  ['solar-nous',200,'stop'],
]);
assert.ok(transports.every(r=>r.cost===0));

const replay=rows('heldout-live-v3-replay.jsonl');
assert.equal(replay.filter(r=>r.kind==='attempt').length,0);
assert.equal(replay.filter(r=>r.kind==='transport').length,0);
const replayResult=replay.find(r=>r.kind==='result');
assert.equal(replayResult.status,'ALREADY_ACKNOWLEDGED');
assert.equal(replayResult.attemptedPasses,0);
assert.equal(replayResult.physicalCalls,0);
assert.equal(replayResult.receiptFingerprint,manifest.receipt_fingerprint);

const readback=json('heldout-live-v3-readback.json');
assert.equal(readback.schema,'theseus.dreaming-worker.heldout-live-readback.v3');
assert.equal(readback.analysisVersion,manifest.analysisVersion);
assert.equal(readback.plan.workFingerprint,manifest.work_fingerprint);
assert.ok(readback.checkpoints.some(c=>
  c.fingerprint===manifest.receipt_fingerprint &&
  c.schema==='theseus.dreaming-worker.source-batch-receipt.v2'));
assert.equal(readback.completion.workFingerprint,manifest.work_fingerprint);

const fixture=json('heldout-source.json');
const root=readback.checkpoints.find(c=>c.previous===null);
assert.ok(root);
const batch={
  candidate:fixture.candidate,
  expected:fixture.expected,
  entries:fixture.entries,
  maxSessions:1,
  previousCheckpoint:root.fingerprint,
  task:'Held-out synthetic Birch hypothesis.',
  analysisVersion:manifest.analysisVersion,
  bounds:{maxPages:4,maxChars:1000,maxMessages:10},
};
const {plan:canonicalPlan,prepared}=prepareSourceBatchExecution(batch);
assert.equal(prepared.length,1);
assert.equal(canonicalPlan.planFingerprint,run.planFingerprint);
assert.equal(canonicalPlan.planFingerprint,readback.plan.planFingerprint);
assert.equal(canonicalPlan.previousCheckpoint,readback.plan.previousCheckpoint);
assert.equal(canonicalPlan.work.length,1);
assert.equal(canonicalPlan.work[0].workFingerprint,readback.plan.workFingerprint);
readback.journal.forEach((row,i)=>assert.equal(row.ordinal,i));
const journalEntries=readback.journal.map(x=>JSON.parse(x.entryJson));
const journalState=replayPoolJournal(preparePoolJournal(prepared[0].input),journalEntries);
assert.equal(journalState.unresolved,false);
assert.deepEqual(journalState.entries.map(x=>x.event.kind),[
  'ADMIT','START','KNOWN_FAILURE','START','VALIDATED','START','KNOWN_FAILURE','START','VALIDATED',
]);
assert.deepEqual(journalState.failures.map(x=>x.result.code),[
  'OUTPUT_BUDGET_EXHAUSTED','OUTPUT_BUDGET_EXHAUSTED',
]);
assert.deepEqual(journalState.validated.map(x=>x.start.route.id),['ernie-openrouter','solar-nous']);

const completion=buildPoolCompletion(prepared[0].input,journalState.entries);
assert.equal(completion.checkpoint.workFingerprint,readback.completion.workFingerprint);
assert.equal(completion.checkpoint.requestFingerprint,readback.completion.requestFingerprint);
assert.equal(completion.checkpoint.resultFingerprint,readback.completion.resultFingerprint);
assert.equal(completion.projectionFingerprint,readback.completion.projectionFingerprint);
assert.deepEqual(completion.observed,JSON.parse(readback.completion.observedJson));

assert.equal(readback.proposals.length,9);
assert.deepEqual([...new Set(readback.proposals.map(p=>p.routeId))].sort(),
  ['ernie-openrouter','solar-nous']);
assert.equal(readback.proposals.filter(p=>p.routeId==='ernie-openrouter').length,5);
assert.equal(readback.proposals.filter(p=>p.routeId==='solar-nous').length,4);
const storedById=new Map(readback.proposals.map(p=>[p.recordId,p]));
assert.equal(storedById.size,completion.records.length);
for(const record of completion.records){
  const stored=storedById.get(record.recordId);
  assert.ok(stored,'reconstructed completion record must exist in Neon export');
  assert.equal(stored.proposalFingerprint,record.proposalFingerprint);
  assert.equal(stored.routeId,record.origin.route.id);
  assert.equal(stored.routeModel,record.origin.route.model);
  assert.equal(stored.proposalType,record.proposal.type);
  assert.deepEqual(JSON.parse(stored.proposalJson),record.proposal);
}

const perspectives=journalState.validated.map(v=>({
  perspectiveId:v.start.route.id,
  route:v.start.route,
  proposals:v.result.proposalSet.proposals.map(proposal=>({
    proposalFingerprint:fingerprintProposal(proposal),proposal,
  })),
}));
const critiqueInput={
  schema:'theseus.dreaming-worker.critique-input.v1',
  pilot2Outcome:'COMPLETE',
  packetId:journalState.validated[0].result.receipt.packetId,
  evidenceFingerprint:journalState.validated[0].result.receipt.evidenceFingerprint,
  requestFingerprint:journalState.validated[0].result.receipt.requestFingerprint,
  perspectives,
  failedPerspectives:[],
};
const critiqueInputHash=sha256Fingerprint(JSON.stringify(critiqueInput));

const control=rows('heldout-critique-raw-4096.jsonl');
assert.equal(control.filter(r=>r.kind==='attempt').length,1);
assert.equal(control.filter(r=>r.kind==='transport').length,1);
const controlInput=control.find(r=>r.kind==='input');
const controlTransport=control.find(r=>r.kind==='transport');
const controlResult=control.find(r=>r.kind==='critique');
assert.equal(controlInput.inputHash,critiqueInputHash);
assert.equal(controlTransport.status,200);
assert.equal(controlTransport.finish,'length');
assert.equal(controlTransport.cost,0);
assert.equal(controlResult.outcome,'FAILED');
assert.equal(controlResult.failure.code,'CRITIQUE_JSON_INVALID');
assert.equal(controlResult.calls,1);
assert.equal(controlResult.receipt.bounds.maxOutputTokens,4096);
assert.equal(controlResult.receipt.externalModelCalls,1);
assert.equal(controlResult.receipt.canonicalWrites,0);
assert.ok(controlResult.rawModelOutput.length>0);
assert.throws(()=>parseCritiqueArtifact(controlResult.rawModelOutput,critiqueInput),/CRITIQUE_JSON_INVALID/);

const success=rows('heldout-critique-raw-8192.jsonl');
assert.equal(success.filter(r=>r.kind==='attempt').length,1);
assert.equal(success.filter(r=>r.kind==='transport').length,1);
const successInput=success.find(r=>r.kind==='input');
const successTransport=success.find(r=>r.kind==='transport');
const successResult=success.find(r=>r.kind==='critique');
assert.equal(successInput.inputHash,critiqueInputHash);
assert.equal(successTransport.status,200);
assert.equal(successTransport.finish,'stop');
assert.equal(successTransport.cost,0);
assert.equal(successResult.outcome,'CRITIQUED');
assert.equal(successResult.calls,1);
assert.equal(successResult.receipt.bounds.maxOutputTokens,8192);
assert.equal(successResult.receipt.externalModelCalls,1);
assert.equal(successResult.receipt.canonicalWrites,0);
assert.equal(successResult.artifact.authority,'DERIVED_ONLY');
assert.deepEqual(parseCritiqueArtifact(successResult.rawModelOutput,critiqueInput),successResult.artifact);
assert.ok(successResult.artifact.relations.some(r=>r.relation==='AGREEMENT'));
assert.ok(successResult.artifact.relations.some(r=>r.relation==='DISAGREEMENT'));

const proposalFingerprints=new Set(readback.proposals.map(p=>p.proposalFingerprint));
const evidenceHashes=new Set(
  fixture.entries[0].index.sessions[0].messages.map(m=>'sha256:'+m.text_sha256),
);
for(const relation of successResult.artifact.relations){
  for(const ref of relation.proposal_refs)assert.ok(proposalFingerprints.has(ref.proposal_fingerprint));
  for(const ref of relation.evidence_refs)assert.ok(evidenceHashes.has(ref.evidence_hash));
}
console.log('HELDOUT_LIVE_V3_PARTIAL_EVIDENCE_PASS live_calls=4 validated=2 replay_calls=0 raw_critique_controls=2 completion_reconstructed=true source_receipt_payload=NOT_RETAINED full_proposal_rows=NOT_RETAINED');
