// Offline source preflight only: no model client, database or cloud dispatch.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {acquireSourceBatch} from '../../../src/dreaming/source-batch-acquire.ts';
import {prepareSourceBatchExecution} from '../../../src/dreaming/source-batch-receipt.ts';
import {sha256Fingerprint} from '../../../src/dreaming/proposal-schema.ts';
const fixtureSha='a933a58167902c34dfa36c150bb37d3836fdafe494901829f0fc026767e0de39';
export async function preflightHeldout(bytes){
 assert.equal(createHash('sha256').update(bytes).digest('hex'),fixtureSha,'FIXTURE_DIGEST');
 const fixture=JSON.parse(bytes);
 assert.equal(fixture.producer_commit,'3b7b5360050cc2ecdcb60f485a657f2b763751e4');
 assert.equal(fixture.candidate.scope,'synthetic:chatgpt');
 assert.equal(fixture.serving,'verified_bundle_rows_simulated_pages');
 assert.equal(fixture.entries.length,1);
 const input={
  candidate:fixture.candidate,expected:fixture.expected,
  indexes:fixture.entries.map(({sessionId,index})=>({sessionId,index})),
  previousCheckpoint:sha256Fingerprint('synthetic-preflight-only'),
  task:'Held-out synthetic Birch hypothesis.',
  analysisVersion:'live-birch-124-v1',maxSessions:1,
  bounds:{maxPages:4,maxChars:1000,maxMessages:10},
 };
 let fixtureReads=0;
 const entry=fixture.entries[0];
 const transport=async request=>{
  fixtureReads++;
  assert.equal(fixtureReads,1);
  assert.equal(request.session_id,entry.sessionId);
  assert.equal(request.shard_id,entry.index.shard_id);
  assert.equal(request.generation_id,entry.index.generation_id);
  assert.equal(request.cursor,undefined);
  assert.equal(entry.pages.length,1);
  return Response.json(entry.pages[0]);
 };
 const batch=await acquireSourceBatch(input,{maxRequests:4,maxPageBytes:12000,maxTotalBytes:24000,timeoutMs:1000,pageMessages:10,pageChars:1000},transport);
 const {plan,prepared}=prepareSourceBatchExecution(batch);
 assert.equal(plan.work.length,1);
 assert.equal(prepared.length,1);
 assert.equal(plan.checkpointAdvanced,false);
 return {status:'PREFLIGHT_ONLY',fixtureSha,selected:plan.work.length,
  evidence:prepared[0].input.request.packet.evidence.length,
  fixtureReads,externalCalls:0,checkpointAdvanced:plan.checkpointAdvanced,
  workFingerprint:plan.work[0].workFingerprint,currentness:plan.handoff.currentness,
  serving:fixture.serving};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log(JSON.stringify(await preflightHeldout(readFileSync(new URL('heldout-source.json',import.meta.url)))));
}
