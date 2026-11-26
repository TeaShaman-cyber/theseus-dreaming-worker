// Offline fixture check, or explicitly selected, bounded free-route experiment.
// No production configuration, no retry/fallback or private input.
import assert from 'node:assert/strict';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runPilot1 } from '../../../src/dreaming/pilot1-runner.ts';
import { createOpenAIChatInference } from '../../../src/dreaming/openai-provider-adapter.ts';

const casesFile = new URL('./cases.json', import.meta.url);
const bytes = readFileSync(casesFile);
const digest = createHash('sha256').update(bytes).digest('hex');
const {cases} = JSON.parse(bytes);
assert.equal(digest, 'f328422d67be4f318ee1398fc8f9da183d5ac97994a78721fa9d3f6616dcc84f');
assert.equal(cases.length, 6);
assert.equal(new Set(cases.map(c=>c.id)).size, cases.length);
for (const c of cases) {
  assert.equal(c.request.scope,'SYNTHETIC_FIXTURE');
  assert.equal(c.request.packet.acceptedNewEvidence,true);
  const evidence=c.request.packet.evidence;
  assert.equal(new Set(evidence.map(e=>e.sourceRef)).size,evidence.length);
  for (const e of evidence) {
    assert.ok(e.sourceRef.startsWith('synthetic:'+c.id+':'));
    assert.equal(e.evidenceHash,'sha256:'+createHash('sha256').update(e.text).digest('hex'));
  }
  for (const required of c.rubric.required) {
    assert.ok(required.refs.every(ref=>evidence.some(e=>e.sourceRef==='synthetic:'+c.id+':'+ref)));
  }
}
// Use actual contract with a stub for the negative no-data control.
const noData=await runPilot1({...cases[0].request,packet:{...cases[0].request.packet,acceptedNewEvidence:false}},async()=>{throw Error('unexpected inference')});
assert.equal(noData.outcome,'NO_DATA');
assert.equal(noData.receipt.externalModelCalls,0);
if (process.argv[2]==='--check') {
  console.log('QUALITY_FIXTURES_PASS',digest);
  process.exit(0);
}
const [routeId,output]=process.argv.slice(2);
const routes={
  solar:{provider:'nous',model:'upstage/solar-mini4:free',family:'solar',baseURL:'https://nous.int.exe.xyz/v1'},
  tencent:{provider:'nous',model:'tencent/hy4-flash:free',family:'hy4',baseURL:'https://nous.int.exe.xyz/v1'},
  ernie:{provider:'openrouter',model:'baidu/ernie-5.5-flash-preview:free',family:'ernie',baseURL:'https://openrouter.int.exe.xyz/api/v1'},
};
assert.ok(Object.hasOwn(routes,routeId)&&output,'explicit free route and output required');
const route=routes[routeId];
const record=(kind,value)=>{const row=JSON.stringify({kind,route:routeId,...value});appendFileSync(output,row+'\n',{mode:0o600});console.log(row);};
const catalogResponse=await fetch(route.baseURL+'/models',{signal:AbortSignal.timeout(10000)});
assert.ok(catalogResponse.ok);
const catalog=await catalogResponse.json();
const m=catalog.data.find(x=>x.id===route.model);
assert.ok(m?.id.endsWith(':free')&&m.pricing&&Object.keys(m.pricing).length&&Object.values(m.pricing).every(v=>v===0||v==='0'));
writeFileSync(output,'',{flag:'wx',mode:0o600});
record('catalog',{provider:route.provider,model:route.model,pricing:m.pricing,fixtureSha256:digest});
let attempts=0, transport=null, providerEvidence=null;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{
  assert.equal(String(url),route.baseURL+'/chat/completions');
  const body=JSON.parse(opts.body);
  assert.equal(body.model,route.model);
  assert.equal(body.max_tokens,1024);
  assert.ok(attempts<cases.length);
  attempts++;
  const res=await originalFetch(url,route.provider==='nous'?{...opts,body:JSON.stringify({...body,tags:['user=theseus-review']})}:opts);
  const raw=await res.clone().json().catch(()=>({}));
  transport={status:res.status,provider:raw.provider??null,model:raw.model??null,cost:raw.usage?.cost??raw.cost??null,finish:raw.choices?.[0]?.finish_reason??null,retryAfter:res.headers.get('retry-after')};
  if (!res.ok) transport.error=String(raw.error?.message??raw.message??'').slice(0,300);
  return res;
};
const infer=createOpenAIChatInference({baseURL:route.baseURL,configuredProvider:route.provider,configuredModel:route.model,configuredModelFamily:route.family,maxOutputTokens:1024,timeoutMs:30000,responseFormat:'json_object',onEvidence:e=>{const {requestId,...safe}=e;providerEvidence=safe;}});
let stopped=false;
for (const c of cases) {
  if (stopped) {record('case',{id:c.id,status:'NOT_ATTEMPTED'});continue;}
  transport=null;providerEvidence=null;
  const before=attempts;
  try {
    const result=await runPilot1(structuredClone(c.request),infer);
    assert.equal(result.outcome,'PROPOSED');
    const {runId,traceId,...receipt}=result.receipt;
    record('case',{id:c.id,status:'VALIDATED',proposals:result.proposalSet.proposals,receipt,transport,providerEvidence});
  } catch(e) {
    record('case',{id:c.id,status:'FAILED',error:String(e.message).slice(0,500),transport,providerEvidence});
    if (!transport||transport.status!==200||providerEvidence?.providerState==='UNKNOWN') stopped=true;
  }
  assert.equal(attempts,before+1);
  if (transport?.cost!=null && Number(transport.cost)!==0) {
    record('stop',{reason:'NONZERO_OR_UNRECOGNIZED_COST'});stopped=true;
  }
}
record('end',{attempts,stopped});
