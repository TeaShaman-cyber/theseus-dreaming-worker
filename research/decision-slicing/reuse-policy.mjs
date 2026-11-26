// Research-only second stage. The exact observed policy graph is fixed; never
// regenerate it from evidence. Gold is used only by offline scoring.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { policyIdentity, bindRule } from './policy-identity.mjs';
import { executeOpenAIChatTransport } from '../../src/dreaming/openai-provider-adapter.ts';
import { parseStrictModelJson } from '../../src/dreaming/strict-model-json.ts';

const read=name=>readFileSync(new URL('./'+name,import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const bytes=read('paired-cases.json'), goldBytes=read('paired-gold.json'), prior=read('paired-observation.jsonl');
assert.equal(sha(prior),'da6a17165ee9e8413d92b40ecdbbf1f60b1aa848389f535624e1ca47c9d9c4de');
const {cases:originalCases}=JSON.parse(bytes);
const snapshots=read('reuse-cases.json'), reuseGold=read('reuse-gold.json');
const changes=JSON.parse(snapshots), gold=JSON.parse(reuseGold);
const cases=originalCases.map(c=>({...c,sources:{E1:c.sources.E1,...changes[c.id]}}));
const observations=prior.toString().trim().split('\n').map(parseStrictModelJson);
assert.equal(observations[0].fixtureSha,sha(bytes));assert.equal(observations[0].goldSha,sha(goldBytes));
const jobs=cases.map(c=>{
  const row=observations.find(r=>r.kind==='case'&&r.id===c.id&&r.mode==='rule');
  assert.equal(row.status,'VALIDATED');
  const original=originalCases.find(x=>x.id===c.id);
  const receipt={policySha:policyIdentity(original),ruleSha:sha(row.rawFinal)};
  const rule=bindRule(receipt,c,row.rawFinal);
  const ids=[...new Set(rule.supportSets.flat())].sort();
  return {c,rule,ids,...receipt,rawRule:row.rawFinal,ruleUsage:row.usage,ruleLatencyMs:row.latencyMs};
});
const schema=z.object({premises:z.array(z.object({id:z.enum(['A','B','C','D','E']),state:z.enum(['T','F','U']),refs:z.array(z.enum(['E2','E3','E4','E5','E6'])).min(1).max(5)}).strict()).min(1).max(5)}).strict();
const system='For each supplied atomic assertion, classify its current evidential state: T=established, F=explicitly refuted, U=neither established nor refuted. Distinguish unavailable observations from negative evidence, and independent verification from self-report. Cite exact source IDs supporting each state. Output one JSON object {"premises":[{"id":"A","state":"T","refs":["E2"]}]}. The example is format only. Include each supplied atom exactly once, no other atoms or fields. Do not infer a decision or change the atoms.';
function messages(j){
  const {c,ids}=j;
  return [{role:'system',content:system},{role:'user',content:JSON.stringify({id:c.id,atoms:Object.fromEntries(ids.map(id=>[id,c.atoms[id]])),sources:Object.fromEntries(Object.entries(c.sources).filter(([id])=>id!=='E1'))})}];
}
const canon=p=>p.map(x=>({...x,refs:[...x.refs].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
function evaluate(raw,j){
  const {premises}=schema.parse(parseStrictModelJson(raw));
  assert.deepEqual(premises.map(p=>p.id).sort(),j.ids,'PREMISE_SET_MISMATCH');
  assert.ok(premises.every(x=>new Set(x.refs).size===x.refs.length),'DUPLICATE_REF');
  const states=Object.fromEntries(premises.map(x=>[x.id,x.state]));
  const v=j.rule.supportSets.map(s=>s.some(x=>states[x]==='F')?'F':s.every(x=>states[x]==='T')?'T':'U');
  const decision=v.includes('T')?'ALLOW':v.every(x=>x==='F')?'DENIED':'DEFER';
  const g=gold[j.c.id];
  return {premiseExact:JSON.stringify(canon(premises))===JSON.stringify(canon(g.premises)),decision,decisionExact:decision===g.decision};
}
function evalFinal(raw,j){
  try{return {status:'VALIDATED',evaluation:evaluate(raw,j)};}
  catch(e){return {status:'REJECTED',error:String(e.message).slice(0,500)};}
}
if(process.argv[2]==='--check'){
  for(const j of jobs){
    const m=JSON.parse(messages(j)[1].content);
    assert.ok(!('E1' in m.sources)&&!('decision' in m)&&!('supportSets' in m));
    assert.deepEqual(evaluate(JSON.stringify({premises:gold[j.c.id].premises}),j),{premiseExact:true,decision:gold[j.c.id].decision,decisionExact:true});
  }
  for(const j of jobs){
    const c=structuredClone(j.c);
    for(const mutate of [
      x=>{x.sources.E1+=' Changed mandatory condition.'},
      x=>{x.decision+=' Changed target.'},
      x=>{x.atoms.A+=' Changed authority.'},
      x=>{x.id+='-other'}
    ]){
      const altered=structuredClone(c);mutate(altered);
      assert.throws(()=>bindRule(j,altered,j.rawRule),/POLICY_CHANGED/);
    }
    assert.throws(()=>bindRule(j,c,j.rawRule+' '),/RULE_CHANGED/);
    c.sources.E2+=' New observation.';
    assert.deepEqual(bindRule(j,c,j.rawRule),j.rule);
    c.atoms=Object.fromEntries(Object.entries(c.atoms).reverse());
    assert.deepEqual(bindRule(j,c,j.rawRule),j.rule);
  }
  console.log('REUSE_IDENTITY_PASS 10 negative, 4 positive controls');process.exit(0);
}
if(process.argv[2]==='--verify'){
  const rows=readFileSync(process.argv[3],'utf8').trim().split('\n').map(parseStrictModelJson);
  assert.equal(rows[0].kind,'catalog');assert.equal(rows[0].priorSha,sha(prior));assert.equal(rows[0].fixtureSha,sha(bytes));assert.equal(rows[0].goldSha,sha(goldBytes));assert.equal(rows[0].snapshotSha,sha(snapshots));assert.equal(rows[0].reuseGoldSha,sha(reuseGold));
  let cursor=1,attempts=0,stopped=false;
  for(const j of jobs){
    const a=rows[cursor++];
    if(stopped){assert.deepEqual(a,{kind:'case',id:j.c.id,status:'NOT_ATTEMPTED'});continue;}
    assert.equal(a.kind,'attempt');assert.equal(a.id,j.c.id);assert.equal(a.ruleSha,j.ruleSha);assert.equal(a.policySha,j.policySha);assert.equal(a.promptSha,sha(JSON.stringify(messages(j))));assert.match(a.wireSha,/^[0-9a-f]{64}$/);attempts++;
    const r=rows[cursor++];assert.equal(r.kind,'case');assert.equal(r.id,j.c.id);
    if(r.status==='TRANSPORT_FAILED'){stopped=true;assert.equal(r.rawFinal,null);}
    else {
      assert.equal(r.transport.status,200);assert.equal(r.transport.model,rows[0].model);assert.equal(r.transport.finish,'stop');
      const actual=evalFinal(r.rawFinal,j);assert.equal(r.status,actual.status);
      if(r.status==='VALIDATED')assert.deepEqual(r.evaluation,actual.evaluation);else assert.equal(r.error,actual.error);
    }
  }
  assert.equal(cursor,rows.length-1);assert.deepEqual(rows.at(-1),{kind:'end',attempts,stopped});
  console.log('REUSE_READBACK_PASS',attempts);process.exit(0);
}
const output=process.argv[2];assert.ok(output);
const baseURL='https://nvidi-nim.int.exe.xyz/v1',model='nvidia/nemotron-3-ultra-550b-a55b',cap=3072,timeoutMs=60000;
const catalog=await fetch(baseURL+'/models',{signal:AbortSignal.timeout(10000)});assert.ok(catalog.ok);
const item=(await catalog.json()).data.find(x=>x.id===model);assert.equal(item?.id,model);
if(item.pricing)assert.ok(Object.keys(item.pricing).length&&Object.values(item.pricing).every(v=>v===0||v==='0'));
writeFileSync(output,'',{flag:'wx',mode:0o600});
const record=(kind,x)=>{const line=JSON.stringify({kind,...x});appendFileSync(output,line+'\n');console.log(line);};
record('catalog',{model,pricing:item.pricing??null,entitlement:'NVIDIA_DEVELOPER_RESEARCH',priorSha:sha(prior),fixtureSha:sha(bytes),goldSha:sha(goldBytes),snapshotSha:sha(snapshots),reuseGoldSha:sha(reuseGold)});
let attempts=0,active,transport=null,stopped=false;
const original=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{
  assert.equal(String(url),baseURL+'/chat/completions');
  const body=JSON.parse(opts.body);assert.equal(body.model,model);assert.equal(body.max_tokens,cap);assert.ok(attempts<jobs.length);
  const wire=JSON.stringify({...body,reasoning_effort:'medium'});attempts++;
  record('attempt',{id:active.c.id,ruleSha:active.ruleSha,policySha:active.policySha,promptSha:sha(JSON.stringify(messages(active))),wireSha:sha(wire),maxOutputTokens:cap,timeoutMs,reasoningEffort:'medium'});
  const res=await original(url,{...opts,body:wire});
  const raw=await res.clone().json().catch(()=>({}));
  transport={status:res.status,model:raw.model??null,cost:raw.usage?.cost??raw.cost??null,finish:raw.choices?.[0]?.finish_reason??null,retryAfter:res.headers.get('retry-after'),requestId:res.headers.get('x-request-id')};return res;
};
for(const j of jobs){
  if(stopped){record('case',{id:j.c.id,status:'NOT_ATTEMPTED'});continue;}
  active=j;transport=null;const start=Date.now();
  try{
    const r=await executeOpenAIChatTransport({baseURL,configuredProvider:'nvidia',configuredModel:model,timeoutMs,maxOutputTokens:cap,responseFormat:'json_object',messages:messages(j)});
    assert.equal(transport?.model,model);assert.ok(transport.cost===null||transport.cost===0||transport.cost==='0');assert.equal(r.finishReason,'stop');
    record('case',{id:j.c.id,...evalFinal(r.text,j),rawFinal:r.text,usage:r.usage,transport,latencyMs:Date.now()-start});
  }catch(e){
    record('case',{id:j.c.id,status:'TRANSPORT_FAILED',error:String(e.message).slice(0,500),code:e.code??null,providerState:e.providerState??null,rawFinal:null,usage:e.usage??null,transport,latencyMs:Date.now()-start});stopped=true;
  }
}
record('end',{attempts,stopped});
