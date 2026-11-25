import { z } from 'zod';
import { runPilot2, type Pilot2Result, type Pilot2Route } from './pilot2-runner.ts';
import { sha256Fingerprint } from './proposal-schema.ts';

const nonblank = z.string().refine(value => value.trim().length > 0);
const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const checkpointSchema = z.object({
  schema: z.literal('theseus.dreaming-worker.checkpoint.v1'),
  workFingerprint: fingerprint,
  requestFingerprint: fingerprint,
  resultFingerprint: fingerprint,
}).strict();

export type CheckpointCandidate = z.infer<typeof checkpointSchema>;

const packetSchema = z.object({
  schema: z.literal('theseus-evidence-packet-v1'),
  packetId: nonblank,
  acceptedNewEvidence: z.boolean(),
  coverage: z.object({
    state: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
    currentness: z.enum(['CURRENT', 'STALE', 'UNKNOWN']),
  }).strict(),
  evidence: z.array(z.object({
    sourceRef: nonblank,
    evidenceHash: nonblank,
    text: nonblank,
  }).strict()),
}).strict().refine(
  packet => new Set(packet.evidence.map(item => item.sourceRef)).size === packet.evidence.length,
  'Duplicate evidence source references are ambiguous',
);

const inputSchema = z.object({
  request: z.object({
    scope: z.enum(['SYNTHETIC_FIXTURE', 'PUBLICATION_SAFE']),
    task: nonblank,
    packet: packetSchema,
  }).strict(),
  acceptedSourceFingerprint: fingerprint,
  analysisVersion: nonblank,
  checkpoint: z.discriminatedUnion('status', [
    z.object({ status: z.literal('AVAILABLE'), committed: checkpointSchema.nullable() }).strict(),
    z.object({ status: z.literal('UNAVAILABLE') }).strict(),
  ]),
}).strict();

export type CheckpointedPilot2Input = z.input<typeof inputSchema>;

type SkippedDecision = 'CHECKPOINT_UNAVAILABLE' | 'INTAKE_UNKNOWN' | 'NO_DATA' | 'ALREADY_PROCESSED';

export type CheckpointedPilot2Result =
  | {
      decision: SkippedDecision;
      workFingerprint: string;
      attemptedPasses: 0;
      analysis: null;
      checkpointCandidate: null;
      checkpointPersisted: false;
    }
  | {
      decision: 'ANALYZED';
      workFingerprint: string;
      attemptedPasses: number;
      analysis: Pilot2Result;
      checkpointCandidate: CheckpointCandidate | null;
      checkpointPersisted: false;
    };

/**
 * Portable, bounded composition only. The caller must establish source authority,
 * checkpoint read accuracy, budget and single-writer exclusion independently.
 * A returned candidate is not a durable commit or permission to advance intake.
 */
export async function runCheckpointedPilot2(
  rawInput: CheckpointedPilot2Input,
  routes: Pilot2Route[],
): Promise<CheckpointedPilot2Result> {
  // Strict parsing also creates an isolated snapshot of the admitted input.
  const { request, acceptedSourceFingerprint, analysisVersion, checkpoint } = inputSchema.parse(rawInput);
  const { packet } = request;
  const workFingerprint = sha256Fingerprint(JSON.stringify({
    schema: 'theseus.dreaming-worker.work-identity.v1',
    acceptedSourceFingerprint,
    analysisVersion,
    scope: request.scope,
    task: request.task,
    coverage: packet.coverage,
    evidence: packet.evidence,
  }));

  const skip = (decision: SkippedDecision): CheckpointedPilot2Result => ({
    decision,
    workFingerprint,
    attemptedPasses: 0,
    analysis: null,
    checkpointCandidate: null,
    checkpointPersisted: false,
  });

  if (checkpoint.status === 'UNAVAILABLE') return skip('CHECKPOINT_UNAVAILABLE');
  if (!packet.acceptedNewEvidence || packet.evidence.length === 0) {
    return skip(
      !packet.acceptedNewEvidence
      && packet.coverage.state === 'COMPLETE'
      && packet.coverage.currentness === 'CURRENT'
        ? 'NO_DATA'
        : 'INTAKE_UNKNOWN',
    );
  }
  if (checkpoint.committed?.workFingerprint === workFingerprint) return skip('ALREADY_PROCESSED');

  // Neither independent adapter may mutate the evidence the other receives.
  for (const item of packet.evidence) Object.freeze(item);
  Object.freeze(packet.evidence);
  Object.freeze(packet.coverage);
  Object.freeze(packet);
  Object.freeze(request);
  const analysis = await runPilot2(request, routes);
  const terminalSuccess =
    analysis.passes.filter(pass => pass.status === 'SUCCESS' && pass.receipt.finishReason === 'stop').length === 2;
  const checkpointCandidate: CheckpointCandidate | null = terminalSuccess
    ? {
        schema: 'theseus.dreaming-worker.checkpoint.v1',
        workFingerprint,
        requestFingerprint: analysis.receipt.requestFingerprint,
        resultFingerprint: sha256Fingerprint(JSON.stringify(analysis)),
      }
    : null;

  return {
    decision: 'ANALYZED',
    workFingerprint,
    attemptedPasses: analysis.receipt.attemptedPasses,
    analysis,
    checkpointCandidate,
    checkpointPersisted: false,
  };
}
