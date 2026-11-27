import { decodeSourceHandoff, type SourceHandoffCandidate } from './source-handoff.ts';
import { acquireSourceBatch } from './source-batch-acquire.ts';
import { prepareSourceRunPolicy, runSourceBatch, preparePooledSourceRunPolicy, runPooledSourceBatch } from './source-batch-run.ts';

type CycleInput = Parameters<typeof acquireSourceBatch>[0];
type CycleOptions = {
  limits: Parameters<typeof acquireSourceBatch>[1];
  transport: Parameters<typeof acquireSourceBatch>[2];
  routes: Parameters<typeof runSourceBatch>[1];
  store: Parameters<typeof runSourceBatch>[2];
  maxPasses: number;
};
type HandoffSummary = {
  candidateSha256: string;
  currentness: SourceHandoffCandidate['currentness'];
  membershipChanged: boolean;
  selectedCount: number;
  removedCount: number;
};
type BatchRun = Awaited<ReturnType<typeof runSourceBatch>>;
type CycleResult<Run extends {status:string;attemptedPasses:number}> =
  | { status: 'INPUT_REJECTED' | 'REMOVAL_PENDING' | 'NO_SELECTED_WORK' | 'ACQUISITION_BLOCKED';
      handoff: HandoffSummary | null; attemptedPasses: 0; run: null }
  | { status: 'EXECUTION_UNKNOWN'; handoff: HandoffSummary; attemptedPasses: null; run: null }
  | { status: Run['status']; handoff: HandoffSummary; attemptedPasses: number; run: Run };

type AcquisitionOptions = Pick<CycleOptions,'limits'|'transport'>;
type Acquired = Awaited<ReturnType<typeof acquireSourceBatch>>;
type PooledCycleOptions = AcquisitionOptions & {
  policy: Parameters<typeof runPooledSourceBatch>[1];
  store: Parameters<typeof runPooledSourceBatch>[2];
};
type PooledBatchRun = Awaited<ReturnType<typeof runPooledSourceBatch>>;

async function composeSourceCycle<Run extends {status:string;attemptedPasses:number}>(
  raw: CycleInput, options: AcquisitionOptions,
  prepare: () => (batch:Acquired)=>Promise<Run>,
): Promise<CycleResult<Run>> {
  let input: CycleInput;
  let limits: CycleOptions['limits'];
  let execute: (batch:Acquired)=>Promise<Run>;
  let handoff: HandoffSummary;
  let candidate: SourceHandoffCandidate;
  const { transport } = options;
  try {
    input = structuredClone(raw);
    limits = structuredClone(options.limits);
    execute = prepare();
    candidate = decodeSourceHandoff(input.candidate, input.expected);
    if (!candidate.scope.startsWith('synthetic:') || !Array.isArray(input.indexes)
      || typeof transport !== 'function') throw Error();
    handoff = {
      candidateSha256: candidate.candidate_sha256,
      currentness: candidate.currentness,
      membershipChanged: candidate.previous_membership.snapshot_sha256 !== candidate.current_membership.snapshot_sha256,
      selectedCount: candidate.selected.length,
      removedCount: candidate.removed.length,
    };
  } catch {
    return { status: 'INPUT_REJECTED', handoff: null, attemptedPasses: 0, run: null };
  }
  if (handoff.removedCount) return { status: 'REMOVAL_PENDING', handoff, attemptedPasses: 0, run: null };
  if (!handoff.selectedCount) return {
    status: input.indexes.length ? 'INPUT_REJECTED' : 'NO_SELECTED_WORK',
    handoff, attemptedPasses: 0, run: null,
  };
  let batch: Awaited<ReturnType<typeof acquireSourceBatch>>;
  try { batch = await acquireSourceBatch(input, limits, transport); }
  catch { return { status: 'ACQUISITION_BLOCKED', handoff, attemptedPasses: 0, run: null }; }
  try {
    const run = await execute(batch);
    return { status: run.status, handoff, attemptedPasses: run.attemptedPasses, run };
  } catch {
    return { status: 'EXECUTION_UNKNOWN', handoff, attemptedPasses: null, run: null };
  }
}

/** Explicit synthetic fixed-pair composition, with caller-owned transport and custody. */
export function runSourceCycle(raw: CycleInput, options: CycleOptions): Promise<CycleResult<BatchRun>> {
  return composeSourceCycle(raw,options,()=>{
    const policy=prepareSourceRunPolicy(options.routes,options.maxPasses);
    const {store}=options;
    return batch=>runSourceBatch(batch,policy.routes,store,policy.budget);
  });
}

/** Explicit synthetic pooled composition; no default runtime or real-source permission. */
export function runPooledSourceCycle(raw: CycleInput, options: PooledCycleOptions): Promise<CycleResult<PooledBatchRun>> {
  return composeSourceCycle(raw,options,()=>{
    const policy=preparePooledSourceRunPolicy(options.policy);
    const {store}=options;
    return batch=>runPooledSourceBatch(batch,policy,store);
  });
}
