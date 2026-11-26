// One explicit synthetic request; no retry, fallback or production receipt.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {executeOpenAIChatTransport} from '../../../src/dreaming/openai-provider-adapter.ts';
import {makeContext} from './packet-handles.mjs';
const [output]=process.argv.slice(2);
assert.ok(output,'fresh output required');
const fixture=readFileSync(new URL('./cases.json',import.meta.url));
assert.equal(createHash('sha256').update(fixture).digest('hex'),'f328422d67be4f318ee1398fc8f9da183d5ac97994a78721fa9d3f6616dcc84f');
const c=JSON.parse(fixture).cases.find(c=>c.id==='authority');
const ctx=makeContext(c.request);
const baseURL='https://nvidi-nim.int.exe.xyz/v1';
const model='nvidia/nemotron-3.5-lightning-30b-a3b';
const catalog=await fetch(baseURL+'/models',{signal:AbortSignal.timeout(10000)});
assert.ok(catalog.ok);
const item=(await catalog.json()).data.find(m=>m.id===model);
assert.ok(item);
if(item.pricing)assert.ok(Object.keys(item.pricing).length&&Object.values(item.pricing).every(v=>v===0||v==='0'));
writeFileSync(output,'',{flag:'wx',mode:0o600});
function record(kind,x){const line=JSON.stringify({kind,...x});appendFileSync(output,line+'\n');console.log(line);}
record('catalog',{model,pricing:item.pricing??null,entitlement:'NVIDIA_DEVELOPER_RESEARCH',requestFingerprint:ctx.fingerprint,evidenceFingerprint:ctx.evidenceFingerprint,wireFingerprint:ctx.wireFingerprint});
let attempts=0,transport=null;
const fetchActual=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),baseURL+'/chat/completions');
  assert.equal(attempts,0);
  const body=JSON.parse(options.body);
  assert.equal(body.model,model);
  assert.equal(body.max_tokens,3072);
  assert.deepEqual(body.messages,ctx.messages);
  const wire={...body,reasoning_budget:768,response_format:{type:'json_schema',json_schema:{name:'dreaming_handles',strict:true,schema:ctx.schema}}};
  attempts++;
  record('attempt',{attempts,wireBodySha256:createHash('sha256').update(JSON.stringify(wire)).digest('hex'),cap:3072,reasoningBudget:768,timeoutMs:60000,bodyBytes:Buffer.byteLength(JSON.stringify(wire))});
  const res=await fetchActual(url,{...options,body:JSON.stringify(wire)});
  const raw=await res.clone().json().catch(()=>({}));
  transport={status:res.status,model:raw.model??null,provider:raw.provider??null,cost:raw.usage?.cost??raw.cost??null,retryAfter:res.headers.get('retry-after'),finish:raw.choices?.[0]?.finish_reason??null};
  return res;
};
const start=Date.now();
let result;
try{
  result=await executeOpenAIChatTransport({baseURL,configuredProvider:'nvidia',configuredModel:model,timeoutMs:60000,maxOutputTokens:3072,responseFormat:'json_object',messages:ctx.messages});
  assert.equal(transport?.model,model,'unexpected model');
  assert.ok(transport.cost===null||transport.cost===0||transport.cost==='0','unexpected cost');
  const proposals=ctx.resolve(result.text,result.finishReason,ctx.fingerprint);
  record('case',{id:c.id,status:'VALIDATED',latencyMs:Date.now()-start,usage:result.usage,transport,rawFinal:result.text,proposals});
}catch(e){
  record('case',{id:c.id,status:'FAILED',latencyMs:Date.now()-start,usage:result?.usage??e.usage??null,transport,rawFinal:result?.text??null,error:String(e.message).slice(0,600),failureCode:e.code??null,providerState:e.providerState??null});
}
record('end',{attempts});
assert.equal(attempts,1);
