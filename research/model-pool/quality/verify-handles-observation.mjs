// Offline readback of two bounded synthetic measurements.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {makeContext} from './packet-handles.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url));
const {cases}=JSON.parse(read('./cases.json'));
const ctx=makeContext(cases.find(c=>c.id==='authority').request);
const sha=s=>createHash('sha256').update(s).digest('hex');
const readRows=name=>read(name).toString().trim().split('\n').map(JSON.parse);
for(const [name,compatible,status] of [
 ['handles-schema-rejected.jsonl',false,400],
 ['handles-compatible-observation.jsonl',true,200],
]){
 const rows=readRows(name);
 assert.deepEqual(rows.map(r=>r.kind),['catalog','attempt','case','end']);
 const [catalog,attempt,observed,end]=rows;
 assert.equal(catalog.requestFingerprint,ctx.fingerprint);
 assert.equal(catalog.evidenceFingerprint,ctx.evidenceFingerprint);
 assert.equal(catalog.wireFingerprint,ctx.wireFingerprint);
 assert.equal(catalog.model,'nvidia/nemotron-3.5-lightning-30b-a3b');
 assert.equal(attempt.attempts,1);assert.equal(end.attempts,1);
 const schema=structuredClone(ctx.schema);
 if(compatible)for(const branch of schema.properties.proposals.items.oneOf)delete branch.properties.source_refs.uniqueItems;
 const body=JSON.stringify({model:catalog.model,messages:ctx.messages,max_tokens:3072,
   response_format:{type:'json_schema',json_schema:{name:'dreaming_handles',strict:true,schema}},
   stream:false,reasoning_budget:768});
 assert.equal(sha(body),attempt.wireBodySha256);
 assert.equal(Buffer.byteLength(body),attempt.bodyBytes);
 assert.equal(observed.transport.status,status);
 assert.equal(observed.transport.cost,null);
 if(compatible){
  assert.equal(observed.status,'VALIDATED');
  assert.equal(observed.transport.model,catalog.model);
  assert.equal(observed.transport.finish,'stop');
  assert.deepEqual(ctx.resolve(observed.rawFinal,'stop',ctx.fingerprint),observed.proposals);
  assert.equal(observed.usage.reasoningTokens,767);
 }else{
  assert.equal(observed.status,'FAILED');
  assert.equal(observed.rawFinal,null);
  assert.equal(observed.providerState,'RESPONDED');
 }
}
console.log('HANDLE_LIVE_OBSERVATION_READBACK_PASS');
