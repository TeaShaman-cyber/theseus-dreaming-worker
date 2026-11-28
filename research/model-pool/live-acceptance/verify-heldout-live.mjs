// Offline verifier for the second held-out live experiment; no network or database.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fingerprintProposal,sha256Fingerprint} from '../../../src/dreaming/proposal-schema.ts';
import {prepareSourceBatchExecution} from '../../../src/dreaming/source-batch-receipt.ts';
import {preparePoolJournal,replayPoolJournal} from '../../../src/dreaming/pool-attempt-journal.ts';
import {parseCritiqueArtifact} from '../../../src/dreaming/pilot2-critique.ts';

const base=new URL('./',import.meta.url);
const read=name=>readFileSync(new URL(name,base));
const json=name=>JSON.parse(read(name));
const rows=name=>read(name).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=json('heldout-live-v3-manifest.json');

assert.equal(manifest.schema,'theseus.dw-heldout-live-evidence.v1');
assert.equal(sha(read('heldout-source.json')),manifest.fixture_sha256);
for(const [name,entry] of Object.entries(manifest.files))assert.equal(sha(read(name)),entry.sha256,name);

const watchdog=rows('heldout-live-v2-watchdog.jsonl');
const watchdogRead=json('heldout-live-v2-watchdog-readback.json');
assert.equal(watchdog.filter(r=>r.kind==='attempt').length,3);
assert.equal(watchdog.filter(r=>r.kind==='transport').length,2);
assert.equal(watchdog.some(r=>r.kind==='result'),false);
assert.equal(watchdogRead.completionCount,0);
assert.equal(watchdogRead.proposalCount,0);
assert.deepEqual(watchdogRead.journal.map(x=>x.event.kind),
  ['ADMIT','START','KNOWN_FAILURE','START','VALIDATED','START']);
assert.equal(watchdogRead.journal.at(-1).event.route.id,'hy4-nous');

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
assert.equal(readback.schema,'theseus.dreaming-worker.heldout-live-readback.v2');
assert.equal(readback.analysisVersion,manifest.analysisVersion);
assert.equal(readback.plan.workFingerprint,manifest.work_fingerprint);
assert.equal(readback.plan.planFingerprint,run.planFingerprint);
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
const prepared=prepareSourceBatchExecution(batch).prepared;
assert.equal(prepared.length,1);
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

assert.equal(readback.proposals.length,9);
assert.deepEqual([...new Set(readback.proposals.map(p=>p.routeId))].sort(),
  ['ernie-openrouter','solar-nous']);
assert.equal(readback.proposals.filter(p=>p.routeId==='ernie-openrouter').length,5);
assert.equal(readback.proposals.filter(p=>p.routeId==='solar-nous').length,4);
const canonicalByRoute=new Map(journalState.validated.map(v=>[
  v.start.route.id,
  new Map(v.result.proposalSet.proposals.map(proposal=>[fingerprintProposal(proposal),proposal])),
]));
for(const p of readback.proposals){
  const proposal=canonicalByRoute.get(p.routeId)?.get(p.proposalFingerprint);
  assert.ok(proposal,'stored proposal fingerprint must exist in validated journal');
  assert.deepEqual(JSON.parse(p.proposalJson),proposal);
}

const crit4096=rows('heldout-critique-v3-truncated.jsonl');
assert.equal(crit4096.find(r=>r.kind==='transport').finish,'length');
assert.equal(crit4096.find(r=>r.kind==='transport').cost,0);
const failedCrit=crit4096.find(r=>r.kind==='critique');
assert.equal(failedCrit.outcome,'FAILED');
assert.equal(failedCrit.failure.code,'CRITIQUE_JSON_INVALID');

const crit=rows('heldout-critique-v4.jsonl');
const critInputReceipt=crit.find(r=>r.kind==='input');
const critTransport=crit.find(r=>r.kind==='transport');
const critResult=crit.find(r=>r.kind==='critique');
assert.equal(critTransport.finish,'stop');
assert.equal(critTransport.cost,0);
assert.equal(critResult.outcome,'CRITIQUED');
assert.equal(critResult.artifact.authority,'DERIVED_ONLY');
assert.deepEqual(new Set(critResult.artifact.relations.map(r=>r.relation)),
  new Set(['AGREEMENT','DISAGREEMENT','UNRESOLVED']));

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
assert.equal(sha256Fingerprint(JSON.stringify(critiqueInput)),critInputReceipt.inputHash);
assert.deepEqual(parseCritiqueArtifact(JSON.stringify(critResult.artifact),critiqueInput),critResult.artifact);

const proposalFingerprints=new Set(readback.proposals.map(p=>p.proposalFingerprint));
const evidenceHashes=new Set(
  fixture.entries[0].index.sessions[0].messages.map(m=>'sha256:'+m.text_sha256),
);
for(const relation of critResult.artifact.relations){
  for(const ref of relation.proposal_refs)assert.ok(proposalFingerprints.has(ref.proposal_fingerprint));
  for(const ref of relation.evidence_refs)assert.ok(evidenceHashes.has(ref.evidence_hash));
}
console.log('HELDOUT_LIVE_REPLAY_PASS watchdog_pending=true live_calls=4 validated=2 proposals=9 replay_calls=0 critique_calls=2 critique_final=CRITIQUED');
