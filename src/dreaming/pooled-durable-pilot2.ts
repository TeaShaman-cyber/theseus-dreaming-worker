import { randomUUID } from 'node:crypto';
import { prepareCheckpointedPilot2 } from './checkpoint-pilot2.ts';
import { readVerifiedCompletion, recoverDurableCompletion, validateWorkCompletion,
  type DurablePilot2Input, type WorkCompletion, type WorkStore } from './durable-pilot2.ts';
import { selectModelPool, type ModelPoolInput } from './model-pool.ts';
import { ProviderAdapterError } from './openai-provider-adapter.ts';
import { runPilot1, type Pilot1Inference, type Pilot1InferenceResult } from './pilot1-runner.ts';
import { preparePoolJournal, replayPoolJournal, type PoolJournalEvent, type PoolJournalEntry } from './pool-attempt-journal.ts';
import type { createPostgresPoolJournalStore } from './proposal-ledger-postgres.ts';
import { createProposalRecord } from './proposal-ledger.ts';
import { fingerprintProposal, sha256Fingerprint } from './proposal-schema.ts';

type Candidate = ModelPoolInput['routes'][number] & { infer: Pilot1Inference };
type Policy = {
  routes: Candidate[]; taskClass: string; maxAttempts: number; maxInvocations: number;
  rotation: number; cooldowns: ModelPoolInput['cooldowns']; clock: () => number;
};
type Journal = Pick<ReturnType<typeof createPostgresPoolJournalStore>, 'read' | 'admit' | 'append'>;
type CompletionStore = Pick<WorkStore, 'readCompletion' | 'complete'>;
type State = ReturnType<typeof replayPoolJournal>;
type Start = Extract<PoolJournalEvent, {kind:'START'}>;
type Failure = Extract<PoolJournalEvent, {kind:'KNOWN_FAILURE'}>;
type Decision = 'NO_DATA' | 'INTAKE_UNKNOWN' | 'CHECKPOINT_UNAVAILABLE' | 'ALREADY_PROCESSED'
  | 'COMMITTED' | 'LEGACY_UNRESOLVED' | 'BLOCKED_UNKNOWN' | 'STORAGE_UNKNOWN'
  | 'BUDGET_EXHAUSTED' | 'INSUFFICIENT_ELIGIBILITY' | 'DEFERRED' | 'POLICY_CONFLICT';

export function buildPoolCompletion(input: DurablePilot2Input, entries: PoolJournalEntry[]): WorkCompletion {
  const ctx = preparePoolJournal(input);
  const state = replayPoolJournal(ctx, entries);
  if (state.unresolved || state.validated.length !== 2) throw Error('POOL_COMPLETION_INCOMPLETE');
  const observed = state.validated.map(({start,result}) => ({
    perspectiveId: ctx.workFingerprint + ':pass-' + (start.slot+1),
    provider: result.receipt.provider, model: result.receipt.model, finishReason: result.receipt.finishReason,
  }));
  const records = state.validated.flatMap(({start,result},i) => result.proposalSet.proposals.map(proposal =>
    createProposalRecord({proposal,origin:{packetId:result.receipt.packetId,
      evidenceFingerprint:ctx.evidenceFingerprint,requestFingerprint:ctx.requestFingerprint,
      perspectiveId:observed[i].perspectiveId,route:start.route}})));
  const payload = {schema:'theseus.dreaming-worker.work-completion.v1' as const,
    checkpoint:{schema:'theseus.dreaming-worker.checkpoint.v1' as const,workFingerprint:ctx.workFingerprint,
      requestFingerprint:ctx.requestFingerprint,resultFingerprint:state.tip},observed,records};
  return validateWorkCompletion({...payload,projectionFingerprint:sha256Fingerprint(JSON.stringify(payload))});
}

function failureFromError(start: Start, error: unknown, response: Pilot1InferenceResult | null, now: number): PoolJournalEvent {
  const unknown = (code: 'TIMEOUT' | 'TRANSPORT_UNKNOWN' | 'EXECUTION_UNKNOWN'): PoolJournalEvent =>
    ({kind:'UNKNOWN',attemptId:start.attemptId,code});
  const base = {kind:'KNOWN_FAILURE' as const,attemptId:start.attemptId,providerState:'RESPONDED' as const};
  if (error instanceof ProviderAdapterError) {
    if (error.providerState !== 'RESPONDED' || error.code === 'TIMEOUT') return unknown(error.code === 'TIMEOUT'?'TIMEOUT':'TRANSPORT_UNKNOWN');
    const wait = error.retryAfterMs;
    const validWait = typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 && wait <= Number.MAX_SAFE_INTEGER;
    const refused = [401,402,403].includes(error.status ?? 0);
    const unavailable = error.code === 'RATE_LIMITED' || (error.status ?? 0) >= 500;
    const cooldown = refused || (unavailable && !validWait)
      ? {scope:'provider' as const,key:start.route.provider,notBeforeMs:Number.MAX_SAFE_INTEGER}
      : validWait ? {scope:'provider' as const,key:start.route.provider,notBeforeMs:Math.min(Number.MAX_SAFE_INTEGER,now+Math.ceil(wait))} : null;
    return {...base,code:error.code,cooldown,...(error.status===undefined?{}:{httpStatus:error.status}),
      ...(validWait?{retryAfterMs:wait}:{})};
  }
  if (!response) return unknown('EXECUTION_UNKNOWN');
  const message = error instanceof Error ? error.message : '';
  const classifications: [string,Failure['code']][] = [
    ['PILOT1_PROPOSAL_JSON_INVALID','INVALID_JSON'],
    ['PILOT1_PROPOSAL_SCHEMA_INVALID','INVALID_SCHEMA'],
    ['PILOT1_PROVENANCE_REJECTED','PROVENANCE_REJECTED'],
    ['PILOT1_OUTPUT_TRUNCATED','OUTPUT_BUDGET_EXHAUSTED'],
    ['PILOT1_POLICY_VIOLATION','POLICY_VIOLATION'],
    ['POOL_MODEL_IDENTITY_MISMATCH','MODEL_IDENTITY_MISMATCH'],
    ['POOL_FINISH_INVALID','MALFORMED_RESPONSE'],
    ['POOL_EMPTY_FINAL_CONTENT','EMPTY_FINAL_CONTENT'],
  ];
  const code = classifications.find(([prefix])=>message.startsWith(prefix))?.[1];
  if (!code) return unknown('EXECUTION_UNKNOWN');
  const observed = {provider:response.provider,model:response.model,finishReason:response.finishReason??null};
  return {...base,code,cooldown:null,observed};
}

/** Explicit free-research candidate composition; caller owns adapter bounds and admission evidence. */
export async function runPooledDurablePilot2(raw: DurablePilot2Input, policy: Policy, journal: Journal, workStore: CompletionStore) {
  const prepared = prepareCheckpointedPilot2({...raw,checkpoint:{status:'AVAILABLE',committed:null}});
  const {workFingerprint,skipDecision} = prepared;
  let attemptedPasses=0, rotation=policy.rotation;
  const result=(decision: Decision,completion: WorkCompletion|null=null,wakeAtMs: number|null=null)=>
    ({decision,workFingerprint,attemptedPasses,nextRotation:rotation,completion,wakeAtMs});
  if(skipDecision) return result(skipDecision);
  const {request,acceptedSourceFingerprint,analysisVersion}=prepared.input;
  const input={request,acceptedSourceFingerprint,analysisVersion};
  const maxAttempts=policy.maxAttempts, maxInvocations=policy.maxInvocations, taskClass=policy.taskClass, clock=policy.clock;
  if(!Number.isInteger(maxAttempts)||maxAttempts<2||maxAttempts>200
    ||!Number.isInteger(maxInvocations)||maxInvocations<0||maxInvocations>200||typeof clock!=='function') throw Error('POOL_EXECUTION_BUDGET');
  const adapters = policy.routes.map(({infer,...metadata})=>{
    if(typeof infer!=='function') throw Error('POOL_EXECUTION_ADAPTER');
    return {infer,metadata:structuredClone(metadata)};
  });
  const externalCooldowns=structuredClone(policy.cooldowns);
  const time=()=>{const now=clock();if(!Number.isSafeInteger(now)||now<0)throw Error('POOL_EXECUTION_CLOCK');return now;};
  function choose(state: State|null) {
    const attempts=state?.attempts??[];
    const routes=adapters.map(({metadata:r})=>({...r,
      admission:attempts.some(a=>a.route.provider===r.provider&&a.route.model===r.model)?'NOT_AUTHORIZED' as const:r.admission}));
    const all=[...externalCooldowns,...(state?.failures.flatMap(f=>f.result.cooldown?[f.result.cooldown]:[])??[])];
    const cooldowns=new Map<string,ModelPoolInput['cooldowns'][number]>();
    for(const c of all){
      const key=JSON.stringify([c.scope,c.key]);
      if(!cooldowns.has(key)||cooldowns.get(key)!.notBeforeMs<c.notBeforeMs)cooldowns.set(key,c);
    }
    return selectModelPool({routes,taskClass,nowMs:time(),rotation,
      remainingAttempts:Math.min(maxInvocations-attemptedPasses,state?.remainingAttempts??maxAttempts),
      attemptedRouteIds:attempts.map(a=>a.route.id),cooldowns:[...cooldowns.values()],
      frozen:state?.validated[0]?.start.route??null,unresolvedAttempt:state?.unresolved??false});
  }
  // Validate all caller descriptors before admission, even when the current call budget is zero.
  selectModelPool({routes:adapters.map(a=>a.metadata),taskClass,nowMs:time(),rotation,remainingAttempts:0,
    attemptedRouteIds:[],cooldowns:externalCooldowns,frozen:null,unresolvedAttempt:false});
  try {
    let current=await journal.read(input);
    const existing=await readVerifiedCompletion(workStore,workFingerprint);
    if(existing){
      if(current.status==='COMPLETION_EXISTS')return result('ALREADY_PROCESSED',existing);
      if(current.status==='JOURNAL'&&current.completionExists
        &&buildPoolCompletion(input,current.state.entries).projectionFingerprint===existing.projectionFingerprint)
        return result('ALREADY_PROCESSED',existing);
      return result('STORAGE_UNKNOWN');
    }
    if(current.status==='COMPLETION_EXISTS'||(current.status==='JOURNAL'&&current.completionExists))return result('STORAGE_UNKNOWN');
    if(current.status==='LEGACY_UNRESOLVED')return result('LEGACY_UNRESOLVED');
    if(current.status==='ABSENT'){
      const selection=choose(null);
      if(selection.status!=='READY')return result(selection.status,null,selection.status==='DEFERRED'?selection.wakeAtMs:null);
      current=await journal.admit(input,maxAttempts,randomUUID());
    }
    if(current.status!=='JOURNAL'||current.completionExists)return result('STORAGE_UNKNOWN');
    const ownerToken=current.ownerToken;
    let state=current.state;
    const admission=state.entries[0].event;
    if(admission.kind!=='ADMIT'||admission.maxAttempts!==maxAttempts)return result('POLICY_CONFLICT');
    for(;;){
      if(state.validated.length===2){
        const completion=buildPoolCompletion(input,state.entries);
        const done=await recoverDurableCompletion({schema:'theseus.dreaming-worker.completion-recovery.v1',ownerToken,candidate:completion},workStore);
        return result(done.decision,done.completion);
      }
      const selection=choose(state);
      if(selection.status!=='READY')return result(selection.status,null,selection.status==='DEFERRED'?selection.wakeAtMs:null);
      const route=selection.routes[0];
      const adapter=adapters.find(a=>a.metadata.id===route.id);
      if(!adapter)return result('POLICY_CONFLICT');
      const start: Start={kind:'START',attemptId:randomUUID(),slot:state.validated.length===0?0:1,route};
      state=await journal.append(input,state.tip,start);
      if(state.pending?.attemptId!==start.attemptId)return result('STORAGE_UNKNOWN');
      rotation=selection.nextRotation;
      let response: Pilot1InferenceResult|null=null;
      let event: PoolJournalEvent;
      try{
        const run=await runPilot1(request,async (...args)=>{
          attemptedPasses++;
          response=await adapter.infer(...args);
          if(response.model!==route.model)throw Error('POOL_MODEL_IDENTITY_MISMATCH');
          if(response.finishReason==='length')throw Error('PILOT1_OUTPUT_TRUNCATED');
          if(response.finishReason!=='stop')throw Error('POOL_FINISH_INVALID');
          if(!response.text?.trim())throw Error('POOL_EMPTY_FINAL_CONTENT');
          return response;
        });
        if(run.outcome!=='PROPOSED')throw Error('POOL_EXECUTION_UNEXPECTED_NO_DATA');
        const {packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,externalModelCalls,toolsUsed,memoryUsed,canonicalWrites}=run.receipt;
        if(!provider||!model||finishReason!=='stop'||externalModelCalls!==1||toolsUsed!==0
          ||new Set(run.proposalSet.proposals.map(fingerprintProposal)).size!==run.proposalSet.proposals.length)
          throw Error('PILOT1_POLICY_VIOLATION');
        event={kind:'VALIDATED',attemptId:start.attemptId,receipt:{packetId,requestFingerprint,evidenceFingerprint,provider,model,finishReason,
          externalModelCalls,toolsUsed,memoryUsed,canonicalWrites},proposalSet:run.proposalSet};
      }catch(error){
        event=failureFromError(start,error,response,time());
      }
      state=await journal.append(input,state.tip,event);
    }
  }catch{
    return result('STORAGE_UNKNOWN');
  }
}
