// Offline observation verification, not a claim of model semantic quality.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {proposalSetSchema,parseProposalSet} from '../../../src/dreaming/proposal-schema.ts';
const read=name=>readFileSync(new URL(name,import.meta.url));
const fixture=read('./cases.json');
assert.equal(createHash('sha256').update(fixture).digest('hex'),'f328422d67be4f318ee1398fc8f9da183d5ac97994a78721fa9d3f6616dcc84f');
const c=JSON.parse(fixture).cases.find(x=>x.id==='authority');
const rows=name=>read(name).toString().trim().split('\n').map(JSON.parse);
const a=rows('./nim-reasoning-observation.jsonl'),b=rows('./nim-native-schema-observation.jsonl');
for(const rs of [a,b]){
 assert.deepEqual(rs.map(r=>r.kind),['catalog','attempt','case','end']);
 assert.deepEqual(rs[0].selected,['authority']);
 assert.equal(rs[0].cap,3072);
 assert.equal(rs[0].reasoningBudget,768);
 assert.equal(rs[1].attempt,1);
 assert.equal(rs[3].attempts,1);
 assert.equal(rs[2].status,'FAILED');
 assert.equal(rs[2].transport.finish,'stop');
 assert.equal(rs[2].transport.cost,null);
 assert.equal(rs[2].providerEvidence.usage.reasoningTokens,767);
 assert.equal(rs[2].transport.status,200);
}
assert.match(a[2].error,/PILOT1_PROPOSAL_SCHEMA_INVALID/);
const raw=b[2].transport.finalContent;
const decoded=JSON.parse(raw);
assert.ok(proposalSetSchema.safeParse(decoded).success);
assert.throws(()=>parseProposalSet(raw,c.request.packet),/PILOT1_PROVENANCE_REJECTED/);
const mismatches=decoded.proposals.flatMap(p=>p.source_refs).filter(ref=>{
 const e=c.request.packet.evidence.find(x=>x.sourceRef===ref.source_ref);
 assert.ok(e);
 return e.evidenceHash!==ref.evidence_hash;
});
assert.equal(mismatches.length,1);
assert.equal(mismatches[0].source_ref,'synthetic:authority:report');
assert.equal(mismatches[0].evidence_hash+'4',c.request.packet.evidence[0].evidenceHash);
console.log('NIM_REASONING_OBSERVATIONS_PASS');
