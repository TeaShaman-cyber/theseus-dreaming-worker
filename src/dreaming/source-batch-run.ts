import { z } from 'zod';
import { prepareSourceBatchPlan, sourceReceiptFingerprint, type BatchInput } from './source-batch-receipt.ts';
import type { createPostgresSourceBatchStore } from './source-batch-postgres.ts';
import type { DurablePilot2Result } from './durable-pilot2.ts';
import type { Pilot2Route } from './pilot2-runner.ts';

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

/** Explicit synthetic composition, not an acquisition or authorization boundary.
 * The caller supplies trusted current source observations and permitted routes.
 * The store owns reservation, completion and acknowledgement verification.
 */
export async function runSourceBatch(raw: BatchInput, routes: Pilot2Route[], store: SourceStore,
  maxPasses: number): Promise<RunResult> {
  const budget = z.number().int().min(0).max(200).parse(maxPasses);
  const input = structuredClone(raw);
  const plan = prepareSourceBatchPlan(input);
  const snapshot = routes.map(route => Object.freeze({ ...route }));
  if (snapshot.length !== 2 || snapshot.some(r => !r.id?.trim() || !r.provider?.trim()
    || !r.model?.trim() || !r.modelFamily?.trim() || typeof r.infer !== 'function')
    || snapshot[0].modelFamily.trim().toLowerCase() === snapshot[1].modelFamily.trim().toLowerCase()) {
    throw Error('SOURCE_RUN_ROUTE_PLAN');
  }
  let attemptedPasses = 0;
  const work: WorkSummary[] = [];
  const result = (status: RunStatus, receipt: Stored | null = null): RunResult =>
    ({ status, planFingerprint: plan.planFingerprint, attemptedPasses, work, receipt });
  function exactReceipt(receipt: Stored | null) {
    if (!receipt || receipt.schema !== 'theseus.dreaming-worker.source-batch-receipt.v2'
      || receipt.previousCheckpoint !== plan.previousCheckpoint
      || receipt.currentPlanFingerprint !== plan.planFingerprint) return false;
    const { receiptFingerprint, ...payload } = receipt;
    return sourceReceiptFingerprint(payload) === receiptFingerprint;
  }
  async function acknowledgeComplete(pending: 'BUDGET_EXHAUSTED' | 'WORK_UNRESOLVED') {
    const ack = await store.acknowledge(input);
    if (ack.status === 'CONFLICT') return result('CONFLICT');
    if (ack.status === 'PENDING') return result(pending);
    if ((ack.status !== 'ACKNOWLEDGED' && ack.status !== 'ALREADY_ACKNOWLEDGED')
      || !exactReceipt(ack.receipt)) return result('STORAGE_UNKNOWN');
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
      if (!exactReceipt(tip)) return result('CONFLICT');
      const replay = await store.acknowledge(input);
      return replay.status === 'ALREADY_ACKNOWLEDGED' && exactReceipt(replay.receipt)
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
