// One response per novel synthetic case, no retry or fallback, exact free admission.
// Candidate atoms are supplied; not unconstrained NL theorem/claim extraction.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { executeOpenAIChatTransport } from '../../src/dreaming/openai-provider-adapter.ts';
import { parseStrictModelJson } from '../../src/dreaming/strict-model-json.ts';
const bytes=readFileSync(new URL('./new-cases.json',import.meta.url));
const goldBytes=readFileSync(new URL('./new-cases-gold.json',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const {cases}=JSON.parse(bytes);
const gold=JSON.parse(goldBytes);
const schema=z.object({policyRef:z.literal('E1'),
  supportSets:z.array(z.array(z.enum(['A','B','C','D','E'])).min(1).max(5)).min(1).max(8),
  premises:z.array(z.object({id:z.enum(['A','B','C','D','E']),state:z.enum(['T','F','U']),refs:z.array(z.enum(['E2','E3','E4','E5','E6'])).min(1).max(5)}).strict()).min(1).max(5)
}).strict();
const system='Extract a minimal positive AND/OR dependency rule for the stated decision using only the supplied candidate atom IDs and owner policy E1. Output a single JSON object {policyRef:"E1",supportSets:[["A","B"],["C"]],premises:[{id:"A",state:"T",refs:["E2"]},...]}. The example is format only, not the answer. Each inner support set requires ALL its atoms; ANY support set suffices. List only subset-minimal sufficient sets. Each atom used must have one premise record. T=established, F=explicitly refuted, U=not established or refuted; distinguish unavailable observation from explicit refutation and source authority from self-report. Cite exact source IDs supporting each state, not the policy. Do not include irrelevant atoms, additional fields, or a prose verdict.';
const canonicalSets=sets=>sets.map(s=>[...s].sort().join(',')).sort();
function evaluate(result,c){
  const p=schema.parse(result);
  const ids=new Set(p.premises.map(x=>x.id));
  assert.equal(ids.size,p.premises.length);
  assert.ok(p.supportSets.every(s=>new Set(s).size===s.length&&s.every(x=>ids.has(x))));
  const ss=canonicalSets(p.supportSets);
  assert.equal(new Set(ss).size,ss.length);
  assert.ok(p.premises.every(x=>p.supportSets.some(s=>s.includes(x.id))&&new Set(x.refs).size===x.refs.length));
  assert.ok(!p.supportSets.some((a,i)=>p.supportSets.some((b,j)=>i!==j&&b.length<a.length&&b.every(x=>a.includes(x)))));
  const g=gold[c.id], states=new Map(p.premises.map(x=>[x.id,x.state]));
  const outcomes=p.supportSets.map(s=>s.some(x=>states.get(x)==='F')?'F':s.every(x=>states.get(x)==='T')?'T':'U');
  const decision=outcomes.includes('T')?'ALLOW':outcomes.every(x=>x==='F')?'DENIED':'DEFER';
  const prem=a=>a.map(x=>({id:x.id,state:x.state,refs:[...x.refs].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
  return {ruleExact:JSON.stringify(ss)===JSON.stringify(canonicalSets(g.supportSets)),
    premiseExact:JSON.stringify(prem(p.premises))===JSON.stringify(prem(g.premises)),
    decision,decisionExact:decision===g.decision};
}
if(process.argv[2]==='--check'){
  for(const c of cases)assert.deepEqual(evaluate({policyRef:'E1',supportSets:gold[c.id].supportSets,premises:gold[c.id].premises},c),
    {ruleExact:true,premiseExact:true,decision:gold[c.id].decision,decisionExact:true});
  console.log('EXTRACTION_FIXTURE_PASS',sha(bytes),sha(goldBytes));
  process.exit(0);
}
if(process.argv[2]==='--verify'){
  const rows=readFileSync(process.argv[3],'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].fixtureSha,sha(bytes));assert.equal(rows[0].goldSha,sha(goldBytes));
  for(const r of rows.filter(r=>r.kind==='case'&&r.status==='VALIDATED')){
    const c=cases.find(c=>c.id===r.id);
    assert.deepEqual(evaluate(parseStrictModelJson(r.rawFinal),c),r.evaluation);
  }
  assert.equal(rows.filter(r=>r.kind==='attempt').length,rows.at(-1).attempts);
  console.log('EXTRACTION_READBACK_PASS');process.exit(0);
}
const [output,route]=process.argv.slice(2);
assert.ok(output&&['bothub-ultra','nim-lightning'].includes(route));
const bothub=route==='bothub-ultra';
const baseURL=bothub?'https://bothub-api.int.exe.xyz/v1':'https://nvidi-nim.int.exe.xyz/v1';
const model=bothub?'nemotron-3-ultra-550b-a55b:free':'nvidia/nemotron-3.5-lightning-30b-a3b';
const cap=3072, timeoutMs=60000;
const catalog=await fetch(baseURL+'/models',{signal:AbortSignal.timeout(10000)});
assert.ok(catalog.ok);
const item=(await catalog.json()).data.find(x=>x.id===model);
assert.equal(item?.id,model);
let priceEvidence=null;
if(bothub){
  const url='https://bothub.chat/api/v2/pricing/models?platform=API_COMPLETIONS&modelId='+encodeURIComponent(model);
  const price=await fetch(url,{signal:AbortSignal.timeout(10000)});
  assert.ok(price.ok);
  const body=await price.json();
  assert.equal(body.platform,'API_COMPLETIONS');
  assert.equal(body.models.length,1);
  const row=body.models[0];
  assert.equal(row.id,model);
  assert.ok(model.endsWith(':free')&&Array.isArray(row.prices)&&row.prices.length===0&&!row.schedule);
  priceEvidence={id:row.id,prices:row.prices,schedule:row.schedule,allowedPlanType:row.allowedPlanType,providerType:body.providerType};
}else if(item.pricing){
  assert.ok(Object.keys(item.pricing).length&&Object.values(item.pricing).every(v=>v===0||v==='0'));
}
writeFileSync(output,'',{flag:'wx',mode:0o600});
const record=(kind,x)=>{const line=JSON.stringify({kind,...x});appendFileSync(output,line+'\n');console.log(line);};
record('catalog',{route,model,pricing:item.pricing??null,priceEvidence,entitlement:bothub?'EXPLICIT_FREE_VARIANT_HISTORICAL_AND_PUBLIC_PRICE_EVIDENCE':'NVIDIA_DEVELOPER_RESEARCH',fixtureSha:sha(bytes),goldSha:sha(goldBytes)});
let attempts=0,transport=null,active=null;
const original=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{
  assert.equal(String(url),baseURL+'/chat/completions');
  const body=JSON.parse(opts.body);
  assert.equal(body.model,model);assert.equal(body.max_tokens,cap);
  assert.ok(attempts<2);
  const wire=JSON.stringify(bothub?body:{...body,reasoning_budget:768});
  attempts++;
  record('attempt',{id:active,wireSha:sha(wire),maxOutputTokens:cap,timeoutMs,reasoningBudget:bothub?null:768});
  const res=await original(url,{...opts,body:wire});
  const raw=await res.clone().json().catch(()=>({}));
  transport={status:res.status,model:raw.model??null,provider:raw.provider??null,cost:raw.usage?.cost??raw.cost??null,finish:raw.choices?.[0]?.finish_reason??null};
  return res;
};
let stopped=false;
for(const c of cases){
  if(stopped){record('case',{id:c.id,status:'NOT_ATTEMPTED'});continue;}
  active=c.id;transport=null;let result;const start=Date.now();
  try{
    result=await executeOpenAIChatTransport({baseURL,configuredProvider:bothub?'bothub':'nvidia',configuredModel:model,timeoutMs,maxOutputTokens:cap,responseFormat:'json_object',
      messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(c)}]});
    assert.equal(transport?.model,model);
    assert.ok(transport.cost===null||transport.cost===0||transport.cost==='0','unexpected nonzero cost');
    assert.equal(result.finishReason,'stop');
    if(!bothub&&result.usage?.reasoningTokens!=null)assert.ok(result.usage.reasoningTokens<=832,'reasoning budget exceeded');
    const evaluation=evaluate(parseStrictModelJson(result.text),c);
    record('case',{id:c.id,status:'VALIDATED',evaluation,rawFinal:result.text,usage:result.usage,transport,latencyMs:Date.now()-start});
    if(bothub&&transport.cost===null)stopped=true;
  }catch(e){
    record('case',{id:c.id,status:'FAILED',error:String(e.message).slice(0,500),code:e.code??null,providerState:e.providerState??null,
      transport,rawFinal:result?.text??null,usage:result?.usage??e.usage??null,latencyMs:Date.now()-start});
    if(transport?.status!==200||transport?.model!==model||e.providerState==='UNKNOWN'||!(transport?.cost===0||transport?.cost==='0'||(!bothub&&transport?.cost===null)))stopped=true;
  }
}
record('end',{attempts,stopped});
