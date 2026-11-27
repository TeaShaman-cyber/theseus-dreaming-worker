// No inference: verify exact historical observation and negative controls.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const path=name=>fileURLToPath(new URL(name,import.meta.url));
const original=readFileSync(path('reuse-observation.jsonl'));
const rows=original.toString().trim().split('\n').map(JSON.parse);
const dir=mkdtempSync(join(tmpdir(),'dw-reuse-readback-'));
let count=0;
try{
  const file=join(dir,'candidate.jsonl');
  function run(bytes,expected){
    writeFileSync(file,bytes);
    const r=spawnSync(process.execPath,[path('reuse-policy.mjs'),'--verify',file],{encoding:'utf8',timeout:10000});
    assert.ifError(r.error);
    assert.equal(r.status,expected,r.stdout+r.stderr);
    if(expected)count++;
  }
  run(original,0);
  const mutate=f=>{const x=structuredClone(rows);f(x);run(x.map(r=>JSON.stringify(r)).join('\n')+'\n',1);};
  mutate(x=>{x[0].model='different-model';for(const r of x.filter(r=>r.kind==='case'))r.transport.model=x[0].model;});
  for(const [key,value] of Object.entries({wireSha:'0'.repeat(64),maxOutputTokens:1024,timeoutMs:1,reasoningEffort:'none',policySha:'0'.repeat(64),ruleSha:'0'.repeat(64),promptSha:'0'.repeat(64)})){
    mutate(x=>{x.find(r=>r.kind==='attempt')[key]=value;});
  }
  mutate(x=>{x.find(r=>r.kind==='case').usage.totalTokens++;});
  mutate(x=>{x.find(r=>r.kind==='case').latencyMs++;});
  mutate(x=>{x.find(r=>r.kind==='case').transport.cost=1;});
  mutate(x=>{x.find(r=>r.kind==='case').rawFinal='{}';});
  mutate(x=>{x.splice(x.findIndex(r=>r.kind==='case'),1);});
  mutate(x=>{x[0].snapshotSha='0'.repeat(64);});
  mutate(x=>{x[0].reuseGoldSha='0'.repeat(64);});
}finally{rmSync(dir,{recursive:true,force:true});}
console.log('REUSE_RECEIPT_NEGATIVE_PASS',count);
