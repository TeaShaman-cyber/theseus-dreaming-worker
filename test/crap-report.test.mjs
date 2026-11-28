import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeMetrics} from '../tools/quality/report.mjs';
const metric=(name,complexity,percent,kind='branch')=>({
 displayName:name,relativePath:'src/example.ts',startLine:1,endLine:5,complexity,
 coverage:{percent,status:percent===null?'unknown':'measured',unknownReason:percent===null?'fnmap_conflict':null},
 statementCoverage:{percent:kind==='stmt'?percent:null,status:kind==='stmt'?'measured':'unknown',unknownReason:kind==='stmt'?null:'statement_unattributed'},
 branchCoverage:{percent:kind==='branch'?percent:null,status:kind==='branch'&&percent!==null?'measured':'unknown',unknownReason:kind==='branch'&&percent!==null?null:'branch_unattributed'},
 crapScore:percent===null?null:complexity**2*(1-percent/100)**3+complexity,
});
test('advisory report distinguishes unknown and statement-only coverage',()=>{
 const result=summarizeMetrics([metric('unknown',80,null),metric('cold',8,0),metric('full',41,100,'stmt'),metric('half',2,50)]);
 assert.deepEqual(result.methods.map(m=>m.name),['cold','full','half','unknown']);
 assert.equal(result.unknown,1);assert.equal(result.above30,2);
 assert.equal(result.methods[1].coverageKind,'stmt');
 assert.equal(result.methods[1].branchCoverage.status,'unknown');
 assert.equal(result.methods[2].coverageKind,'branch');
 assert.equal(result.methods[3].crap,null);
 assert.equal(result.methods[3].unknownReason,'fnmap_conflict');
});
test('rejects inconsistent score and invalid coverage rather than reporting green',()=>{
 assert.throws(()=>summarizeMetrics([{...metric('bad',2,50),crapScore:0}]),/CRAP_SCORE/);
 assert.throws(()=>summarizeMetrics([metric('bad',2,101)]),/CRAP_COVERAGE/);
 assert.throws(()=>summarizeMetrics([]),/CRAP_EMPTY/);
});
