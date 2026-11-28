// One bounded live Dreaming Worker source-cycle experiment over frozen synthetic Birch evidence.
// Real model inference + PostgreSQL ledger; source pages remain the recorded verified synthetic fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runPooledSourceCycle} from '../../../src/dreaming/source-cycle.ts';
import {createPostgresSourceBatchStore} from '../../../src/dreaming/source-batch-postgres.ts';
import {createOpenAIChatInference} from '../../../src/dreaming/openai-provider-adapter.ts';

const FIXTURE_SHA='a933a58167902c34dfa36c150bb37d3836fdafe494901829f0fc026767e0de39';
const TASK='Held-out synthetic Birch hypothesis.';
const ANALYSIS_VERSION='live-birch-124-v2';
const ROUTES=[
  {id:'step-nous',provider:'nous',model:'stepfun/step-3.7-flash:free',modelFamily:'step3',baseURL:'https://nous.int.exe.xyz/v1'},
  {id:'ernie-openrouter',provider:'openrouter',model:'baidu/ernie-5.5-flash-preview:free',modelFamily:'ernie5',baseURL:'https://openrouter.int.exe.xyz/api/v1'},
  {id:'hy4-nous',provider:'nous',model:'tencent/hy4-flash:free',modelFamily:'hy4',baseURL:'https://nous.int.exe.xyz/v1'},
  {id:'particle-openrouter',provider:'openrouter',model:'particle-ai/particle-1:free',modelFamily:'particle1',baseURL:'https://openrouter.int.exe.xyz/api/v1'},
  {id:'solar-nous',provider:'nous',model:'upstage/solar-mini4:free',modelFamily:'solar4',baseURL:'https://nous.int.exe.xyz/v1'},
  {id:'liquid-openrouter',provider:'openrouter',model:'liquid/lfm-3-1.7b:free',modelFamily:'lfm3',baseURL:'https://openrouter.int.exe.xyz/api/v1'},
];

export function buildHeldoutLiveConfig(nowMs=Date.now()){
  return {
    task:TASK,analysisVersion:ANALYSIS_VERSION,
    policy:{
      routes:ROUTES.map(({baseURL,...r})=>({...r,admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:nowMs+300000})),
      taskClass:'analysis',maxAttempts:6,maxInvocations:6,rotation:0,cooldowns:[],
    },
  };
}

function safeEvidence(e){
  return {
    configuredProvider:e.configuredProvider,configuredModel:e.configuredModel,
    observedProvider:e.observedProvider??null,observedModel:e.observedModel??null,
    status:e.status??null,providerState:e.providerState,usageState:e.usageState,
    usage:e.usage??null,outcome:e.outcome,usableArtifact:e.usableArtifact,
    failureCode:e.failureCode??null,retryAfterMs:e.retryAfterMs??null,latencyMs:e.latencyMs,
  };
}

async function assertFreeCatalogs(record){
  for(const route of ROUTES){
    const response=await fetch(route.baseURL+'/models',{signal:AbortSignal.timeout(10000)});
    assert.ok(response.ok,'catalog '+route.id+' HTTP '+response.status);
    const item=(await response.json()).data.find(m=>m.id===route.model);
    assert.ok(item?.pricing&&Object.keys(item.pricing).length>0,'missing pricing '+route.id);
    assert.ok(Object.values(item.pricing).every(v=>v===0||v==='0'),'nonzero pricing '+route.id);
    record('catalog',{route:route.id,model:route.model,pricing:item.pricing});
  }
}

export async function runHeldoutLive({connectionString,logFile='/tmp/dw124-birch-live.jsonl'}){
  assert.ok(connectionString,'LEDGER_DATABASE_URL required');
  const fixtureBytes=readFileSync(new URL('heldout-source.json',import.meta.url));
  assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),FIXTURE_SHA,'FIXTURE_DIGEST');
  const fixture=JSON.parse(fixtureBytes);
  assert.equal(fixture.producer_commit,'3b7b5360050cc2ecdcb60f485a657f2b763751e4');
  assert.equal(fixture.candidate.scope,'synthetic:chatgpt');
  assert.equal(fixture.serving,'verified_bundle_rows_simulated_pages');
  assert.equal(fixture.entries.length,1);

  writeFileSync(logFile,'',{flag:'wx',mode:0o600});
  const record=(kind,payload)=>{
    const row={kind,at:new Date().toISOString(),...payload};
    appendFileSync(logFile,JSON.stringify(row)+'\n');
    console.log(JSON.stringify(row));
  };

  await assertFreeCatalogs(record);
  const configured=buildHeldoutLiveConfig(Date.now());
  const allowed=new Map(ROUTES.map(r=>[r.model,r]));
  let physicalCalls=0;
  const actualFetch=globalThis.fetch;
  globalThis.fetch=async(url,opts={})=>{
    const target=String(url);
    if(!target.endsWith('/chat/completions'))return actualFetch(url,opts);
    const body=JSON.parse(String(opts.body));
    const route=allowed.get(body.model);
    assert.ok(route&&target===route.baseURL+'/chat/completions','LIVE_ROUTE_REJECTED');
    assert.equal(body.max_tokens,4096);
    physicalCalls++;
    assert.ok(physicalCalls<=configured.policy.maxInvocations,'LIVE_CALL_BUDGET');
    const patched=route.provider==='nous'
      ?{...opts,body:JSON.stringify({...body,tags:['user=theseus-review']})}:opts;
    record('attempt',{n:physicalCalls,route:route.id,model:route.model});
    const response=await actualFetch(url,patched);
    const raw=await response.clone().json().catch(()=>({}));
    const cost=raw.usage?.cost??raw.cost??null;
    record('transport',{route:route.id,status:response.status,model:raw.model??null,
      provider:raw.provider??null,finish:raw.choices?.[0]?.finish_reason??null,
      usage:raw.usage?{prompt_tokens:raw.usage.prompt_tokens??null,completion_tokens:raw.usage.completion_tokens??null,total_tokens:raw.usage.total_tokens??null}:null,
      cost});
    if(cost!==null&&Number(cost)!==0)throw Error('NONZERO_COST');
    return response;
  };

  try{
    const routes=ROUTES.map(route=>({
      id:route.id,provider:route.provider,model:route.model,modelFamily:route.modelFamily,
      admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',
      catalogValidUntilMs:Date.now()+300000,
      infer:createOpenAIChatInference({
        baseURL:route.baseURL,configuredProvider:route.provider,configuredModel:route.model,
        configuredModelFamily:route.modelFamily,maxOutputTokens:4096,timeoutMs:60000,
        responseFormat:'json_object',onEvidence:e=>record('adapter',{route:route.id,...safeEvidence(e)}),
      }),
    }));
    const store=createPostgresSourceBatchStore({connectionString});
    const root=await store.initialize({candidate:fixture.candidate,expected:fixture.expected,task:TASK,analysisVersion:ANALYSIS_VERSION});
    assert.ok(root.status==='ACKNOWLEDGED'||root.status==='ALREADY_ACKNOWLEDGED');
    assert.ok(root.receipt);
    const entry=fixture.entries[0];
    const input={
      candidate:fixture.candidate,expected:fixture.expected,
      indexes:[{sessionId:entry.sessionId,index:entry.index}],
      previousCheckpoint:root.receipt.receiptFingerprint,
      task:TASK,analysisVersion:ANALYSIS_VERSION,maxSessions:1,
      bounds:{maxPages:4,maxChars:1000,maxMessages:10},
    };
    let fixtureReads=0;
    const transport=async request=>{
      fixtureReads++;
      assert.equal(fixtureReads,1);
      assert.equal(request.session_id,entry.sessionId);
      assert.equal(request.shard_id,entry.index.shard_id);
      assert.equal(request.generation_id,entry.index.generation_id);
      assert.equal(request.cursor,undefined);
      return Response.json(entry.pages[0]);
    };
    const policy={...configured.policy,routes,clock:Date.now};
    const result=await runPooledSourceCycle(input,{
      limits:{maxRequests:4,maxPageBytes:12000,maxTotalBytes:24000,timeoutMs:1000,pageMessages:10,pageChars:1000},
      transport,store,policy,
    });
    const tip=await store.readTip(input);
    record('result',{status:result.status,attemptedPasses:result.attemptedPasses,
      planFingerprint:result.run?.planFingerprint??null,physicalCalls,fixtureReads,
      work:result.run?.work?.map(w=>({workFingerprint:w.workFingerprint,decision:w.decision,attemptedPasses:w.attemptedPasses,wakeAtMs:w.wakeAtMs}))??[],
      receiptFingerprint:result.run?.receipt?.receiptFingerprint??null,
      tipFingerprint:tip?.receiptFingerprint??null});
    if(result.status!=='ACKNOWLEDGED'&&result.status!=='ALREADY_ACKNOWLEDGED'){
      process.exitCode=2;
    }
    return {result,tip,physicalCalls,fixtureReads,logFile};
  }finally{
    globalThis.fetch=actualFetch;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await runHeldoutLive({connectionString:process.env.LEDGER_DATABASE_URL});
}
