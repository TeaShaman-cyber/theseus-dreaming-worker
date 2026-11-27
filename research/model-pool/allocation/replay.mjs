// Offline finite-horizon allocation. No inference, real quota or scheduler.
import assert from 'node:assert/strict';
import {selectModelPool} from '../../../src/dreaming/model-pool.ts';

const route=(id,provider=id,modelFamily=id)=>({id,provider,model:id,modelFamily,
  admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:1000});
const distinct=['a','b','c','d'].map(id=>route(id));
const shared=[route('a','p','A'),route('b','p','B'),route('c','q','A'),route('d','r','C')];
const masks=Array.from({length:15},(_,i)=>i+1);
const eligible=(routes,mask)=>routes.filter((_,i)=>mask&(1<<i));
const family=r=>r.modelFamily.trim().toLowerCase();
function consume(cap,r){return {...cap,[r.provider]:cap[r.provider]-1};}
function pairs(routes,mask,cap){
  const pool=eligible(routes,mask);
  return pool.flatMap((a,i)=>pool.slice(i+1).filter(b=>family(a)!==family(b)&&cap[a.provider]>0&&cap[b.provider]>(a.provider===b.provider?1:0)).map(b=>[a,b]));
}
// Independent brute-force oracle enumerates all job choices (including skip).
function oracle(routes,jobs,capacity){
  const options=jobs.map(mask=>{
    const choices=[[]];
    for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
      if((mask&(1<<i))&&(mask&(1<<j))&&routes[i].modelFamily.toLowerCase()!==routes[j].modelFamily.toLowerCase())
        choices.push([routes[i],routes[j]]);
    }
    return choices;
  });
  let best=0;
  function visit(i,chosen){
    if(i===jobs.length){
      const counts={};
      for(const r of chosen.flat())counts[r.provider]=(counts[r.provider]??0)+1;
      if(Object.keys(counts).every(p=>counts[p]<=capacity[p]))best=Math.max(best,chosen.filter(p=>p.length===2).length);
      return;
    }
    for(const p of options[i])visit(i+1,[...chosen,p]);
  }
  visit(0,[]);return best;
}
// Capacity DP: fixed job order, exact feasible pair or skip, known future masks.
function optimum(routes,jobs,capacity){
  const providers=Object.keys(capacity).sort(),memo=new Map();
  function visit(i,cap){
    if(i===jobs.length)return 0;
    const key=JSON.stringify([i,...providers.map(p=>cap[p])]);
    if(memo.has(key))return memo.get(key);
    let best=visit(i+1,cap);
    for(const [a,b] of pairs(routes,jobs[i],cap))best=Math.max(best,1+visit(i+1,consume(consume(cap,a),b)));
    memo.set(key,best);return best;
  }
  return visit(0,capacity);
}
// Real selector, sequential dispatch as in pooled executor. Capacity is
// a hypothetical known per-provider allowance over this short horizon.
function baseline(routes,jobs,capacity){
  let cap={...capacity},rotation=0,completed=0,partial=0,attempts=0;
  for(const mask of jobs){
    let frozen=null;
    for(let slot=0;slot<2;slot++){
      const pool=eligible(routes,mask).filter(r=>cap[r.provider]>0);
      const selected=selectModelPool({routes:pool,taskClass:'analysis',nowMs:100,rotation,
        remainingAttempts:2-slot,attemptedRouteIds:frozen?[frozen.id]:[],cooldowns:[],frozen,unresolvedAttempt:false});
      if(selected.status!=='READY'){if(slot===1)partial++;break;}
      const r=selected.routes[0];
      assert.ok(cap[r.provider]>0);
      cap=consume(cap,r);attempts++;rotation=selected.nextRotation;
      if(slot===0)frozen=r;else completed++;
    }
  }
  return {completed,partial,attempts};
}
// Cheap heuristic: prefer a pair consuming capacity of providers less often
// eligible in future jobs; count demand once per future job/provider.
function scarcity(routes,jobs,capacity){
  let cap={...capacity},completed=0;
  for(const [i,mask] of jobs.entries()){
    const demand=p=>jobs.slice(i+1).filter(m=>eligible(routes,m).some(r=>r.provider===p)).length;
    const score=pair=>pair.reduce((n,r)=>n+demand(r.provider)/cap[r.provider],0);
    const candidates=pairs(routes,mask,cap).sort((a,b)=>score(a)-score(b));
    if(candidates.length){const [a,b]=candidates[0];cap=consume(consume(cap,a),b);completed++;}
  }
  return completed;
}
assert.equal(baseline(distinct,[15,3],{a:1,b:1,c:1,d:1}).completed,1);
assert.equal(optimum(distinct,[15,3],{a:1,b:1,c:1,d:1}),2);
assert.equal(scarcity(distinct,[15,3],{a:1,b:1,c:1,d:1}),2);
const results=[];
for(const [name,routes,capacity] of [
  ['distinct-unit',distinct,{a:1,b:1,c:1,d:1}],
  ['distinct-mixed',distinct,{a:2,b:1,c:2,d:1}],
  ['shared-provider-family',shared,{p:2,q:1,r:2}],
  ['shared-tight',shared,{p:1,q:1,r:1}],
]){
  const r={name,capacity,scenarios:0,optimalCompletions:0,greedyCompletions:0,scarcityCompletions:0,greedySuboptimal:0,scarcitySuboptimal:0,greedyPartial:0};
  for(const a of masks)for(const b of masks)for(const c of masks){
    const jobs=[a,b,c],exact=optimum(routes,jobs,capacity),check=oracle(routes,jobs,capacity);
    assert.equal(exact,check);
    const base=baseline(routes,jobs,capacity),cheap=scarcity(routes,jobs,capacity);
    assert.ok(base.completed<=exact&&cheap<=exact);
    r.scenarios++;r.optimalCompletions+=exact;r.greedyCompletions+=base.completed;r.scarcityCompletions+=cheap;
    r.greedySuboptimal+=Number(base.completed<exact);r.scarcitySuboptimal+=Number(cheap<exact);r.greedyPartial+=base.partial;
  }
  results.push(r);
}
console.log(JSON.stringify({schema:'pool-allocation-synthetic-v1',scenarios:results.reduce((n,r)=>n+r.scenarios,0),results},null,2));
