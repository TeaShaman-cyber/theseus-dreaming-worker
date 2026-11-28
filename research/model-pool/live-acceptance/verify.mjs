// Offline replay of exact observed artifacts; does not call providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePoolJournal,replayPoolJournal} from '../../../src/dreaming/pool-attempt-journal.ts';
import {buildPoolCompletion} from '../../../src/dreaming/pool-completion.ts';
import {parseProposalSet,sha256Fingerprint,fingerprintProposal} from '../../../src/dreaming/proposal-schema.ts';
import {parseCritiqueArtifact} from '../../../src/dreaming/pilot2-critique.ts';
const read=name=>readFileSync(new URL(name,import.meta.url));
const manifest=JSON.parse(read('manifest.json'));
for(const [name,entry] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(read(name)).digest('hex'),entry.retained_sha256);
const cases=read('../quality/cases.json');
assert.equal(createHash('sha256').update(cases).digest('hex'),'f328422d67be4f318ee1398fc8f9da183d5ac97994a78721fa9d3f6616dcc84f');
const {request}=JSON.parse(cases).cases.find(c=>c.id==='signal');
const input={request,acceptedSourceFingerprint:sha256Fingerprint(JSON.stringify(request.packet.evidence)),analysisVersion:'live-pool-124-v1'};
const rows=name=>read(name).toString().trim().split('\n').map(JSON.parse);
const first=rows('observations.jsonl'),second=rows('continuation.jsonl'),critique=rows('critique.jsonl');
const get=(r,k)=>r.find(x=>x.kind===k);
const initial=get(first,'journal').entries,final=get(second,'journal').entries;
assert.deepEqual(final.slice(0,initial.length),initial);
assert.deepEqual(get(second,'restored_journal').entries,initial);
const context=preparePoolJournal(input);
const state=replayPoolJournal(context,final);
assert.equal(state.attempts.length,4);
assert.equal(state.validated.length,2);
assert.equal(state.unresolved,false);
assert.deepEqual(state.failures.map(x=>x.result.code),['INVALID_SCHEMA','RATE_LIMITED']);
assert.deepEqual(buildPoolCompletion(input,final),get(second,'completion').completion);
for(const t of second.filter(r=>r.kind==='transport')){
 const v=state.validated.find(v=>v.start.route.id===t.route);
 assert.deepEqual(parseProposalSet(t.rawFinal,request.packet),v.result.proposalSet);
}
assert.equal(get(second,'replay').attemptedPasses,0);
const c=get(critique,'input').input;
for(const p of c.perspectives){
 const v=state.validated.find(v=>v.start.route.id===p.perspectiveId);
 assert.deepEqual(p.route,v.start.route);
 assert.deepEqual(p.proposals,v.result.proposalSet.proposals.map(proposal=>({proposalFingerprint:fingerprintProposal(proposal),proposal})));
}
const result=get(critique,'critique').result;
assert.deepEqual(parseCritiqueArtifact(result.rawModelOutput,c),result.artifact);
assert.equal(result.artifact.relations[0].relation,'UNRESOLVED');
const transports=[...first,...second,...critique].filter(r=>r.kind==='transport');
assert.equal(transports.length,5);
assert.equal(transports.filter(r=>r.status===200).length,4);
assert.equal(transports.reduce((sum,r)=>sum+(r.usage?.total_tokens??0),0),11592);
console.log('LIVE_ACCEPTANCE_REPLAY_PASS calls=5 validated=2 critique=1 reported_tokens=11592 semantic_acceptance=NOT_ESTABLISHED');
