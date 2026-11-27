import pg from 'pg';
import { createPostgresSourceBatchStore } from '../../src/dreaming/source-batch-postgres.ts';
import { runPooledSourceCycle } from '../../src/dreaming/source-cycle.ts';
import fixture from '../../test/fixtures/source-reader.json' with { type: 'json' };
const limits={maxRequests:20,maxPageBytes:8000,maxTotalBytes:100000,timeoutMs:1000,pageMessages:2,pageChars:3};
export default {async fetch(req,env){
  if(req.method!=='POST'||typeof env.CANARY_KEY!=='string'||env.CANARY_KEY.length<32||req.headers.get('x-canary-key')!==env.CANARY_KEY||!/^hyperdrive-synthetic-[0-9a-f]{32}$/.test(env.CANARY_ID??''))return new Response(null,{status:404});
  const mode=new URL(req.url).pathname;
  if(mode==='/probe'){
    let client;
    try {
      client=new pg.Client({connectionString:env.HYPERDRIVE.connectionString});
      await client.connect();
      const {rows}=await client.query("SELECT current_database() AS db,current_user AS role,to_regnamespace('dw_ledger') IS NOT NULL AS ledger");
      return Response.json({phase:'connect',rows});
    }catch(e){return Response.json({phase:'connect',code:typeof e.code==='string'?e.code:null,name:e.name},{status:500});}
    finally{try{await client?.end();}catch{}}
  }
  if(!['/start','/resume','/replay'].includes(mode))return new Response(null,{status:404});
  const store=createPostgresSourceBatchStore({connectionString:env.HYPERDRIVE.connectionString});
  const input={candidate:fixture.candidate,expected:fixture.expected,analysisVersion:env.CANARY_ID,task:'Synthetic Hyperdrive acceptance witness.',maxSessions:2,bounds:{maxPages:20,maxChars:1000,maxMessages:50},indexes:fixture.entries.map(e=>({sessionId:e.session_id,index:e.index}))};
  const root=await store.initialize(input);
  if(!root.receipt||!['ACKNOWLEDGED','ALREADY_ACKNOWLEDGED'].includes(root.status))return Response.json({phase:'initialize',status:root.status},{status:500});
  input.previousCheckpoint=root.receipt.receiptFingerprint;
  let calls=0,pages=0;
  const routes=['a','b'].map(id=>({id,provider:'canary-provider-'+id,model:'canary-model-'+id,modelFamily:id,admission:'FREE_RESEARCH',qualifiedTasks:['analysis'],catalog:'PRESENT',catalogValidUntilMs:100000,async infer(request){
    calls++;
    return {provider:'canary-provider-'+id,model:'canary-model-'+id,finishReason:'stop',text:JSON.stringify({schema:'theseus.dreaming-worker.proposals.v1',proposals:[{type:'HYPOTHESIS',claim:'Synthetic Hyperdrive hypothesis '+id,why_plausible:'Synthetic evidence.',falsifier:'A conflicting synthetic observation.',required_evidence:['Independent observation.'],competing_explanations:['Synthetic alternative.'],uncertainty:'LOW',source_refs:request.packet.evidence.map(e=>({source_ref:e.sourceRef,evidence_hash:e.evidenceHash}))}]})};
  }}));
  const result=await runPooledSourceCycle(input,{limits,store,policy:{routes,taskClass:'analysis',maxAttempts:4,maxInvocations:mode==='/replay'?0:2,rotation:0,cooldowns:[],clock:()=>100},transport:async request=>{
    const entry=fixture.entries.find(e=>e.session_id===request.session_id);
    if(!entry||request.generation_id!==entry.index.generation_id||request.shard_id!==entry.index.shard_id)throw Error('FIXTURE_MISMATCH');
    const i=request.cursor?entry.pages.findIndex(p=>p.next_cursor===request.cursor)+1:0;
    if(i<0||i>=entry.pages.length)throw Error('FIXTURE_CURSOR');
    pages++;return Response.json(entry.pages[i]);
  }});
  const tip=await store.readTip(input);
  return Response.json({status:result.status,attemptedPasses:result.attemptedPasses,calls,pages,root:root.receipt.receiptFingerprint,tip:tip?.receiptFingerprint,receipt:result.run?.receipt?.receiptFingerprint??null,work:result.run?.work??[],canaryId:env.CANARY_ID});
}};
