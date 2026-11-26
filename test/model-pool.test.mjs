import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectModelPool } from '../src/dreaming/model-pool.ts';

const route = (id, modelFamily, provider = id, extra = {}) => ({
  id, provider, model: id, modelFamily, admission: 'FREE_RESEARCH',
  qualifiedTasks: ['analysis'], catalog: 'PRESENT', catalogValidUntilMs: 1000, ...extra,
});
const a = route('a', 'A', 'p');
const b = route('b', 'B', 'p');
const c = route('c', 'C', 'q');
const input = (extra = {}) => ({
  routes: [a,b,c], taskClass: 'analysis', nowMs: 100, rotation: 0,
  remainingAttempts: 4, attemptedRouteIds: [], cooldowns: [],
  frozen: null, unresolvedAttempt: false, ...extra,
});
const ids = result => result.routes?.map(r => r.id);
const cooldown = (scope, key, notBeforeMs) => ({scope,key,notBeforeMs});
const frozen = ({id,provider,model,modelFamily}) => ({id,provider,model,modelFamily});

test('prefers independent providers then rotates deterministically', () => {
  const first = selectModelPool(input());
  assert.equal(first.status,'READY');
  assert.deepEqual(ids(first),['a','c']);
  assert.equal(first.nextRotation,1);
  const second = selectModelPool(input({rotation:first.nextRotation}));
  assert.deepEqual(ids(second),['b','c']);
  assert.deepEqual(ids(selectModelPool(input({rotation:2}))),['c','a']);
  assert.deepEqual(ids(selectModelPool(input({routes:[a,b]}))),['a','b']);
});

test('catalog and task qualification and explicit free admission are separate filters', () => {
  for (const extra of [
    {admission:'UNKNOWN'}, {admission:'NOT_AUTHORIZED'}, {catalog:'ABSENT'},
    {catalog:'UNKNOWN'}, {catalogValidUntilMs:100}, {qualifiedTasks:['other']},
  ]) {
    const result=selectModelPool(input({routes:[a,route('b','B','q',extra)]}));
    assert.equal(result.status,'INSUFFICIENT_ELIGIBILITY');
  }
  assert.equal(selectModelPool(input({routes:[a,route('b',' a ','q')]})).status,'INSUFFICIENT_ELIGIBILITY');
});

test('replace only missing slot, even when successful route is retired', () => {
  const r=selectModelPool(input({routes:[b,c,route('d','A','r')],frozen:frozen(a),
    attemptedRouteIds:['b'],remainingAttempts:1}));
  assert.deepEqual(ids(r),['c']);
  assert.equal(selectModelPool(input({frozen:frozen(a),remainingAttempts:0})).status,'BUDGET_EXHAUSTED');
  assert.equal(selectModelPool(input({remainingAttempts:1})).status,'BUDGET_EXHAUSTED');
  assert.equal(selectModelPool(input({frozen:frozen(a),unresolvedAttempt:true})).status,'BLOCKED_UNKNOWN');
});

test('route and provider cooldown scopes and earliest feasible wake', () => {
  assert.deepEqual(ids(selectModelPool(input({cooldowns:[cooldown('route','a',200)]}))),['b','c']);
  assert.deepEqual(selectModelPool(input({cooldowns:[cooldown('provider','p',200),cooldown('route','c',300)]})),
    {status:'DEFERRED',wakeAtMs:200});
  assert.deepEqual(selectModelPool(input({routes:[a,c],cooldowns:[cooldown('provider','p',200),cooldown('route','c',300)]})),
    {status:'DEFERRED',wakeAtMs:300});
  assert.equal(selectModelPool(input({routes:[a,{...c,catalogValidUntilMs:300}],cooldowns:[cooldown('route','c',300)]})).status,
    'INSUFFICIENT_ELIGIBILITY');
  assert.deepEqual(selectModelPool(input({frozen:frozen(a),cooldowns:[cooldown('provider','p',500),cooldown('route','c',250),cooldown('route','c',350)]})),
    {status:'DEFERRED',wakeAtMs:350});
  assert.deepEqual(ids(selectModelPool(input({nowMs:200,cooldowns:[cooldown('provider','p',200)]}))),['a','c']);
});

test('invalid or ambiguous identities and unbounded input fail before selection', () => {
  for (const extra of [{routes:[a,a]}, {routes:[a,{...a,id:'alias',modelFamily:'B'}]},
    {remainingAttempts:201},{rotation:-1},{nowMs:NaN},{cooldowns:[cooldown('route','a',Infinity)]},
    {attemptedRouteIds:['a','a']},{routes:[{...a,modelFamily:' '}]}]) {
    assert.throws(()=>selectModelPool(input(extra)));
  }
});

test('exhaustive small-state feasibility against enumerated time oracle', () => {
  let scenarios=0;
  // 3^3 availability states x 2^3 admission masks x 2^3 attempted masks
  // x frozen/no frozen x three rotations. Check all possible wake ticks.
  const choices=[a,b,c];
  for(let state=0;state<27;state++) for(let mask=0;mask<8;mask++) for(let used=0;used<8;used++)
    for(const held of [null,frozen(a)]) for(let rotation=0;rotation<3;rotation++){
      const routes=choices.map((r,i)=>({...r,admission:(mask&(1<<i))?'FREE_RESEARCH':'UNKNOWN'}));
      const attemptedRouteIds=choices.filter((_,i)=>used&(1<<i)).map(r=>r.id);
      const cooldowns=choices.map((r,i)=>cooldown('route',r.id,100+100*(Math.floor(state/3**i)%3)));
      const request=input({routes,attemptedRouteIds,cooldowns,frozen:held,rotation});
      const feasible=t=>{
        const pool=routes.filter((r,i)=>r.admission==='FREE_RESEARCH'&&!attemptedRouteIds.includes(r.id)
          &&cooldowns[i].notBeforeMs<=t&&(!held||r.modelFamily!==held.modelFamily));
        return held?pool.length>0:pool.some(x=>pool.some(y=>x.modelFamily!==y.modelFamily));
      };
      const earliest=[100,200,300].find(feasible);
      const result=selectModelPool(request);
      if(earliest===100){
        assert.equal(result.status,'READY');
        assert.equal(result.routes.length,held?1:2);
        for(const r of result.routes){
          const i=routes.findIndex(x=>x.id===r.id);
          assert.ok(i>=0 && routes[i].admission==='FREE_RESEARCH'&&!attemptedRouteIds.includes(r.id));
          assert.ok(cooldowns[i].notBeforeMs<=100);
        }
        assert.equal(new Set([...result.routes,...(held?[held]:[])].map(r=>r.modelFamily)).size,2);
        assert.deepEqual(result,selectModelPool(request));
      }else if(earliest!==undefined)assert.deepEqual(result,{status:'DEFERRED',wakeAtMs:earliest});
      else assert.equal(result.status,'INSUFFICIENT_ELIGIBILITY');
      scenarios++;
    }
  assert.equal(scenarios,10368);
});
