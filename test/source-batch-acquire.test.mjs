import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { acquireSourceBatch } from '../src/dreaming/source-batch-acquire.ts';
import { prepareSourceBatchPlan } from '../src/dreaming/source-batch-receipt.ts';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/source-reader.json',import.meta.url),'utf8'));
const input=()=>structuredClone({
  candidate:fixture.candidate,expected:fixture.expected,
  indexes:fixture.entries.map(e=>({sessionId:e.session_id,index:e.index})),
  bounds:{maxPages:20,maxChars:1000,maxMessages:50},
  maxSessions:2,task:'Synthetic acquisition.',analysisVersion:'acquire-v1',
  previousCheckpoint:sha256Fingerprint('synthetic-root'),
});
const budgets={maxRequests:20,maxPageBytes:8000,maxTotalBytes:100000,timeoutMs:1000,pageMessages:2,pageChars:3};
function reader(transform=(page)=>Response.json(page)) {
  const calls=[];
  const transport=async (request,signal)=>{
    assert.equal(signal.aborted,false);
    calls.push(request);
    const entry=fixture.entries.find(e=>e.session_id===request.session_id);
    assert.equal(request.generation_id,entry.index.generation_id);
    assert.equal(request.shard_id,entry.index.shard_id);
    assert.equal(request.limit,2);
    assert.equal(request.max_chars,3);
    const i=request.cursor?entry.pages.findIndex(p=>p.next_cursor===request.cursor)+1:0;
    assert.ok(i>=0&&i<entry.pages.length);
    return transform(structuredClone(entry.pages[i]),i);
  };
  return {calls,transport};
}
test('bounded acquisition follows native cursors and returns exactly verified work',async()=>{
  const x=input(),{calls,transport}=reader();
  const result=await acquireSourceBatch(x,budgets,transport);
  assert.equal(calls.length,12);
  const expected={...x,entries:fixture.entries.map(e=>({sessionId:e.session_id,index:e.index,pages:e.pages}))};
  assert.deepEqual(prepareSourceBatchPlan(result),prepareSourceBatchPlan(expected));
  assert.equal(Object.hasOwn(result,'indexes'),false);
});
test('wrong or missing source indexes fail before transport',async()=>{
  const x=input(),{calls,transport}=reader();
  x.indexes[1].index.generation_id='0'.repeat(64);
  await assert.rejects(()=>acquireSourceBatch(x,budgets,transport),/INDEX_BINDING/);
  await assert.rejects(()=>acquireSourceBatch({...input(),indexes:[]},budgets,transport));
  assert.equal(calls.length,0);
});
test('wrong generation or cursor fails before a subsequent request',async()=>{
  for(const change of [
    p=>({...p,generation_id:'0'.repeat(64)}),
    p=>({...p,next_cursor:Buffer.from(JSON.stringify({v:1,s:'other',shard:p.shard_id,g:p.generation_id,o:0,mid:'m-u',offset:3})).toString('base64url')}),
  ]){
    const {calls,transport}=reader(p=>Response.json(change(p)));
    await assert.rejects(()=>acquireSourceBatch(input(),budgets,transport));
    assert.equal(calls.length,1);
  }
});
test('response byte, aggregate and request limits stop acquisition',async()=>{
  for(const limit of [{maxPageBytes:32},{maxTotalBytes:1200},{maxRequests:1}]){
    const {calls,transport}=reader();
    await assert.rejects(()=>acquireSourceBatch(input(),{...budgets,...limit},transport),/SOURCE_ACQUIRE_/);
    assert.ok(calls.length<=2);
  }
});
test('truncated text or blocked response is never admitted',async()=>{
  for(const transform of [
    p=>Response.json({...p,has_more:false,next_cursor:null,next_position:null}),
    ()=>Response.json({status:'BLOCKED'}),
    ()=>new Response('unavailable',{status:503}),
  ]){
    const {transport}=reader(transform);
    await assert.rejects(()=>acquireSourceBatch(input(),budgets,transport));
  }
});
test('deadline covers stalled transport and stalled response body',async()=>{
  for(const transport of [
    async()=>new Promise(()=>{}),
    async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}),
  ]) await assert.rejects(()=>acquireSourceBatch(input(),{...budgets,timeoutMs:10},transport),/SOURCE_ACQUIRE_TIMEOUT/);
});
