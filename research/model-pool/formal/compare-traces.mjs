// Compare the Lean executable abstraction with actual TS replay, not a second JS model.
// Each path uses a distinct physical route per START and the current pending attempt
// identity for outcomes. Full provenance/schema/cooldown/CAS tests remain separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preparePoolJournal, poolJournalAdmission, makePoolJournalEntry, replayPoolJournal } from '../../../src/dreaming/pool-attempt-journal.ts';
const input = {
  acceptedSourceFingerprint: 'sha256:' + 'a'.repeat(64), analysisVersion: 'formal-trace-v1',
  request: {scope:'SYNTHETIC_FIXTURE',task:'Synthetic transition check.',packet:{
    schema:'theseus-evidence-packet-v1',packetId:'formal-trace',acceptedNewEvidence:true,
    coverage:{state:'COMPLETE',currentness:'CURRENT'},
    evidence:[{sourceRef:'fixture:1',evidenceHash:'sha256:fixture',text:'Synthetic observation.'}],
  }},
};
const ctx=preparePoolJournal(input);
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const rows=readFileSync(process.argv[2],'utf8').split('\n').filter(l=>l.startsWith('TRACE|'));
assert.equal(rows.length,1998);
const prefixes=new Map();
for(const cap of [2,3,4]){
 const entries=[makePoolJournalEntry(null,poolJournalAdmission(ctx,cap))];
 prefixes.set(cap+':',{entries,state:replayPoolJournal(ctx,entries)});
}
let accepted=0,rejected=0,complete=0,unknown=0;
const seen=new Set();
for(const line of rows){
 const [tag,cap,path,expected,used,first,second,phase]=line.split('|');
 assert.equal(tag,'TRACE');
 assert.ok(['accept','reject'].includes(expected));
 assert.ok(!seen.has(cap+':'+path),'duplicate trace');seen.add(cap+':'+path);
 const codes=path.split(',').map(Number);
 assert.ok(codes.length>0&&codes.length<=6&&codes.every(n=>Number.isInteger(n)&&n>=0&&n<=5));
 const parent=prefixes.get(cap+':'+codes.slice(0,-1).join(','));
 assert.ok(parent,'missing accepted prefix');
 const {entries,state}=parent;
 const n=codes.at(-1),depth=codes.length;
 let event;
 if(n<3){
  const route={id:'route-'+depth,provider:'provider-'+depth,model:'model-'+depth,modelFamily:String(n+1)};
  event={kind:'START',attemptId:uid(depth),slot:state.validated.length,route};
 }else{
  const pending=state.pending;
  const attemptId=pending?.attemptId??uid(999);
  if(n===3)event={kind:'VALIDATED',attemptId,receipt:{
    packetId:ctx.request.packet.packetId,requestFingerprint:ctx.requestFingerprint,evidenceFingerprint:ctx.evidenceFingerprint,
    provider:pending?.route.provider??'absent',model:pending?.route.model??'absent',
    finishReason:'stop',externalModelCalls:1,toolsUsed:0,memoryUsed:false,canonicalWrites:0,
  },proposalSet:{schema:'theseus.dreaming-worker.proposals.v1',proposals:[
    {type:'FACT',claim:'Synthetic observation.',source_refs:[{source_ref:'fixture:1',evidence_hash:'sha256:fixture'}]},
  ]}};
  else if(n===4)event={kind:'KNOWN_FAILURE',attemptId,providerState:'RESPONDED',code:'RATE_LIMITED',cooldown:null};
  else event={kind:'UNKNOWN',attemptId,code:'EXECUTION_UNKNOWN'};
 }
 let result,next,error;
 try{
  next=[...entries,makePoolJournalEntry(entries.at(-1),event)];
  result=replayPoolJournal(ctx,next);
 }catch(e){error=e;}
 assert.equal(result?'accept':'reject',expected,line+' '+(error?.message??''));
 if(!result){rejected++;continue;}
 accepted++;
 assert.equal(result.attempts.length,Number(used),line);
 const families=result.validated.map(v=>Number(v.start.route.modelFamily));
 assert.equal(families[0]??0,Number(first),line);
 assert.equal(families[1]??0,Number(second),line);
 assert.equal(result.pending?'running:'+result.pending.route.modelFamily:result.unresolved?'unknown':'ready',phase,line);
 // Concrete stronger check: entire previously accepted objects are unchanged,
 // not just the family labels in Lean's abstraction.
 assert.deepEqual(result.validated.slice(0,state.validated.length),state.validated,line);
 if(result.validated.length===2)complete++;
 if(result.unresolved&&!result.pending)unknown++;
 prefixes.set(cap+':'+path,{entries:next,state:result});
}
assert.ok(complete>0&&unknown>0&&rejected>0,'vacuous coverage');
console.log('LEAN_TS_TRACE_PARITY_PASS',JSON.stringify({traces:rows.length,accepted,rejected,complete,unknown}));
