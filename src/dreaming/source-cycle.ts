import { decodeSourceHandoff, type SourceHandoffCandidate } from './source-handoff.ts';
import { acquireSourceBatch } from './source-batch-acquire.ts';
import { prepareSourceRunPolicy, runSourceBatch } from './source-batch-run.ts';

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
type CycleResult =
  | { status: 'INPUT_REJECTED' | 'REMOVAL_PENDING' | 'NO_SELECTED_WORK' | 'ACQUISITION_BLOCKED';
      handoff: HandoffSummary | null; attemptedPasses: 0; run: null }
  | { status: 'EXECUTION_UNKNOWN'; handoff: HandoffSummary; attemptedPasses: null; run: null }
  | { status: BatchRun['status']; handoff: HandoffSummary; attemptedPasses: number; run: BatchRun };

/** One explicit synthetic invocation. The caller owns trusted source custody,
 * transport, route authorization and the existing ledger. No default runtime. */
export async function runSourceCycle(raw: CycleInput, options: CycleOptions): Promise<CycleResult> {
  let input: CycleInput;
  let limits: CycleOptions['limits'];
  let policy: ReturnType<typeof prepareSourceRunPolicy>;
  let handoff: HandoffSummary;
  let candidate: SourceHandoffCandidate;
  const { transport, store } = options;
  try {
    input = structuredClone(raw);
    limits = structuredClone(options.limits);
    policy = prepareSourceRunPolicy(options.routes, options.maxPasses);
    candidate = decodeSourceHandoff(input.candidate, input.expected);
    if (!candidate.scope.startsWith('synthetic:') || !Array.isArray(input.indexes)
      || typeof transport !== 'function') throw Error('SOURCE_CYCLE_INPUT');
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
    const run = await runSourceBatch(batch, policy.routes, store, policy.budget);
    return { status: run.status, handoff, attemptedPasses: run.attemptedPasses, run };
  } catch {
    return { status: 'EXECUTION_UNKNOWN', handoff, attemptedPasses: null, run: null };
  }
}
