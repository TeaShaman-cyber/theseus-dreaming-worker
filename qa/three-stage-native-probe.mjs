import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPostgresSourceBatchStore } from '../src/dreaming/source-batch-postgres.ts';
import { runPooledSourceCycle } from '../src/dreaming/source-cycle.ts';
const pinned='94279cd75cc00ca356d237e9451f647e92cb7b15';
const childMode=process.argv[2]==='child';
const fixturePath=resolve(process.argv[3]);
const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
assert.equal(fixture.producer_commit,'3b7b5360050cc2ecdcb60f485a657f2b763751e4');
const url=new URL(process.env.LEDGER_DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');
assert.equal(url.pathname,'/dreaming_worker_contract');
const options={connectionString:url.href};
const limits={maxRequests:20,maxPageBytes:12000,maxTotalBytes:100000,timeoutMs:1000,pageMessages:100,pageChars:1000};
const makeInput=f=>({candidate:f.candidate,expected:f.expected,indexes:f.entries.map(e=>({sessionId:e.sessionId,index:e.index})),maxSessions:4,bounds:{maxPages:20,maxChars:1000,maxMessages:100},task:'Synthetic cross-generation native reader.',analysisVersion:'three-stage-native-v1'});
function router(f,makeRouterHandler,makeShardHandler){
 const dispatched=[];
 const catalog=f.expected.catalog.map(c=>({...c,url:'https://'+c.shard_id+'.test/search'}));
 const shards=new Map(catalog.map(c=>[c.shard_id,makeShardHandler(async call=>{
  assert.match(call.text,/read_generation_session_v1/);
  const [gen,sid,ordinal,mid,offset]=call.values;
  const e=f.entries.find(e=>e.sessionId===sid&&e.index.shard_id===c.shard_id);
  assert.ok(e);assert.equal(gen,e.index.generation_id);assert.deepEqual([ordinal,mid,offset],[0,null,0]);
  const {next_cursor,coverage_complete,queried_shards,unavailable_shards,generation_binding,...body}=e.pages[0];
  dispatched.push([c.shard_id,gen,sid]);return body;
 },{authToken:'synthetic-shard'})]));
 const handler=makeRouterHandler({catalog,authToken:'synthetic-router',shardAuthToken:'synthetic-shard',sessionBrowseAuthToken:'synthetic-worker',fetchImpl:async(url,init)=>shards.get(new URL(url).hostname.replace(/\.test$/,'')).fetch(new Request(url,init))});
 const transport=(body,signal)=>handler.fetch(new Request('https://router.test/session-browse',{method:'POST',headers:{authorization:'Bearer synthetic-worker','content-type':'application/json'},body:JSON.stringify(body),signal}));
 return {dispatched,transport};
}
let calls=0;
const routes=['a','b'].map(id=>({id,provider:'fixture-'+id,model:'fixture-'+id,modelFamily:id,admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:100000,async infer(request){calls++;return {provider:'fixture-'+id,model:'fixture-'+id,finishReason:'stop',text:JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[{type:'FACT',claim:'Synthetic observation '+id,source_refs:request.packet.evidence.map(e=>({source_ref:e.sourceRef,evidence_hash:e.evidenceHash}))}]})};}}));

const store=createPostgresSourceBatchStore(options);
const run=(input,transport,store,maxInvocations)=>runPooledSourceCycle(input,{limits,transport,store,policy:{routes,taskClass:'analysis',maxAttempts:4,maxInvocations,rotation:0,cooldowns:[],clock:()=>100}});
if(childMode){
 const root=resolve(process.argv[4]);
 const {makeRouterHandler}=await import(pathToFileURL(root+'/functions/router/handler.mjs'));
 const {makeShardHandler}=await import(pathToFileURL(root+'/functions/shard/handler.mjs'));
 const {input,stage,budget}=JSON.parse(readFileSync(0,'utf8'));
 assert.ok(stage==='first'||stage==='last');
 const result=await run(input,router(fixture[stage],makeRouterHandler,makeShardHandler).transport,store,budget);
 console.log(JSON.stringify({result,calls,pid:process.pid}));
}else{
 assert.equal(process.argv.length,4);
 const source=resolve(process.argv[2]);
 assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),pinned);
 // Archive tracked bytes only. Never import from an existing dependency symlink.
 const root=mkdtempSync(join(tmpdir(),'dw-native-handlers-'));
 try{
  const archive=execFileSync('git',['-C',source,'archive',pinned],{maxBuffer:128*1024*1024});
  execFileSync('tar',['-x','-C',root],{input:archive});
  const functions=join(root,'functions');
  const lock=readFileSync(join(functions,'package-lock.json'));
  execFileSync('npm',['ci','--ignore-scripts','--offline','--no-audit','--no-fund'],{cwd:functions,stdio:['ignore','ignore','pipe'],timeout:120000});
  assert.deepEqual(readFileSync(join(functions,'package-lock.json')),lock);
  execFileSync('npm',['ls','--all','--json'],{cwd:functions,maxBuffer:8*1024*1024});
  const pids=new Set([process.pid]);
  function isolated(input,stage,budget,expectedCalls){
   const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'child',fixturePath,root],{input:JSON.stringify({input,stage,budget}),encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
   assert.ifError(child.error);
   assert.equal(child.status,0,child.stderr+child.stdout);
   const result=JSON.parse(child.stdout);
   assert.ok(!pids.has(result.pid),'expected fresh process');
   pids.add(result.pid);
   assert.equal(result.calls,expectedCalls);
   return result.result;
  }
  const first=makeInput(fixture.first),empty=makeInput(fixture.empty),last=makeInput(fixture.last);
  const rootReceipt=await store.initialize(first);
  assert.equal(rootReceipt.status,'ACKNOWLEDGED');
  first.previousCheckpoint=rootReceipt.receipt.receiptFingerprint;
  const firstDone=isolated(first,'first',4,4);
  assert.equal(firstDone.status,'ACKNOWLEDGED');
  empty.previousCheckpoint=firstDone.run.receipt.receiptFingerprint;
  const deny=async()=>{throw Error('No work expected');};
  const noWorkCycle=await run(empty,deny,store,0);
  assert.equal(noWorkCycle.status,'NO_SELECTED_WORK');
  assert.equal(calls,0);
  assert.deepEqual(await store.readTip(empty),firstDone.run.receipt);
  const emptyDone=await store.acknowledgeNoWork(empty);
  assert.equal(emptyDone.status,'ACKNOWLEDGED');
  assert.equal(emptyDone.receipt.attemptedPasses,0);
  assert.deepEqual(await store.readTip(empty),emptyDone.receipt);
  assert.equal((await store.acknowledgeNoWork(empty)).status,'ALREADY_ACKNOWLEDGED');
  last.previousCheckpoint=firstDone.run.receipt.receiptFingerprint;
  assert.equal(isolated(last,'last',4,0).status,'CONFLICT');
  last.previousCheckpoint=emptyDone.receipt.receiptFingerprint;
  assert.equal(isolated(last,'last',2,2).status,'BUDGET_EXHAUSTED');
  assert.deepEqual(await store.readTip(last),emptyDone.receipt);
  const lastDone=isolated(last,'last',2,2);
  assert.equal(lastDone.status,'ACKNOWLEDGED');
  assert.equal(lastDone.run.receipt.previousCheckpoint,emptyDone.receipt.receiptFingerprint);
  assert.deepEqual(await store.readTip(last),lastDone.run.receipt);
  const replay=isolated(last,'last',0,0);
  assert.equal(replay.status,'ALREADY_ACKNOWLEDGED');
  assert.deepEqual(replay.run.receipt,lastDone.run.receipt);
  assert.equal(pids.size,6);
  console.log('THREE_STAGE_NATIVE_PG_PASS first=2 empty=0 last=2 synthetic_calls=4+0+4 fresh_children=5 locked_dependencies=clean_archive_npm_ci stale_parent=blocked replay_calls=0 external_inference=0');
 }finally{
  rmSync(root,{recursive:true,force:true});
 }
}
