// Read-only durable critique over the completed held-out Birch perspectives.
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {prepareSourceBatchExecution} from '../../../src/dreaming/source-batch-receipt.ts';
import {createPostgresSourceBatchStore} from '../../../src/dreaming/source-batch-postgres.ts';
import {createPostgresPoolJournalStore} from '../../../src/dreaming/proposal-ledger-postgres.ts';
import {fingerprintProposal,sha256Fingerprint} from '../../../src/dreaming/proposal-schema.ts';
import {runLiveCritique} from '../../../src/dreaming/pilot2-critique-live.ts';

const TASK='Held-out synthetic Birch hypothesis.';
const ANALYSIS_VERSION='live-birch-124-v2';

export const heldoutCritiqueRoute=()=>({
  id:'particle-critique',provider:'openrouter',model:'particle-ai/particle-1:free',
  modelFamily:'particle1',baseURL:'https://openrouter.int.exe.xyz/api/v1',
  maxOutputTokens:4096,timeoutMs:60000,
});

export async function runHeldoutCritique({connectionString,logFile='/tmp/dw124-birch-critique-v3.jsonl'}){
  assert.ok(connectionString,'LEDGER_DATABASE_URL required');
  const fixture=JSON.parse(readFileSync(new URL('heldout-source.json',import.meta.url)));
  const source=createPostgresSourceBatchStore({connectionString});
  const intent={candidate:fixture.candidate,expected:fixture.expected,task:TASK,analysisVersion:ANALYSIS_VERSION};
  const tip=await source.readTip(intent);
  assert.equal(tip?.schema,'theseus.dreaming-worker.source-batch-receipt.v2');
  assert.ok(tip.previousCheckpoint);
  const batch={...intent,entries:fixture.entries,maxSessions:1,previousCheckpoint:tip.previousCheckpoint,
    bounds:{maxPages:4,maxChars:1000,maxMessages:10}};
  const {plan,prepared}=prepareSourceBatchExecution(batch);
  assert.equal(plan.planFingerprint,tip.currentPlanFingerprint);
  assert.equal(prepared.length,1);
  const journal=await createPostgresPoolJournalStore({connectionString}).read(prepared[0].input);
  assert.equal(journal.status,'JOURNAL');
  assert.equal(journal.completionExists,true);
  assert.equal(journal.state.validated.length,2);

  const validated=journal.state.validated;
  const input={
    schema:'theseus.dreaming-worker.critique-input.v1',pilot2Outcome:'COMPLETE',
    packetId:validated[0].result.receipt.packetId,
    evidenceFingerprint:validated[0].result.receipt.evidenceFingerprint,
    requestFingerprint:validated[0].result.receipt.requestFingerprint,
    perspectives:validated.map(v=>({
      perspectiveId:v.start.route.id,route:v.start.route,
      proposals:v.result.proposalSet.proposals.map(proposal=>({proposalFingerprint:fingerprintProposal(proposal),proposal})),
    })),
    failedPerspectives:[],
  };
  const route=heldoutCritiqueRoute();
  const catalog=await fetch(route.baseURL+'/models',{signal:AbortSignal.timeout(10000)});
  assert.ok(catalog.ok);
  const model=(await catalog.json()).data.find(m=>m.id===route.model);
  assert.ok(model?.pricing&&Object.keys(model.pricing).length>0&&Object.values(model.pricing).every(v=>v===0||v==='0'));

  writeFileSync(logFile,'',{flag:'wx',mode:0o600});
  const record=(kind,payload)=>{
    const row={kind,at:new Date().toISOString(),...payload};
    appendFileSync(logFile,JSON.stringify(row)+'\n');
    console.log(JSON.stringify(row));
  };
  record('input',{route:{id:route.id,provider:route.provider,model:route.model,modelFamily:route.modelFamily},
    perspectiveIds:input.perspectives.map(p=>p.perspectiveId),proposalCounts:input.perspectives.map(p=>p.proposals.length),
    pricing:model.pricing,inputHash:sha256Fingerprint(JSON.stringify(input))});

  const actual=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(url,opts={})=>{
    assert.equal(String(url),route.baseURL+'/chat/completions');
    assert.equal(calls++,0);
    const body=JSON.parse(String(opts.body));
    assert.equal(body.model,route.model);
    assert.equal(body.max_tokens,route.maxOutputTokens);
    record('attempt',{n:1,model:route.model});
    const response=await actual(url,opts);
    const raw=await response.clone().json().catch(()=>({}));
    const cost=raw.usage?.cost??raw.cost??null;
    record('transport',{status:response.status,model:raw.model??null,provider:raw.provider??null,
      finish:raw.choices?.[0]?.finish_reason??null,
      usage:raw.usage?{prompt_tokens:raw.usage.prompt_tokens??null,completion_tokens:raw.usage.completion_tokens??null,total_tokens:raw.usage.total_tokens??null}:null,cost});
    if(cost!==null&&Number(cost)!==0)throw Error('NONZERO_COST');
    return response;
  };
  try{
    const result=await runLiveCritique(input,route);
    record('critique',{outcome:result.outcome,artifact:result.artifact,failure:result.failure??null,
      receipt:result.receipt,calls});
    assert.equal(calls,1);
    return result;
  }finally{globalThis.fetch=actual;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await runHeldoutCritique({connectionString:process.env.LEDGER_DATABASE_URL});
}
