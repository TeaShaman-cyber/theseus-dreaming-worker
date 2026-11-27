import { z } from 'zod';
import { prepareSourceBatchPlan, sourceReceiptFingerprint, type BatchInput } from './source-batch-receipt.ts';
import type { createPostgresSourceBatchStore } from './source-batch-postgres.ts';
import type { DurablePilot2Result } from './durable-pilot2.ts';
import type { Pilot2Route } from './pilot2-runner.ts';
import { selectModelPool } from './model-pool.ts';

type SourceStore = Pick<ReturnType<typeof createPostgresSourceBatchStore>,
  'readTip' | 'stage' | 'runSelected' | 'acknowledge'>;
type Stored = NonNullable<Awaited<ReturnType<SourceStore['acknowledge']>>['receipt']>;
type WorkSummary = Pick<DurablePilot2Result, 'workFingerprint' | 'decision' | 'attemptedPasses'>;
type RunStatus = 'ACKNOWLEDGED' | 'ALREADY_ACKNOWLEDGED' | 'BUDGET_EXHAUSTED'
  | 'WORK_UNRESOLVED' | 'STORAGE_UNKNOWN' | 'CONFLICT';
type RunResult = {
  status: RunStatus;
  planFingerprint: string;
  attemptedPasses: number;
  work: WorkSummary[];
  receipt: Stored | null;
};

function exactSourceReceipt(receipt: Stored | null, plan: ReturnType<typeof prepareSourceBatchPlan>) {
  if (!receipt || receipt.schema !== 'theseus.dreaming-worker.source-batch-receipt.v2'
    || receipt.previousCheckpoint !== plan.previousCheckpoint
    || receipt.currentPlanFingerprint !== plan.planFingerprint) return false;
  const { receiptFingerprint, ...payload } = receipt;
  return sourceReceiptFingerprint(payload) === receiptFingerprint;
}

export function prepareSourceRunPolicy(routes: Pilot2Route[], maxPasses: number) {
  const budget = z.number().int().min(0).max(200).parse(maxPasses);
  const snapshot = routes.map(route => Object.freeze({ ...route }));
  if (snapshot.length !== 2 || snapshot.some(r => !r.id?.trim() || !r.provider?.trim()
    || !r.model?.trim() || !r.modelFamily?.trim() || typeof r.infer !== 'function')
    || snapshot[0].modelFamily.trim().toLowerCase() === snapshot[1].modelFamily.trim().toLowerCase()) {
    throw Error('SOURCE_RUN_ROUTE_PLAN');
  }
  return { budget, routes: snapshot };
}

/** Explicit synthetic composition, not an acquisition or authorization boundary.
 * The caller supplies trusted current source observations and permitted routes.
 * The store owns reservation, completion and acknowledgement verification.
 */
export async function runSourceBatch(raw: BatchInput, routes: Pilot2Route[], store: SourceStore,
  maxPasses: number): Promise<RunResult> {
  const { budget, routes: snapshot } = prepareSourceRunPolicy(routes, maxPasses);
  const input = structuredClone(raw);
  const plan = prepareSourceBatchPlan(input);
  let attemptedPasses = 0;
  const work: WorkSummary[] = [];
  const result = (status: RunStatus, receipt: Stored | null = null): RunResult =>
    ({ status, planFingerprint: plan.planFingerprint, attemptedPasses, work, receipt });
  async function acknowledgeComplete(pending: 'BUDGET_EXHAUSTED' | 'WORK_UNRESOLVED') {
    const ack = await store.acknowledge(input);
    if (ack.status === 'CONFLICT') return result('CONFLICT');
    if (ack.status === 'PENDING') return result(pending);
    if ((ack.status !== 'ACKNOWLEDGED' && ack.status !== 'ALREADY_ACKNOWLEDGED')
      || !exactSourceReceipt(ack.receipt,plan)) return result('STORAGE_UNKNOWN');
    return result(ack.status, ack.receipt);
  }
  const boundedRoutes = snapshot.map(route => ({
    ...route,
    infer: async (...args: Parameters<Pilot2Route['infer']>) => {
      if (attemptedPasses >= budget) throw Error('SOURCE_RUN_PASS_BUDGET');
      attemptedPasses++;
      return route.infer(...args);
    },
  }));
  try {
    const tip = await store.readTip(input);
    if (!tip) return result('CONFLICT');
    if (tip.receiptFingerprint !== plan.previousCheckpoint) {
      if (!exactSourceReceipt(tip,plan)) return result('CONFLICT');
      const replay = await store.acknowledge(input);
      return replay.status === 'ALREADY_ACKNOWLEDGED' && exactSourceReceipt(replay.receipt,plan)
        ? result('ALREADY_ACKNOWLEDGED', replay.receipt) : result('STORAGE_UNKNOWN');
    }
    const staged = await store.stage(input);
    if (staged.status === 'CONFLICT') return result('CONFLICT');
    if (!staged.plan || staged.plan.planFingerprint !== plan.planFingerprint
      || sourceReceiptFingerprint(staged.plan) !== sourceReceiptFingerprint(plan)) return result('STORAGE_UNKNOWN');
    for (const entry of plan.work) {
      if (budget - attemptedPasses < 2) return await acknowledgeComplete('BUDGET_EXHAUSTED');
      const before = attemptedPasses;
      const next = await store.runSelected(input, entry.witness.session.session_id, boundedRoutes);
      const used = attemptedPasses - before;
      if (next.workFingerprint !== entry.workFingerprint || next.attemptedPasses !== used
        || used > 2) return result('STORAGE_UNKNOWN');
      work.push({ workFingerprint: next.workFingerprint, decision: next.decision, attemptedPasses: used });
      if (next.decision === 'STORAGE_UNKNOWN') return result('STORAGE_UNKNOWN');
      if (next.decision !== 'COMMITTED' && next.decision !== 'ALREADY_PROCESSED') return result('WORK_UNRESOLVED');
      if (!next.completion || next.completion.checkpoint.workFingerprint !== entry.workFingerprint
        || (next.decision === 'COMMITTED' ? used !== 2 : used !== 0)) return result('STORAGE_UNKNOWN');
    }
    return await acknowledgeComplete('WORK_UNRESOLVED');
  } catch {
    return result('STORAGE_UNKNOWN');
  }
}

type PooledStore = Pick<ReturnType<typeof createPostgresSourceBatchStore>,
  'readTip' | 'stage' | 'runSelectedPooled' | 'acknowledge'>;
type PooledPolicy = Parameters<PooledStore['runSelectedPooled']>[2];
type PooledWork = Pick<Awaited<ReturnType<PooledStore['runSelectedPooled']>>,
  'workFingerprint' | 'decision' | 'attemptedPasses' | 'wakeAtMs'>;
type PooledRun = {
  status: RunStatus | 'DEFERRED';
  planFingerprint: string;
  attemptedPasses: number;
  nextRotation: number;
  wakeAtMs: number | null;
  work: PooledWork[];
  receipt: Stored | null;
};

export function preparePooledSourceRunPolicy(policy: PooledPolicy): PooledPolicy {
  const budget = z.number().int().min(0).max(200).parse(policy.maxInvocations);
  const maxAttempts = z.number().int().min(2).max(200).parse(policy.maxAttempts);
  const { taskClass, clock } = policy;
  const cooldowns = structuredClone(policy.cooldowns);
  const routes = policy.routes.map(({infer,...metadata})=>{
    if(typeof infer!=='function')throw Error('POOL_EXECUTION_ADAPTER');
    return {...structuredClone(metadata),infer};
  });
  const rotation=policy.rotation;
  selectModelPool({routes:routes.map(({infer,...metadata})=>metadata),taskClass,nowMs:clock(),rotation,
    remainingAttempts:0,attemptedRouteIds:[],cooldowns,frozen:null,unresolvedAttempt:false});
  return {routes,taskClass,maxAttempts,maxInvocations:budget,rotation,cooldowns,clock};
}

/** Explicit bounded batch over the existing selected-work custody. No sleep,
 * retry, provider authorization or default source acquisition. */
export async function runPooledSourceBatch(raw: BatchInput, policy: PooledPolicy, store: PooledStore): Promise<PooledRun> {
  const {routes,taskClass,maxAttempts,maxInvocations:budget,cooldowns,clock,rotation:initialRotation}=preparePooledSourceRunPolicy(policy);
  let rotation=initialRotation;
  const input=structuredClone(raw),plan=prepareSourceBatchPlan(input);
  let attemptedPasses=0;
  const work:PooledWork[]=[];
  const result=(status:PooledRun['status'],receipt:Stored|null=null):PooledRun=>{
    const wakes=work.flatMap(w=>w.wakeAtMs===null?[]:[w.wakeAtMs]);
    return {status,planFingerprint:plan.planFingerprint,attemptedPasses,nextRotation:rotation,
      wakeAtMs:wakes.length?Math.min(...wakes):null,work,receipt};
  };
  const boundedRoutes=routes.map(route=>({...route,async infer(...args:Parameters<typeof route.infer>){
    if(attemptedPasses>=budget)throw Error('SOURCE_RUN_PASS_BUDGET');
    attemptedPasses++;
    return route.infer(...args);
  }}));
  try {
    const tip=await store.readTip(input);
    if(!tip)return result('CONFLICT');
    if(tip.receiptFingerprint!==plan.previousCheckpoint){
      if(!exactSourceReceipt(tip,plan))return result('CONFLICT');
      const replay=await store.acknowledge(input);
      return replay.status==='ALREADY_ACKNOWLEDGED'&&exactSourceReceipt(replay.receipt,plan)
        ?result('ALREADY_ACKNOWLEDGED',replay.receipt):result('STORAGE_UNKNOWN');
    }
    const staged=await store.stage(input);
    if(staged.status==='CONFLICT')return result('CONFLICT');
    if((staged.status!=='STAGED'&&staged.status!=='ALREADY_STAGED')||!staged.plan
      ||staged.plan.planFingerprint!==plan.planFingerprint
      ||sourceReceiptFingerprint(staged.plan)!==sourceReceiptFingerprint(plan))return result('STORAGE_UNKNOWN');
    for(const entry of plan.work){
      const before=attemptedPasses;
      const next=await store.runSelectedPooled(input,entry.witness.session.session_id,{
        routes:boundedRoutes,taskClass,maxAttempts,maxInvocations:budget-before,rotation,cooldowns,clock,
      });
      const used=attemptedPasses-before;
      if(next.workFingerprint!==entry.workFingerprint||next.attemptedPasses!==used
        ||used>budget-before||!Number.isSafeInteger(next.nextRotation)||next.nextRotation<0
        ||(next.decision==='DEFERRED'?(next.wakeAtMs===null||!Number.isSafeInteger(next.wakeAtMs)||next.wakeAtMs<0)
          :next.wakeAtMs!==null))return result('STORAGE_UNKNOWN');
      rotation=next.nextRotation;
      work.push({workFingerprint:next.workFingerprint,decision:next.decision,attemptedPasses:used,wakeAtMs:next.wakeAtMs});
      if(next.decision==='COMMITTED'||next.decision==='ALREADY_PROCESSED'){
        if(!next.completion||next.completion.checkpoint.workFingerprint!==entry.workFingerprint
          ||(next.decision==='ALREADY_PROCESSED'&&used!==0))return result('STORAGE_UNKNOWN');
        continue;
      }
      if(next.completion)return result('STORAGE_UNKNOWN');
      if(next.decision==='BUDGET_EXHAUSTED'||next.decision==='DEFERRED'||next.decision==='INSUFFICIENT_ELIGIBILITY')continue;
      return result(next.decision==='STORAGE_UNKNOWN'?'STORAGE_UNKNOWN':'WORK_UNRESOLVED');
    }
    if(work.some(w=>w.decision==='DEFERRED'))return result('DEFERRED');
    if(work.some(w=>w.decision==='BUDGET_EXHAUSTED'))return result('BUDGET_EXHAUSTED');
    if(work.some(w=>w.decision==='INSUFFICIENT_ELIGIBILITY'))return result('WORK_UNRESOLVED');
    const ack=await store.acknowledge(input);
    if(ack.status==='CONFLICT')return result('CONFLICT');
    if((ack.status!=='ACKNOWLEDGED'&&ack.status!=='ALREADY_ACKNOWLEDGED')||!exactSourceReceipt(ack.receipt,plan))
      return result('STORAGE_UNKNOWN');
    return result(ack.status,ack.receipt);
  }catch{return result('STORAGE_UNKNOWN');}
}
