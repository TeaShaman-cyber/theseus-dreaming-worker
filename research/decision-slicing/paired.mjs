// One response per novel synthetic case, no retry or fallback, exact free admission.
// Candidate atoms are supplied; not unconstrained NL theorem/claim extraction.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { executeOpenAIChatTransport } from '../../src/dreaming/openai-provider-adapter.ts';
import { parseStrictModelJson } from '../../src/dreaming/strict-model-json.ts';
const bytes=readFileSync(new URL('./paired-cases.json',import.meta.url));
const goldBytes=readFileSync(new URL('./paired-gold.json',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const {cases}=JSON.parse(bytes);
const gold=JSON.parse(goldBytes);
const schema=z.object({policyRef:z.literal('E1'),
  supportSets:z.array(z.array(z.enum(['A','B','C','D','E'])).min(1).max(5)).min(1).max(8),
  premises:z.array(z.object({id:z.enum(['A','B','C','D','E']),state:z.enum(['T','F','U']),refs:z.array(z.enum(['E2','E3','E4','E5','E6'])).min(1).max(5)}).strict()).min(1).max(5)
}).strict();
const jointSystem='Extract a minimal positive AND/OR dependency rule for the stated decision using only the supplied candidate atom IDs and owner policy E1. Output a single JSON object {policyRef:"E1",supportSets:[["A","B"],["C"]],premises:[{id:"A",state:"T",refs:["E2"]},...]}. The example is format only, not the answer. Each inner support set requires ALL its atoms; ANY support set suffices. List only subset-minimal sufficient sets. Each atom used must have one premise record. T=established, F=explicitly refuted, U=not established or refuted; distinguish unavailable observation from explicit refutation and source authority from self-report. Cite exact source IDs supporting each state, not the policy. Do not include irrelevant atoms, additional fields, or a prose verdict.';
const ruleSystem='Extract a minimal positive AND/OR dependency rule for the stated decision using only supplied candidate atom IDs and owner policy E1. Output a single JSON object {policyRef:"E1",supportSets:[["A","B"],["C"]]}. The example is format only, not the answer. Each inner support set requires ALL its atoms; ANY support set suffices. List all subset-minimal sufficient sets, independent of whether any premise is currently true. Do not include irrelevant atoms, additional fields, or a prose verdict.';
const ruleSchema=schema.pick({policyRef:true,supportSets:true});
const norm=s=>s.map(x=>[...x].sort().join(',')).sort();
const canonPremises=p=>p.map(x=>({id:x.id,state:x.state,refs:[...x.refs].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
function verdict(sets,states){
  const values=sets.map(s=>s.some(x=>states[x]==='F')?'F':s.every(x=>states[x]==='T')?'T':'U');
  return values.includes('T')?'ALLOW':values.every(x=>x==='F')?'DENIED':'DEFER';
}
const assignments=Array.from({length:243},(_,i)=>Object.fromEntries([... 'ABCDE'].map((x,j)=>[x,['T','F','U'][Math.floor(i/3**j)%3]])));
function evaluate(raw,c,mode){
  const p=(mode==='joint'?schema:ruleSchema).parse(parseStrictModelJson(raw));
  const ss=p.supportSets, g=gold[c.id], ids=new Set(ss.flat());
  assert.ok(ss.every(s=>new Set(s).size===s.length),'DUPLICATE_ATOM');
  assert.equal(new Set(norm(ss)).size,ss.length,'DUPLICATE_SET');
  assert.ok(!ss.some((a,i)=>ss.some((b,j)=>i!==j&&b.length<a.length&&b.every(x=>a.includes(x)))),'NONMINIMAL_SET');
  if(mode==='joint'){
    assert.equal(new Set(p.premises.map(x=>x.id)).size,p.premises.length,'DUPLICATE_PREMISE');
    assert.deepEqual([...new Set(p.premises.map(x=>x.id))].sort(),[...ids].sort(),'PREMISE_SET_MISMATCH');
    assert.ok(p.premises.every(x=>new Set(x.refs).size===x.refs.length),'DUPLICATE_REF');
  }
  const disagreements={total:0,falseAllow:0,falseDeny:0,falseDefer:0};
  for(const a of assignments){
    const expected=verdict(g.supportSets,a), actual=verdict(ss,a);
    if(expected!==actual){
      disagreements.total++;
      disagreements[actual==='ALLOW'?'falseAllow':actual==='DENIED'?'falseDeny':'falseDefer']++;
    }
  }
  // Rule-only deliberately receives reference states at evaluation, never in prompt.
  const current=Object.fromEntries((mode==='joint'?p.premises:g.premises).map(x=>[x.id,x.state]));
  const missingReferenceAtoms=mode==='rule'?[...ids].filter(x=>!(x in current)):[];
  const decision=missingReferenceAtoms.length?null:verdict(ss,current);
  return {ruleExact:JSON.stringify(norm(ss))===JSON.stringify(norm(g.supportSets)),
    premiseExact:mode==='joint'?JSON.stringify(canonPremises(p.premises))===JSON.stringify(canonPremises(g.premises)):null,
    decision,decisionExact:decision===g.decision,disagreements,missingReferenceAtoms};
}
const packet=(c,mode)=>mode==='joint'?c:{id:c.id,decision:c.decision,atoms:c.atoms,sources:{E1:c.sources.E1}};
function messages(c,mode){return [{role:'system',content:mode==='joint'?jointSystem:ruleSystem},{role:'user',content:JSON.stringify(packet(c,mode))}];}
function check(){
  for(const c of cases){
    assert.equal(assignments.length,243);
    for(const mode of ['joint','rule']){
      const g=gold[c.id], raw=JSON.stringify({policyRef:'E1',supportSets:g.supportSets,...(mode==='joint'?{premises:g.premises}:{})});
      const result=evaluate(raw,c,mode);
      assert.equal(result.ruleExact,true);assert.equal(result.decisionExact,true);assert.equal(result.disagreements.total,0);
      if(mode==='rule')assert.deepEqual(Object.keys(packet(c,mode).sources),['E1']);
    }
  }
  const c=cases[0], bad=evaluate(JSON.stringify({policyRef:'E1',supportSets:[['C']]}),c,'rule');
  assert.ok(bad.disagreements.falseAllow>0);
  console.log('PAIRED_FIXTURE_PASS',sha(bytes),sha(goldBytes));
}
if(process.argv[2]==='--check'){check();process.exit(0);}
const jobs=cases.flatMap((c,i)=>(i%2?['rule','joint']:['joint','rule']).map(mode=>({c,mode})));
function evalFinal(raw,c,mode){
  try{return {status:'VALIDATED',evaluation:evaluate(raw,c,mode)};}
  catch(error){return {status:'REJECTED',error:String(error.message).slice(0,500)};}
}
if(process.argv[2]==='--verify'){
  const rows=readFileSync(process.argv[3],'utf8').trim().split('\n').map(parseStrictModelJson);
  assert.equal(rows[0].fixtureSha,sha(bytes));assert.equal(rows[0].goldSha,sha(goldBytes));
  assert.equal(rows[0].kind,'catalog');assert.equal(rows.at(-1).kind,'end');
  let at=1,attempts=0,stopped=false;
  for(const {c,mode} of jobs){
    const a=rows[at++];
    if(stopped){assert.deepEqual(a,{kind:'case',id:c.id,mode,status:'NOT_ATTEMPTED'});continue;}
    assert.equal(a.kind,'attempt');assert.equal(a.id,c.id);assert.equal(a.mode,mode);
    assert.equal(a.promptSha,sha(JSON.stringify(messages(c,mode))));
    assert.match(a.wireSha,/^[a-f0-9]{64}$/);attempts++;
    const r=rows[at++];assert.equal(r.kind,'case');assert.equal(r.id,c.id);assert.equal(r.mode,mode);
    if(r.status==='TRANSPORT_FAILED'){stopped=true;assert.equal(r.rawFinal,null);}
    else {
      assert.equal(r.transport.status,200);assert.equal(r.transport.model,rows[0].model);
      assert.equal(r.transport.finish,'stop');
      const actual=evalFinal(r.rawFinal,c,mode);
      assert.equal(actual.status,r.status);
      if(actual.status==='VALIDATED')assert.deepEqual(actual.evaluation,r.evaluation);
      else assert.equal(actual.error,r.error);
    }
  }
  assert.equal(at,rows.length-1);assert.deepEqual(rows.at(-1),{kind:'end',attempts,stopped});
  console.log('PAIRED_READBACK_PASS',attempts);process.exit(0);
}
const output=process.argv[2];assert.ok(output);
const baseURL='https://nvidi-nim.int.exe.xyz/v1',model='nvidia/nemotron-3-ultra-550b-a55b';
const cap=3072,timeoutMs=60000;
const catalog=await fetch(baseURL+'/models',{signal:AbortSignal.timeout(10000)});
assert.ok(catalog.ok);
const item=(await catalog.json()).data.find(x=>x.id===model);assert.equal(item?.id,model);
if(item.pricing)assert.ok(Object.keys(item.pricing).length&&Object.values(item.pricing).every(v=>v===0||v==='0'));
writeFileSync(output,'',{flag:'wx',mode:0o600});
const record=(kind,x)=>{const line=JSON.stringify({kind,...x});appendFileSync(output,line+'\n');console.log(line);};
record('catalog',{model,pricing:item.pricing??null,entitlement:'NVIDIA_DEVELOPER_RESEARCH',fixtureSha:sha(bytes),goldSha:sha(goldBytes)});
let active,transport=null,attempts=0,stopped=false;
const original=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{
  assert.equal(String(url),baseURL+'/chat/completions');
  const body=JSON.parse(opts.body);assert.equal(body.model,model);assert.equal(body.max_tokens,cap);
  assert.ok(attempts<jobs.length);
  const wire=JSON.stringify({...body,reasoning_effort:'medium'});
  attempts++;
  record('attempt',{id:active.c.id,mode:active.mode,promptSha:sha(JSON.stringify(messages(active.c,active.mode))),wireSha:sha(wire),maxOutputTokens:cap,timeoutMs,reasoningEffort:'medium'});
  const res=await original(url,{...opts,body:wire});
  const raw=await res.clone().json().catch(()=>({}));
  transport={status:res.status,model:raw.model??null,cost:raw.usage?.cost??raw.cost??null,finish:raw.choices?.[0]?.finish_reason??null,retryAfter:res.headers.get('retry-after'),requestId:res.headers.get('x-request-id')};
  return res;
};
for(const job of jobs){
  const {c,mode}=job;
  if(stopped){record('case',{id:c.id,mode,status:'NOT_ATTEMPTED'});continue;}
  active=job;transport=null;const start=Date.now();
  try{
    const r=await executeOpenAIChatTransport({baseURL,configuredProvider:'nvidia',configuredModel:model,timeoutMs,maxOutputTokens:cap,responseFormat:'json_object',messages:messages(c,mode)});
    assert.equal(transport?.model,model);assert.ok(transport.cost===null||transport.cost===0||transport.cost==='0');
    assert.equal(r.finishReason,'stop');
    record('case',{id:c.id,mode,...evalFinal(r.text,c,mode),rawFinal:r.text,usage:r.usage,transport,latencyMs:Date.now()-start});
  }catch(e){
    record('case',{id:c.id,mode,status:'TRANSPORT_FAILED',error:String(e.message).slice(0,500),code:e.code??null,providerState:e.providerState??null,rawFinal:null,transport,usage:e.usage??null,latencyMs:Date.now()-start});stopped=true;
  }
}
record('end',{attempts,stopped});
