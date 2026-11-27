import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { createPostgresSourceBatchStore } from '../../src/dreaming/source-batch-postgres.ts';
import { sourceReceiptFingerprint } from '../../src/dreaming/source-batch-receipt.ts';
import { runSourceCycle } from '../../src/dreaming/source-cycle.ts';
const connectionString=process.env.LEDGER_DATABASE_URL;
assert.ok(connectionString);
const fixture=JSON.parse(readFileSync(new URL('../../test/fixtures/source-empty-refresh.json',import.meta.url),'utf8'));
const store=createPostgresSourceBatchStore({connectionString});
const input={candidate:fixture.candidate,expected:fixture.expected,task:'Synthetic custody-only recapture.',analysisVersion:'empty-ack-v1'};
const root=await store.initialize(input);
assert.equal(root.status,'ACKNOWLEDGED');
const x={...input,previousCheckpoint:root.receipt.receiptFingerprint};
const fail=async()=>{throw Error('unexpected execution');};
const cycle=await runSourceCycle({...x,indexes:[],bounds:{maxPages:1,maxChars:100,maxMessages:1},maxSessions:1},{limits:{maxRequests:1,maxPageBytes:100,maxTotalBytes:100,timeoutMs:100,pageMessages:1,pageChars:1},routes:[{id:'a',provider:'a',model:'a',modelFamily:'a',infer:fail},{id:'b',provider:'b',model:'b',modelFamily:'b',infer:fail}],maxPasses:0,transport:fail,store:{readTip:fail,stage:fail,runSelected:fail,acknowledge:fail}});
assert.equal(cycle.status,'NO_SELECTED_WORK');
assert.equal(cycle.attemptedPasses,0);
assert.deepEqual(await store.readTip(x),root.receipt);
const db=new Client({connectionString});
await db.connect();
try {
 const counts=async()=> (await db.query('SELECT (SELECT count(*) FROM dw_ledger.work_reservations) AS reservations,(SELECT count(*) FROM dw_ledger.work_completions) AS completions,(SELECT count(*) FROM dw_ledger.work_pool_journal) AS journal,(SELECT count(*) FROM dw_ledger.proposal_records) AS proposals,(SELECT count(*) FROM dw_ledger.source_plans) AS plans')).rows[0];
 const before=await counts();
 const changed=(mutate)=>{
   const y=structuredClone(x);
   mutate(y.candidate,y.expected);
   delete y.candidate.candidate_sha256;
   y.candidate.candidate_sha256=sourceReceiptFingerprint(y.candidate).slice(7);
   return y;
 };
 for(const invalid of [
   {...x,expected:{...x.expected,previousSnapshotSha256:'0'.repeat(64)}},
   changed(c=>{c.removed=['synthetic-removed'];}),
   changed(c=>{c.current_membership=c.previous_membership;}),
   {...x,expected:{...x.expected,catalog:[]}},
 ]) {
   await assert.rejects(()=>store.acknowledgeNoWork(invalid),/HANDOFF|SOURCE_NO_WORK|Too small/);
 }
 assert.equal((await store.acknowledgeNoWork({...x,previousCheckpoint:'sha256:'+'1'.repeat(64)})).status,'CONFLICT');
 assert.deepEqual(await store.readTip(x),root.receipt);
 const ack=await store.acknowledgeNoWork(x);
 assert.equal(ack.status,'ACKNOWLEDGED');
 assert.equal(ack.receipt.schema,'theseus.dreaming-worker.source-no-work-receipt.v1');
 assert.equal(ack.receipt.reason,'VERIFIED_EMPTY_SESSION_DELTA');
 assert.equal(ack.receipt.attemptedPasses,0);
 assert.deepEqual(ack.receipt.handoff,x.candidate);
 assert.deepEqual(await store.readTip(x),ack.receipt);
 const restarted=createPostgresSourceBatchStore({connectionString});
 const repeat=await restarted.acknowledgeNoWork(x);
 assert.equal(repeat.status,'ALREADY_ACKNOWLEDGED');
 assert.deepEqual(repeat.receipt,ack.receipt);
 const other=changed(c=>{c.promotion_receipt_sha256='2'.repeat(64);});
 assert.equal((await restarted.acknowledgeNoWork(other)).status,'CONFLICT');
 assert.deepEqual(await counts(),before);
 assert.deepEqual(await restarted.readTip(x),ack.receipt);
 // Actual nonempty staged plan contradicts an alternative empty claim.
 const nonempty=JSON.parse(readFileSync(new URL('../../test/fixtures/source-refresh.json',import.meta.url),'utf8')).before;
 const pending={...nonempty,task:'Synthetic pending-plan exclusion.',analysisVersion:'empty-ack-v1',maxSessions:4,bounds:{maxPages:20,maxChars:1000,maxMessages:100}};
 const pendingRoot=await store.initialize(pending);
 pending.previousCheckpoint=pendingRoot.receipt.receiptFingerprint;
 assert.equal((await store.stage(pending)).status,'STAGED');
 const emptyAlternative=structuredClone(pending);
 emptyAlternative.candidate.selected=[];
 delete emptyAlternative.candidate.candidate_sha256;
 emptyAlternative.candidate.candidate_sha256=sourceReceiptFingerprint(emptyAlternative.candidate).slice(7);
 assert.equal((await store.acknowledgeNoWork(emptyAlternative)).status,'PENDING');
 assert.deepEqual(await store.readTip(pending),pendingRoot.receipt);
 await assert.rejects(()=>store.acknowledgeNoWork(pending),/SOURCE_NO_WORK_DELTA/);
 // A committed write with a lost acknowledgement is recovered by exact readback.
 const lost={...input,task:'Synthetic empty ack loss.'};
 const lostRoot=await store.initialize(lost);
 lost.previousCheckpoint=lostRoot.receipt.receiptFingerprint;
 let lostCommit=0;
 const lossy=createPostgresSourceBatchStore({connectionString,clientFactory:url=>{
   const client=new Client({connectionString:url});
   return {connect:()=>client.connect(),end:()=>client.end(),async query(sql,params){
     const result=await client.query(sql,params);
     if(sql==='COMMIT'){lostCommit++;throw Error('synthetic lost commit acknowledgement');}
     return result;
   }};
 }});
 const recovered=await lossy.acknowledgeNoWork(lost);
 assert.equal(recovered.status,'ACKNOWLEDGED');
 assert.equal(lostCommit,1);
 assert.deepEqual(await store.readTip(lost),recovered.receipt);
 // Competing valid synthetic candidates cannot fork the chain.
 const race={...input,task:'Synthetic empty ack race.'};
 const raceRoot=await store.initialize(race);
 race.previousCheckpoint=raceRoot.receipt.receiptFingerprint;
 const competitor={...race,candidate:other.candidate};
 const outcomes=await Promise.all([store.acknowledgeNoWork(race),restarted.acknowledgeNoWork(competitor)]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),['ACKNOWLEDGED','CONFLICT']);
 assert.deepEqual(await store.readTip(race),outcomes.find(r=>r.status==='ACKNOWLEDGED').receipt);
 console.log('SOURCE_EMPTY_ACK_PG_PASS membership=7_to_11 calls=0 work_rows=unchanged replay=verified fork=blocked pending=blocked lost_ack=readback concurrent_fork=blocked');
}finally{await db.end();}
