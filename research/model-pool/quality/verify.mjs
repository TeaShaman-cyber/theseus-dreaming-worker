// Recheck observed evidence and manual-review bookkeeping, not semantic truth.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseProposalSet } from '../../../src/dreaming/proposal-schema.ts';
import { runPilot0 } from '../../../src/dreaming/dry-run.ts';
import { pilot1RequestFingerprint } from '../../../src/dreaming/pilot1-runner.ts';
// A missing/malformed value is unknown, never evidence of zero spend.
const isReportedZero=value=>value===0||value==='0';
for(const value of [null,undefined,false,true,'',' ',[],[0],{},'unknown',1,'1']){
 assert.equal(isReportedZero(value),false);
}
assert.equal(isReportedZero(0),true);
assert.equal(isReportedZero('0'),true);
const bytes=readFileSync(new URL('./cases.json',import.meta.url));
const {cases}=JSON.parse(bytes);
const o=JSON.parse(readFileSync(new URL('./observations.json',import.meta.url)));
assert.equal(o.fixture_sha256,createHash('sha256').update(bytes).digest('hex'));
assert.equal(o.rows.length,24);
let attempted=0,validated=0,rubricPass=0,clean=0;
for (const route of ['solar','ernie','tencent']){
 const rows=o.rows.filter(r=>r.route===route);
 assert.equal(rows.length,8);
 assert.equal(rows[0].kind,'catalog');
 assert.ok(rows[0].model.endsWith(':free'));
 assert.ok(Object.values(rows[0].pricing).every(v=>v===0||v==='0'));
 assert.deepEqual(rows.slice(1,-1).map(r=>r.id),cases.map(c=>c.id));
 assert.equal(rows.at(-1).kind,'end');
 assert.equal(rows.at(-1).attempts,6);
 for (const r of rows.slice(1,-1)){
  const c=cases.find(c=>c.id===r.id);
  assert.equal(r.kind,'case');assert.equal(r.transport.status,200);
  assert.ok(isReportedZero(r.transport.cost),'explicit reported zero cost required');
  assert.equal(r.transport.model,rows[0].model);
  attempted++;
  const evidence=runPilot0(c.request.packet).receipt.inputFingerprint;
  const request=pilot1RequestFingerprint(c.request.scope,c.request.task,evidence);
  assert.equal(r.providerEvidence.requestFingerprint,request);
  assert.equal(r.providerEvidence.evidenceFingerprint,evidence);
  if(r.status==='VALIDATED'){
   validated++;
   parseProposalSet(JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:r.proposals}),c.request.packet);
   assert.equal(r.receipt.requestFingerprint,request);
   assert.equal(r.receipt.externalModelCalls,1);
   assert.equal(r.receipt.canonicalWrites,0);
   const review=r.semantic_review;
   assert.equal(review.required.length,c.rubric.required.length);
   assert.ok(review.required.every(v=>typeof v==='boolean'));
   assert.ok(review.traps.every(t=>c.rubric.traps.includes(t)));
   // Verify structural support for each criterion marked satisfied; semantic judgement remains manual.
   for(const [i,passed] of review.required.entries()){
    if(passed) assert.ok(r.proposals.some(p=>c.rubric.required[i].types.includes(p.type)&&c.rubric.required[i].refs.every(ref=>p.source_refs.some(s=>s.source_ref==='synthetic:'+c.id+':'+ref))));
   }
   if(review.required.every(Boolean)&&!review.traps.length){
    rubricPass++;
    if(review.additional_fidelity_issue===null)clean++;
   }
  }else{
   assert.equal(r.status,'FAILED');
   assert.equal(r.semantic_review,null);
   assert.ok(!r.proposals);
  }
 }
}
assert.deepEqual({attempted,validated,rubricPass,clean},{attempted:18,validated:4,rubricPass:3,clean:2});
console.log('QUALITY_OBSERVATIONS_PASS',{attempted,validated,rubricPass,clean});
