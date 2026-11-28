import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';

export function summarizeMetrics(metrics){
 assert.ok(metrics.length,'CRAP_EMPTY');
 const methods=metrics.map(m=>{
  const percent=m.coverage.percent;
  assert.ok(Number.isInteger(m.complexity)&&m.complexity>=1,'CRAP_COMPLEXITY');
  assert.ok(percent===null||(Number.isFinite(percent)&&percent>=0&&percent<=100),'CRAP_COVERAGE');
  const expected=percent===null?null:m.complexity**2*(1-percent/100)**3+m.complexity;
  assert.ok(expected===null?m.crapScore===null:Number.isFinite(m.crapScore)&&Math.abs(m.crapScore-expected)<1e-8,'CRAP_SCORE');
  const stmt=m.statementCoverage,branch=m.branchCoverage;
  const kind=m.coverage.status!=='measured'?'N/A':stmt.status==='measured'?(branch.status==='measured'&&branch.percent<stmt.percent?'branch':'stmt'):'branch';
  return {file:m.relativePath,name:m.displayName,start:m.startLine,end:m.endLine,complexity:m.complexity,
   coverage:percent,coverageKind:kind,statementCoverage:stmt,branchCoverage:branch,coverageStatus:m.coverage.status,unknownReason:m.coverage.unknownReason,crap:m.crapScore};
 }).sort((a,b)=>(b.crap??-1)-(a.crap??-1)||a.file.localeCompare(b.file)||a.start-b.start||a.name.localeCompare(b.name));
 return {total:methods.length,unknown:methods.filter(m=>m.crap===null).length,above30:methods.filter(m=>m.crap!==null&&m.crap>30).length,methods};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [coveragePath,outputPath,mode]=process.argv.slice(2);
 assert.ok(coveragePath&&outputPath&&['unit','combined'].includes(mode),'usage: report.mjs coverage.json report.json unit|combined');
 const projectRoot=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:projectRoot}).trim();
 const coverage=readFileSync(coveragePath);
 assert.ok(Object.keys(JSON.parse(coverage)).length,'CRAP_EMPTY_COVERAGE');
 const {analyzeProject}=await import('@barney-media/crap-typescript-core');
 const analysis=await analyzeProject({projectRoot,explicitPaths:['src'],coverageMode:'existing-only',coverageReportPath:resolve(coveragePath),useDefaultExclusions:false,threshold:30});
 assert.equal(analysis.coverageCommands.length,0);
 const summary=summarizeMetrics(analysis.metrics);
 const files=analysis.selectedFiles.map(p=>relative(projectRoot,p)).sort();
 const report={schema:'theseus.dw.crap-report.v1',sourceCommit:sha,mode,node:process.version,
  analyzer:'2.0.2',c8:'12.0.0',coverageSha256:createHash('sha256').update(coverage).digest('hex'),
  files,disposition:'ADVISORY',warnings:analysis.warnings,...summary};
 writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({sourceCommit:sha,mode,total:summary.total,unknown:summary.unknown,above30:summary.above30,top:summary.methods.slice(0,5)},null,2));
}
