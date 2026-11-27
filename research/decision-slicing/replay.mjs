// Retrospective, advisory coverage audit. No automatic semantic mapping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseProposalSet } from '../../src/dreaming/proposal-schema.ts';
const read=name=>readFileSync(new URL('../model-pool/quality/'+name,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtures=read('cases.json'), observations=read('observations.json');
assert.equal(sha(fixtures),'f328422d67be4f318ee1398fc8f9da183d5ac97994a78721fa9d3f6616dcc84f');
assert.equal(sha(observations),'ba3f35fa68d992525b720aa7bd14f0d3aa43f16badc2b60bbf14f6c88bc1709f');
const {cases}=JSON.parse(fixtures);
const rows=JSON.parse(observations).rows.filter(r=>r.kind==='case'&&r.status==='VALIDATED');
assert.equal(rows.length,4);
// Reviewed mapping from existing rubric obligation to exact historical proposal
// index. Never inferred from a citation or from the proposal type.
const mapping={decision:[0,1],authority:[1,2],absence:[0,0],long:[0,1]};
const coverage=(refs,clauses)=>clauses.some(clause=>clause.every(ref=>refs.has(ref)));
const refs=p=>new Set(p.source_refs.map(r=>r.source_ref));
function audit(c,proposals,indices){
  const union=new Set(proposals.flatMap(p=>[...refs(p)]));
  return c.rubric.required.map((r,i)=>{
    const p=proposals[indices[i]];
    assert.ok(p,'missing reviewed claim');
    // Current rubric gives one conjunctive set; alternatives are tested separately.
    const clauses=[r.refs.map(s=>'synthetic:'+c.id+':'+s)];
    const cited=refs(p),typeAllowed=r.types.includes(p.type);
    return {obligation:i+1,proposal:indices[i]+1,packetCoverage:coverage(union,clauses),
      claimCoverage:typeAllowed&&coverage(cited,clauses),
      typeAllowed,missing:clauses[0].filter(s=>!cited.has(s))};
  });
}
function validated(c,proposals){
  return parseProposalSet(JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals}),c.request.packet).proposals;
}
const results=[];
for(const row of rows){
  const c=cases.find(x=>x.id===row.id), p=validated(c,row.proposals);
  const result=audit(c,p,mapping[row.id]);
  assert.deepEqual(result.map(x=>x.claimCoverage),row.semantic_review.required);
  results.push({id:c.id,obligations:result,manualAdditionalIssue:row.semantic_review.additional_fidelity_issue});
}
const count=key=>results.flatMap(r=>r.obligations).filter(o=>o[key]).length;
assert.equal(count('packetCoverage'),8);
assert.equal(count('claimCoverage'),7);
// Mutation controls: valid reference hashes do not establish entailment.
const long=cases.find(c=>c.id==='long'), original=rows.find(r=>r.id==='long').proposals;
const getRef=(c,s)=>{const e=c.request.packet.evidence.find(e=>e.sourceRef.endsWith(':'+s));return {source_ref:e.sourceRef,evidence_hash:e.evidenceHash};};
const amended=structuredClone(original);amended[0].source_refs.push(getRef(long,'list'));
assert.ok(audit(long,validated(long,amended),mapping.long).every(o=>o.claimCoverage));
const dropped=structuredClone(amended);dropped[0].source_refs=dropped[0].source_refs.filter(r=>!r.source_ref.endsWith(':list'));
const d=audit(long,validated(long,dropped),mapping.long);
assert.ok(d.every(o=>o.packetCoverage));assert.equal(d[0].claimCoverage,false);
const wrong=structuredClone(amended);wrong[0].claim='Cedar decisions 5 and 7 are approved.';
assert.ok(audit(long,validated(long,wrong),mapping.long).every(o=>o.claimCoverage));
// The last assertion is deliberately a known false positive, not success on semantics.
// A claim-to-obligation mapping is semantic input and cannot be trusted after a text mutation.

const U=['A','B','C'], clauses=[['A','B'],['B','C']];
const subsets=Array.from({length:8},(_,mask)=>new Set(U.filter((_,i)=>mask&(1<<i))));
const proper=(a,b)=>a.size<b.size&&[...a].every(x=>b.has(x));
const supports=subsets.filter(s=>coverage(s,clauses));
const cuts=subsets.filter(s=>!coverage(new Set(U.filter(x=>!s.has(x))),clauses));
const minimal=list=>list.filter(s=>!list.some(t=>proper(t,s))).map(s=>[...s].join('')).sort();
assert.deepEqual(minimal(supports),['AB','BC']);
assert.deepEqual(minimal(cuts),['AC','B']);
const decision=v=>v.includes('F')?'DENIED':v.every(x=>x==='T')?'ALLOW':'DEFER';
const table=['T','F','U'].flatMap(a=>['T','F','U'].flatMap(b=>['T','F','U'].map(c=>[a,b,c])));
assert.deepEqual(['ALLOW','DENIED','DEFER'].map(d=>table.filter(v=>decision(v)===d).length),[1,19,7]);
const current=['F','U','U'];
const sensitivity=current.map((_,i)=>decision(current.map((v,j)=>i===j?'U':v)));
assert.deepEqual(sensitivity,['DEFER','DENIED','DENIED']);
console.log(JSON.stringify({fixtureSha256:sha(fixtures),observationsSha256:sha(observations),
  retrospectiveCases:results,summary:{packetCoverage:count('packetCoverage'),claimCoverage:count('claimCoverage'),obligations:8},
  controls:{syntheticAddedRegisterPass:true,removeRegisterDetectedDespiteUnion:true,falseClaimWithValidRefsStillPasses:true,
    minimalSupports:minimal(supports),minimalCuts:minimal(cuts),truthAssignments:27,currentSensitivity:sensitivity}},null,2));
