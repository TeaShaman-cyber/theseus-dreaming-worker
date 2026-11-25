import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  checkpointSchema, prepareCheckpointedPilot2, runCheckpointedPilot2,
  type CheckpointedPilot2Input, type CheckpointCandidate,
} from './checkpoint-pilot2.ts';
import { appendLedgerEvent, createProposalRecord, proposalLedgerRecordSchema, type ProposalLedgerEvent } from './proposal-ledger.ts';
import { sha256Fingerprint } from './proposal-schema.ts';
import type { Pilot2Result, Pilot2Route } from './pilot2-runner.ts';

const observedSchema = z.object({
  perspectiveId: z.string().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  finishReason: z.literal('stop'),
}).strict();

const payloadSchema = z.object({
  schema: z.literal('theseus.dreaming-worker.work-completion.v1'),
  checkpoint: checkpointSchema,
  observed: z.array(observedSchema).length(2),
  records: z.array(proposalLedgerRecordSchema).min(2),
}).strict();
const completionSchema = payloadSchema.extend({
  projectionFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();

export type WorkCompletion = z.infer<typeof completionSchema>;
export type DurablePilot2Input = Omit<CheckpointedPilot2Input, 'checkpoint'>;
export type WorkStore = {
  reserve(workFingerprint: string, ownerToken: string): Promise<boolean>;
  complete(ownerToken: string, completion: WorkCompletion): Promise<void>;
  readCompletion(workFingerprint: string): Promise<WorkCompletion | null>;
};

function perspective(work: string, index: number): string {
  return work + ':pass-' + (index + 1);
}

function digest(payload: unknown): string {
  return sha256Fingerprint(JSON.stringify(payload));
}

export function validateWorkCompletion(raw: unknown): WorkCompletion {
  const parsed = completionSchema.parse(raw);
  const { projectionFingerprint, ...payload } = parsed;
  if (digest(payload) !== projectionFingerprint) throw Error('WORK_PROJECTION_MISMATCH');
  const { checkpoint, observed, records } = payload;
  const ids = [perspective(checkpoint.workFingerprint, 0), perspective(checkpoint.workFingerprint, 1)];
  if (observed.some((item, index) => item.perspectiveId !== ids[index])) throw Error('WORK_PERSPECTIVE_MISMATCH');
  let events: ProposalLedgerEvent[] = [];
  for (const record of records) {
    if (record.origin.requestFingerprint !== checkpoint.requestFingerprint || !ids.includes(record.origin.perspectiveId)) {
      throw Error('WORK_RECORD_ORIGIN_MISMATCH');
    }
    events = appendLedgerEvent(events, record);
  }
  if (ids.some(id => !records.some(record => record.origin.perspectiveId === id))) throw Error('WORK_PERSPECTIVE_MISSING');
  return parsed;
}

function buildCompletion(checkpoint: CheckpointCandidate, analysis: Pilot2Result): WorkCompletion {
  if (checkpoint.resultFingerprint !== digest(analysis)) throw Error('WORK_ANALYSIS_MISMATCH');
  const observed = [];
  const records = [];
  for (const [index, pass] of analysis.passes.entries()) {
    if (pass.status !== 'SUCCESS') throw Error('WORK_ANALYSIS_INCOMPLETE');
    const perspectiveId = perspective(checkpoint.workFingerprint, index);
    observed.push({
      perspectiveId, provider: pass.receipt.provider, model: pass.receipt.model, finishReason: pass.receipt.finishReason,
    });
    for (const proposal of pass.proposalSet.proposals) {
      records.push(createProposalRecord({
        proposal,
        origin: {
          packetId: analysis.receipt.packetId,
          evidenceFingerprint: analysis.receipt.evidenceFingerprint,
          requestFingerprint: analysis.receipt.requestFingerprint,
          perspectiveId, route: pass.route,
        },
      }));
    }
  }
  const payload = payloadSchema.parse({
    schema: 'theseus.dreaming-worker.work-completion.v1', checkpoint, observed, records,
  });
  return validateWorkCompletion({ ...payload, projectionFingerprint: digest(payload) });
}

type Decision = 'NO_DATA' | 'INTAKE_UNKNOWN' | 'ALREADY_PROCESSED' | 'RESERVATION_UNRESOLVED'
  | 'STORAGE_UNKNOWN' | 'ANALYSIS_INCOMPLETE' | 'COMMITTED' | 'CHECKPOINT_UNAVAILABLE';

export type DurablePilot2Result = {
  decision: Decision;
  workFingerprint: string;
  attemptedPasses: number;
  completion: WorkCompletion | null;
  completionCandidate: WorkCompletion | null;
  analysis: Pilot2Result | null;
};

/** The caller owns source and budget authority. No retries, takeover or source-cursor advancement. */
export async function runDurablePilot2(
  raw: DurablePilot2Input, routes: Pilot2Route[], store: WorkStore,
): Promise<DurablePilot2Result> {
  const prepared = prepareCheckpointedPilot2({ ...raw, checkpoint: { status: 'AVAILABLE', committed: null } });
  const { workFingerprint, input, skipDecision } = prepared;
  let attemptedPasses = 0;
  let analysis: Pilot2Result | null = null;
  let completionCandidate: WorkCompletion | null = null;
  const result = (decision: Decision, completion: WorkCompletion | null = null): DurablePilot2Result =>
    ({ decision, workFingerprint, attemptedPasses, completion, analysis, completionCandidate });
  if (skipDecision) return result(skipDecision);
  const snapshot = routes.map(route => Object.freeze({ ...route }));

  const owner = randomUUID();
  let acquired: boolean;
  try {
    acquired = await store.reserve(workFingerprint, owner);
  } catch {
    return result('STORAGE_UNKNOWN');
  }
  async function readback(): Promise<WorkCompletion | null> {
    const rawCompletion = await store.readCompletion(workFingerprint);
    if (rawCompletion === null) return null;
    const verified = validateWorkCompletion(rawCompletion);
    if (verified.checkpoint.workFingerprint !== workFingerprint) throw Error('WORK_READBACK_IDENTITY_MISMATCH');
    return verified;
  }
  if (acquired !== true) {
    try {
      const existing = await readback();
      return existing ? result('ALREADY_PROCESSED', existing) : result('RESERVATION_UNRESOLVED');
    } catch {
      return result('STORAGE_UNKNOWN');
    }
  }

  const analyzed = await runCheckpointedPilot2(input, snapshot);
  attemptedPasses = analyzed.attemptedPasses;
  analysis = analyzed.analysis;
  if (!analyzed.checkpointCandidate || !analyzed.analysis) return result('ANALYSIS_INCOMPLETE');
  let completion: WorkCompletion;
  try {
    completion = buildCompletion(analyzed.checkpointCandidate, analyzed.analysis);
    completionCandidate = completion;
  } catch {
    return result('ANALYSIS_INCOMPLETE');
  }
  // Commit acknowledgement alone is not acceptance; always read back.
  try {
    await store.complete(owner, structuredClone(completion));
  } catch {
    // Unknown commit outcome; read back below, never re-execute inference.
  }
  try {
    const stored = await readback();
    return stored?.projectionFingerprint === completion.projectionFingerprint
      ? result('COMMITTED', stored) : result('STORAGE_UNKNOWN');
  } catch {
    return result('STORAGE_UNKNOWN');
  }
}
