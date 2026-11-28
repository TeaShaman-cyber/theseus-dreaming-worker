import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeProject} from '@barney-media/crap-typescript-core';
import {summarizeMetrics} from './report.mjs';
const root=mkdtempSync(join(tmpdir(),'dw-crap-calibration-'));
try {
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'package.json'),'{"private":true,"type":"module"}');
 const fn=name=>`export function ${name}(x: boolean): number {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\n`;
 writeFileSync(join(root,'src/cases.ts'),fn('partial')+fn('full')+fn('cold')+'export function guards(x: boolean, y: boolean): number {\n  if (x && y) {\n    return 1;\n  }\n  return 2;\n}\n');
 writeFileSync(join(root,'exercise.mjs'),"import assert from 'node:assert/strict';import {partial,full,guards} from './src/cases.ts';assert.equal(partial(true),1);assert.equal(full(true),1);assert.equal(full(false),2);assert.equal(guards(false,true),2);");
 execFileSync(fileURLToPath(new URL('./node_modules/.bin/c8',import.meta.url)),['--all','--include=src/**/*.ts','--reporter=json','--reports-dir=coverage','--temp-directory=v8',process.execPath,'exercise.mjs'],{cwd:root});
 const a=await analyzeProject({projectRoot:root,explicitPaths:['src'],coverageMode:'existing-only',coverageReportPath:join(root,'coverage/coverage-final.json'),useDefaultExclusions:false,threshold:30});
 const r=Object.fromEntries(summarizeMetrics(a.metrics).methods.map(x=>[x.name,x]));
 for(const [name,cc,cov,score,kind] of [['partial',2,50,2.5,'branch'],['full',2,100,2,'stmt'],['cold',2,0,6,'stmt'],['guards',3,100/3,17/3,'branch']]){
  assert.equal(r[name].complexity,cc);assert.ok(Math.abs(r[name].coverage-cov)<1e-8);assert.ok(Math.abs(r[name].crap-score)<1e-8);assert.equal(r[name].coverageKind,kind);
 }
 console.log('CRAP_CALIBRATION_PASS cases=4');
} finally {rmSync(root,{recursive:true,force:true});}
