// Synthetic in-process contract against the exact SS native browse candidate.
// No live network, credential, SQL connection, or deployment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireSourceBatch } from '../src/dreaming/source-batch-acquire.ts';
import { prepareSourceBatchPlan } from '../src/dreaming/source-batch-receipt.ts';
import { sha256Fingerprint } from '../src/dreaming/proposal-schema.ts';

const root=resolve(process.argv[2]);
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'94279cd75cc00ca356d237e9451f647e92cb7b15');
assert.equal(execFileSync('git',['-C',root,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}),'');
const {makeRouterHandler}=await import(pathToFileURL(root+'/functions/router/handler.mjs'));
const {makeShardHandler}=await import(pathToFileURL(root+'/functions/shard/handler.mjs'));
const fixture=JSON.parse(readFileSync(new URL('../test/fixtures/source-reader.json',import.meta.url),'utf8'));
const input={
  candidate:fixture.candidate,expected:fixture.expected,
  indexes:fixture.entries.map(e=>({sessionId:e.session_id,index:e.index})),
  bounds:{maxPages:20,maxChars:1000,maxMessages:50},maxSessions:2,
  task:'Synthetic native browse probe.',analysisVersion:'native-probe-v1',
  previousCheckpoint:sha256Fingerprint('synthetic-root'),
};
const budget={maxRequests:20,maxPageBytes:8000,maxTotalBytes:100000,timeoutMs:1000,pageMessages:2,pageChars:3};
const catalog=fixture.expected.catalog.map(c=>({...c,url:'https://'+c.shard_id+'.test/search'}));
const dispatched=[];
const shards=new Map(catalog.map(c=>[c.shard_id,makeShardHandler(async call=>{
  assert.match(call.text,/read_generation_session_v1/);
  const [gen,sid,ordinal,mid,offset,limit,chars]=call.values;
  const entry=fixture.entries.find(e=>e.session_id===sid&&e.index.shard_id===c.shard_id);
  assert.equal(gen,entry.index.generation_id);
  assert.equal(limit,2);
  assert.equal(chars,3);
  const i=mid===null?0:entry.pages.findIndex(p=>p.next_position?.ordinal===ordinal
    &&p.next_position.message_id===mid&&p.next_position.offset===offset)+1;
  assert.ok(i>=0&&i<entry.pages.length);
  if(mid===null) assert.deepEqual([ordinal,offset],[0,0]);
  const {next_cursor,coverage_complete,queried_shards,unavailable_shards,generation_binding,...body}=entry.pages[i];
  dispatched.push(c.shard_id);
  return body;
},{authToken:'synthetic-shard'})]));
function router(vector) {
  return makeRouterHandler({
    catalog:vector,authToken:'synthetic-router',shardAuthToken:'synthetic-shard',
    sessionBrowseAuthToken:'synthetic-worker',
    fetchImpl:async(url,init)=>shards.get(new URL(url).hostname.replace(/\.test$/,'')).fetch(new Request(url,init)),
  });
}
const transport=(handler,token)=>(body,signal)=>handler.fetch(new Request('https://router.test/session-browse',{
  method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify(body),signal,
}));
const acquired=await acquireSourceBatch(input,budget,transport(router(catalog),'synthetic-worker'));
const expected={...input,entries:fixture.entries.map(e=>({sessionId:e.session_id,index:e.index,pages:e.pages}))};
assert.deepEqual(prepareSourceBatchPlan(acquired),prepareSourceBatchPlan(expected));
assert.equal(dispatched.length,12);
const before=dispatched.length;
await assert.rejects(()=>acquireSourceBatch(input,budget,transport(router(catalog),'synthetic-router')));
assert.equal(dispatched.length,before);
const staleShard=fixture.candidate.selected[0].shard_id;
await assert.rejects(()=>acquireSourceBatch(input,budget,transport(router(catalog.map(c=>c.shard_id===staleShard?
  {...c,generation_id:'f'.repeat(64)}:c)),'synthetic-worker')));
assert.equal(dispatched.length,before);
console.log('NATIVE_BROWSE_ACQUISITION_PASS router=actual shard=actual SQL=recorded_pages requests=12 wrong_token=blocked stale_generation=blocked');
