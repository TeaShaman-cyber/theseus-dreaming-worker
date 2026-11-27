import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MUTATION_SHARDS } from '../scripts/mutation-shards.mjs';
import { planMutation, parseChangedPaths } from '../tools/ci/mutation-feedback.mjs';

const all = Object.keys(MUTATION_SHARDS);
const draft = { action:'synchronize', pull_request:{draft:true} };
const focused = (paths) => planMutation('pull_request',draft,paths);

test('draft feedback selects all shards sharing a changed test, without claiming acceptance',()=>{
  assert.deepEqual(focused(['test/durable-pilot2.test.mjs']),{mode:'feedback',shards:all.filter(s=>MUTATION_SHARDS[s].tests.includes('test/durable-pilot2.test.mjs'))});
  assert.deepEqual(focused(['test/serializer-benchmark.test.mjs','test/pilot2-runner.test.mjs']),{mode:'feedback',shards:all.filter(s=>['serializer','pilot2'].includes(s))});
});
test('ledger feedback retains both full-file scopes for every shared ledger test',()=>{
  for (const path of ['test/proposal-ledger.test.mjs','test/proposal-ledger-postgres.test.mjs','test/durable-pilot2.test.mjs']) {
    const expected = path === 'test/durable-pilot2.test.mjs' ? ['checkpoint','ledger-core','ledger-postgres'] : ['ledger-core','ledger-postgres'];
    assert.deepEqual(focused([path]),{mode:'feedback',shards:expected});
  }
});
test('source-batch test feedback always selects both independent mutation ranges',()=>{
  assert.deepEqual(focused(['test/source-batch-run.test.mjs']),{
    mode:'feedback',shards:['source-batch-fixed','source-batch-pooled']
  });
});
test('unknown, empty, shared fixture and runtime changes conservatively select every shard',()=>{
  for(const paths of [null,[],['test/fixtures/source-reader.json'],['src/dreaming/pilot2-runner.ts'],['test/pilot2-runner.test.mjs','package.json'],['test/unknown.test.mjs']]) {
    assert.deepEqual(focused(paths),{mode:'feedback',shards:all});
  }
});
test('ready, non-draft, main and default manual dispatch always run all shards',()=>{
  for(const [name,event] of [['pull_request',{...draft,action:'ready_for_review'}],['pull_request',{pull_request:{draft:false}}],['push',{}],['workflow_dispatch',{inputs:{shard:''}}],['unexpected',{}]]) {
    assert.deepEqual(planMutation(name,event,['test/pilot2-runner.test.mjs']),{mode:'full',shards:all});
  }
});
test('manual focused dispatch is explicit and invalid names fail closed',()=>{
  assert.deepEqual(planMutation('workflow_dispatch',{inputs:{shard:'ledger-core'}}),{mode:'feedback',shards:['ledger-core']});
  for (const shard of ['unknown','constructor','__proto__','toString','ledger\nother']) assert.throws(()=>planMutation('workflow_dispatch',{inputs:{shard}}),/MUTATION_SHARD_UNKNOWN/);
});
test('only modified paths are eligible for automatic narrowing; additions, deletes, renames and malformed records fall back',()=>{
  assert.deepEqual(parseChangedPaths('M\0test/pilot2-runner.test.mjs\0M\0test/durable-pilot2.test.mjs\0'),['test/pilot2-runner.test.mjs','test/durable-pilot2.test.mjs']);
  for(const raw of ['A\0test/pilot2-runner.test.mjs\0','D\0test/pilot2-runner.test.mjs\0','R100\0a\0b\0','M\0','M\0a',''])assert.equal(parseChangedPaths(raw),null);
});
test('hosted workflow runs the planner and gives focused jobs distinct non-acceptance names',()=>{
  const workflow=readFileSync('.github/workflows/mutation.yml','utf8');
  assert.match(workflow,/ready_for_review/);
  assert.match(workflow,/node tools\/ci\/mutation-feedback\.mjs/);
  assert.match(workflow,/fromJSON\(needs\.plan\.outputs\.shards\)/);
  assert.match(workflow,/mutation feedback/);
  assert.match(workflow,/mutation-feedback-receipt/);
  assert.match(workflow,/mutation-receipt-/);
});

test('planner reads actual Git diff and falls back on force-pushed or mismatched identity', async()=>{
  const {execFileSync}=await import('node:child_process');
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const cwd=mkdtempSync(join(tmpdir(),'dw-mutation-feedback-'));
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init','-q'); git('config','user.email','synthetic@example.invalid'); git('config','user.name','Synthetic QA');
    mkdirSync(join(cwd,'test'));
    const path='test/pilot2-runner.test.mjs';
    writeFileSync(join(cwd,path),'before\n'); git('add','.');git('commit','-qm','base');const before=git('rev-parse','HEAD');
    writeFileSync(join(cwd,path),'after\n');git('add','.');git('commit','-qm','test edit');const head=git('rev-parse','HEAD');
    const eventPath=join(cwd,'event.json'),out=join(cwd,'output');
    const invoke=(old,after,action='synchronize',isDraft=true)=>{
      writeFileSync(eventPath,JSON.stringify({action,before:old,after,pull_request:{draft:isDraft,head:{sha:head},base:{sha:before}}}));writeFileSync(out,'');
      const raw=execFileSync(process.execPath,[fileURLToPath(new URL('../tools/ci/mutation-feedback.mjs',import.meta.url))],{cwd,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:out}});
      const plan=JSON.parse(raw);assert.equal(readFileSync(out,'utf8'),`mode=${plan.mode}\nshards=${JSON.stringify(plan.shards)}\n`);return plan;
    };
    assert.deepEqual(invoke(before,head),{mode:'feedback',shards:['pilot2']});
    assert.deepEqual(invoke(before,head,'opened'),{mode:'feedback',shards:['pilot2']});
    assert.deepEqual(invoke(before,before),{mode:'feedback',shards:all});
    assert.deepEqual(invoke('0'.repeat(40),head),{mode:'feedback',shards:all});
    assert.deepEqual(invoke(before,head,'ready_for_review',false),{mode:'full',shards:all});
  } finally {rmSync(cwd,{recursive:true,force:true});}
});
