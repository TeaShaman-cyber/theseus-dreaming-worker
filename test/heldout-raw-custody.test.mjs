import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareSourceBatchExecution} from '../src/dreaming/source-batch-receipt.ts';
import {runPilot1} from '../src/dreaming/pilot1-runner.ts';
import {captureInference,verifyCapturedPerspective} from '../research/model-pool/live-acceptance/raw-custody.mjs';
const base=new URL('../research/model-pool/live-acceptance/',import.meta.url);
const json=n=>JSON.parse(readFileSync(new URL(n,base)));
const fixture=json('heldout-source.json'),db=json('heldout-live-v5-readback.json');
const root=db.checkpoints.find(c=>c.previous===null);
const {prepared}=prepareSourceBatchExecution({candidate:fixture.candidate,expected:fixture.expected,entries:fixture.entries,maxSessions:1,previousCheckpoint:root.fingerprint,task:'Held-out synthetic Birch hypothesis.',analysisVersion:'live-birch-124-v5',bounds:{maxPages:4,maxChars:1000,maxMessages:10}});
const request=prepared[0].input.request;
const event=db.journal.find(j=>j.entry.event.kind==='VALIDATED').entry.event;
// This is a synthetic test response constructed from retained proposals, NOT historical provider text.
const synthetic={text:JSON.stringify(event.proposalSet),provider:event.receipt.provider,model:event.receipt.model,finishReason:'stop'};
const routeId='synthetic-test';
test('capture exact text and correlation before proposal parser; replay matches journal',async()=>{
 const rows=[];
 const result=await runPilot1(request,captureInference(routeId,async()=>synthetic,r=>rows.push(r)));
 assert.equal(rows.length,1);
 assert.equal(rows[0].text,synthetic.text);
 assert.equal(rows[0].textSha256,createHash('sha256').update(synthetic.text).digest('hex'));
 await verifyCapturedPerspective(request,routeId,rows[0],event);
 assert.deepEqual(result.proposalSet,event.proposalSet);
 const bad=structuredClone(rows[0]);bad.text+=' ';
 await assert.rejects(verifyCapturedPerspective(request,routeId,bad,event),/RAW_DIGEST/);
 bad.textSha256=createHash('sha256').update(bad.text).digest('hex');
 bad.requestFingerprint='wrong';
 await assert.rejects(verifyCapturedPerspective(request,routeId,bad,event),/RAW_CORRELATION/);
});
test('capture failure rejects before proposal parsing and no non-synthetic dispatch',async()=>{
 await assert.rejects(runPilot1(request,captureInference(routeId,async()=>synthetic,()=>{throw Error('SINK_FAILED');})),/SINK_FAILED/);
 let invoked=0;
 await assert.rejects(runPilot1({...request,scope:'PUBLICATION_SAFE'},captureInference(routeId,async()=>{invoked++;return synthetic;},()=>{})),/RAW_SCOPE/);
 assert.equal(invoked,0);
});
