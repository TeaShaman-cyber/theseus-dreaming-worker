import { z } from 'zod';
import { decodeSourceHandoff } from './source-handoff.ts';
import { prepareVerifiedSessionWork } from './verified-session-work.ts';
import { prepareCheckpointedPilot2 } from './checkpoint-pilot2.ts';
import { readVerifiedCompletion, type WorkStore } from './durable-pilot2.ts';
import { runPilot0 } from './dry-run.ts';
import { pilot1RequestFingerprint } from './pilot1-runner.ts';
import { sha256Fingerprint } from './proposal-schema.ts';

type SessionInput = Parameters<typeof prepareVerifiedSessionWork>[0];
type BatchInput = Pick<SessionInput, 'candidate' | 'expected' | 'task' | 'analysisVersion' | 'bounds'> & {
  entries: Pick<SessionInput, 'sessionId' | 'index' | 'pages'>[];
  maxSessions: number;
  previousCheckpoint: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Read-only synthetic receipt preparation. Trusted predecessor and catalog
 * observation are supplied by the caller; no durable source ack is made.
 */
export async function prepareSourceBatchReceipt(raw: BatchInput, store: Pick<WorkStore, 'readCompletion'>) {
  const x = structuredClone(raw);
  const maxSessions = z.number().int().min(1).max(100).parse(x.maxSessions);
  const previousCheckpoint = z.string().regex(/^sha256:[0-9a-f]{64}$/).parse(x.previousCheckpoint);
  const handoff = decodeSourceHandoff(x.candidate, x.expected);
  if (!handoff.selected.length || handoff.removed.length || handoff.selected.length > maxSessions
    || !Array.isArray(x.entries) || x.entries.length !== handoff.selected.length) {
    throw Error('SOURCE_BATCH_SELECTION');
  }
  const entries = new Map(x.entries.map(e => [e.sessionId,e]));
  if (entries.size !== handoff.selected.length) throw Error('SOURCE_BATCH_SELECTION');
  const prepared = handoff.selected.map(item => {
    const entry = entries.get(item.session_id);
    if (!entry) throw Error('SOURCE_BATCH_SELECTION');
    const result = prepareVerifiedSessionWork({
      candidate: handoff, expected: x.expected, task: x.task, analysisVersion: x.analysisVersion,
      bounds: x.bounds, sessionId: entry.sessionId, index: entry.index, pages: entry.pages,
    });
    if (result.status !== 'PREPARED' || !result.input) throw Error('SOURCE_BATCH_UNUSABLE');
    const admitted = prepareCheckpointedPilot2({
      ...result.input, checkpoint: { status: 'AVAILABLE', committed: null },
    });
    if (admitted.skipDecision) throw Error('SOURCE_BATCH_UNUSABLE');
    return { ...result, input: result.input, workFingerprint: admitted.workFingerprint };
  });
  const work = [];
  for (const entry of prepared) {
    try {
      const completion = await readVerifiedCompletion(store, entry.workFingerprint);
      if (!completion) return { status: 'PENDING' as const, receipt: null };
      const request = entry.input.request;
      const originalPacketId = completion.records[0].origin.packetId;
      // Recover original request identity without substituting current custody.
      const gate = runPilot0({ ...request.packet, packetId: originalPacketId });
      const expectedRequest = pilot1RequestFingerprint(request.scope, request.task, gate.receipt.inputFingerprint);
      if (completion.checkpoint.requestFingerprint !== expectedRequest) throw Error('SOURCE_BATCH_REQUEST');
      const refs = new Map(request.packet.evidence.map(e => [e.sourceRef,e.evidenceHash]));
      for (const record of completion.records) {
        if (record.origin.packetId !== originalPacketId
          || record.origin.evidenceFingerprint !== gate.receipt.inputFingerprint
          || record.proposal.source_refs.some(ref => refs.get(ref.source_ref) !== ref.evidence_hash)) {
          throw Error('SOURCE_BATCH_REFERENCE');
        }
      }
      work.push({ workFingerprint: entry.workFingerprint, completionFingerprint: completion.projectionFingerprint,
        originalPacketId, currentWitness: entry.provenance });
    } catch {
      return { status: 'STORAGE_UNKNOWN' as const, receipt: null };
    }
  }
  const payload = {
    schema: 'theseus.dreaming-worker.source-batch-receipt.v1' as const,
    previousCheckpoint, task: x.task, analysisVersion: x.analysisVersion, handoff, work,
    checkpointAdvanced: false as const,
  };
  return { status: 'RECEIPT_CANDIDATE' as const,
    receipt: { ...payload, receiptFingerprint: sha256Fingerprint(canonical(payload)) } };
}
